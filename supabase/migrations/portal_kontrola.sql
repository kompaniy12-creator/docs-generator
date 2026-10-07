-- Automatic control of deadlines + legal knowledge base.
--   portal_powiadomienia : every notice that went out (or failed) — also the dedupe key
--   portal_zadania_log   : one row per run of a scheduled job (health / self-repair)
--   portal_wiedza        : legal rules the portal relies on, each with its legal basis
--   portal_prawo_akty    : acts watched in the official ELI register for amendments
-- Scheduled with pg_cron + pg_net; the jobs call edge functions with a key kept in Vault.

create table if not exists public.portal_powiadomienia (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rodzaj     text not null,                 -- termin_klient | digest_kadry | alert | prawo
  nip        text,
  worker_id  uuid,
  doc_key    text,
  doc_date   date,
  prog       int,                           -- threshold (days) the notice was sent for
  kanal      text,                          -- mail | telegram
  adresat    text,
  status     text not null default 'ok',    -- ok | blad
  blad       text,
  wyslal     text                           -- 'auto' or the portal user's e-mail
);
create index if not exists portal_powiadomienia_created on public.portal_powiadomienia (created_at desc);
-- one successful client notice per worker / document / date / threshold
create unique index if not exists portal_powiadomienia_dedupe
  on public.portal_powiadomienia (worker_id, doc_key, doc_date, prog)
  where rodzaj = 'termin_klient' and status = 'ok';
alter table public.portal_powiadomienia enable row level security;
drop policy if exists pp_select_kadry on public.portal_powiadomienia;
create policy pp_select_kadry on public.portal_powiadomienia
  for select to authenticated using (public.has_portal_section('kadry'));

create table if not exists public.portal_zadania_log (
  id          bigint generated always as identity primary key,
  zadanie     text not null,
  dzien       date not null default (now() at time zone 'Europe/Warsaw')::date,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  info        jsonb
);
create index if not exists portal_zadania_log_idx on public.portal_zadania_log (zadanie, dzien desc);
alter table public.portal_zadania_log enable row level security;
drop policy if exists pz_select_kadry on public.portal_zadania_log;
create policy pz_select_kadry on public.portal_zadania_log
  for select to authenticated using (public.has_portal_section('kadry'));

create table if not exists public.portal_wiedza (
  id            text primary key,
  dzial         text not null,
  temat         text not null,
  tresc         text not null,
  podstawa      text not null,              -- article + act
  eli           text,                       -- act in the ELI register, e.g. DU/2025/621
  zweryfikowano date not null,              -- when the rule was last checked against the act
  do_sprawdzenia boolean not null default false, -- set when the act changed after verification
  kolejnosc     int not null default 100
);
alter table public.portal_wiedza enable row level security;
drop policy if exists pw_select_portal on public.portal_wiedza;
create policy pw_select_portal on public.portal_wiedza
  for select to authenticated using (public.is_portal_user());

create table if not exists public.portal_prawo_akty (
  eli            text primary key,
  tytul          text not null,
  skrot          text not null,
  change_date    timestamptz,               -- changeDate reported by ELI
  zmiany         jsonb not null default '[]'::jsonb, -- amending acts known at the last check
  tekst_jednolity text,
  checked_at     timestamptz,
  zmiana_wykryta timestamptz               -- set when a new amendment appeared
);
alter table public.portal_prawo_akty enable row level security;
drop policy if exists pa_select_portal on public.portal_prawo_akty;
create policy pa_select_portal on public.portal_prawo_akty
  for select to authenticated using (public.is_portal_user());
