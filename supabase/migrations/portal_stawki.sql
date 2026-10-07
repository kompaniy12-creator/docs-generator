-- Statutory minimum wage / minimum hourly rate by effective date. Rows are added
-- by the `stawki` edge function from the official register of acts (ELI); the
-- public intake form reads them, so SELECT is open. No write policy: only the
-- service role (the function) can insert.

create table if not exists public.portal_stawki (
  valid_from date primary key,
  min_wage   numeric(10,2) not null,
  min_hourly numeric(10,2) not null,
  source     text,
  created_at timestamptz not null default now()
);
alter table public.portal_stawki enable row level security;
drop policy if exists stawki_read_all on public.portal_stawki;
create policy stawki_read_all on public.portal_stawki for select to anon, authenticated using (true);

-- when the register was last queried (at most once a day)
create table if not exists public.portal_stawki_check (
  id int primary key default 1 check (id = 1),
  checked_at timestamptz not null default 'epoch'
);
alter table public.portal_stawki_check enable row level security;
insert into public.portal_stawki_check (id) values (1) on conflict (id) do nothing;

insert into public.portal_stawki (valid_from, min_wage, min_hourly, source)
values ('2026-01-01', 4806, 31.40, 'Dz.U. 2025 poz. 1242')
on conflict (valid_from) do nothing;
