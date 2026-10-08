-- Tasks for the team (CRM): people assign tasks to each other, the system adds its own
-- (statutory deadlines, unreviewed submissions, expiring documents) and watches them.
create table if not exists public.portal_zadania (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text not null,                       -- e-mail of the author, or 'system'
  assignee    text not null,                       -- e-mail of the person responsible
  tytul       text not null check (char_length(tytul) between 1 and 300),
  opis        text check (opis is null or char_length(opis) <= 4000),
  termin      date,
  pilne       boolean not null default false,
  status      text not null default 'nowe' check (status in ('nowe', 'w_toku', 'zrobione', 'anulowane')),
  done_at     timestamptz,
  done_by     text,
  zrodlo      text not null default 'reczne' check (zrodlo in ('reczne', 'system')),
  klucz       text unique,                         -- dedupe key of a system task
  link        text check (link is null or link ~ '^[a-z0-9-]+\.html'),
  komentarze  jsonb not null default '[]'::jsonb,  -- [{at, by, text}]
  przypomniano date,                               -- last day a reminder went out
  eskalacja   timestamptz                          -- when it was reported to the owner
);
create index if not exists portal_zadania_open on public.portal_zadania (assignee, status, termin);
alter table public.portal_zadania enable row level security;

-- the whole team sees all tasks; a task is written in the name of the signed-in user
drop policy if exists pzad_select on public.portal_zadania;
create policy pzad_select on public.portal_zadania for select to authenticated using (public.is_portal_user());
drop policy if exists pzad_insert on public.portal_zadania;
create policy pzad_insert on public.portal_zadania for insert to authenticated
  with check (public.is_portal_user() and zrodlo = 'reczne' and klucz is null
              and created_by = (auth.jwt() ->> 'email') and eskalacja is null and przypomniano is null);
drop policy if exists pzad_update on public.portal_zadania;
create policy pzad_update on public.portal_zadania for update to authenticated
  using (public.is_portal_user()) with check (public.is_portal_user());
-- only the author or an administrator may delete; system tasks are closed, not deleted
drop policy if exists pzad_delete on public.portal_zadania;
create policy pzad_delete on public.portal_zadania for delete to authenticated
  using (public.is_portal_user() and zrodlo = 'reczne'
         and (created_by = (auth.jwt() ->> 'email') or coalesce((auth.jwt() -> 'app_metadata' ->> 'portal_admin') = 'true', false)));
revoke all on public.portal_zadania from anon;

-- who did what stays truthful: author, source and escalation marks cannot be edited from the browser
create or replace function public.portal_zadania_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if coalesce(auth.role(), '') = 'authenticated' then
    new.created_by := old.created_by; new.created_at := old.created_at; new.zrodlo := old.zrodlo;
    new.klucz := old.klucz; new.eskalacja := old.eskalacja; new.przypomniano := old.przypomniano;
    if new.status = 'zrobione' and old.status <> 'zrobione' then
      new.done_at := now(); new.done_by := auth.jwt() ->> 'email';
    elsif new.status <> 'zrobione' then
      new.done_at := null; new.done_by := null;
    else
      new.done_at := old.done_at; new.done_by := old.done_by;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists portal_zadania_guard on public.portal_zadania;
create trigger portal_zadania_guard before update on public.portal_zadania
  for each row execute function public.portal_zadania_guard();

select cron.unschedule(jobname) from cron.job where jobname in ('portal-zadania', 'portal-zadania-pm');
-- 05:25 UTC: system tasks + morning reminders; 12:00 UTC: second look at today's and overdue tasks
select cron.schedule('portal-zadania',    '25 5 * * *',   $$select public.portal_cron_call('zadania', 'run')$$);
select cron.schedule('portal-zadania-pm', '0 12 * * 1-5', $$select public.portal_cron_call('zadania', 'run')$$);
