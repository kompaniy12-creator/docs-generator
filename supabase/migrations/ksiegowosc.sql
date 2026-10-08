-- Księgowość: monthly closing of each client's books.
-- One row per client (NIP) and period (YYYY-MM); kroki = { step_id: { at, by } } for steps done.
create table if not exists public.ksieg_zamkniecia (
  nip text not null,
  okres text not null check (okres ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kroki jsonb not null default '{}'::jsonb,
  uwagi text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (nip, okres)
);
alter table public.ksieg_zamkniecia enable row level security;
drop policy if exists ksieg_zamkniecia_all on public.ksieg_zamkniecia;
create policy ksieg_zamkniecia_all on public.ksieg_zamkniecia for all to authenticated
  using (public.has_portal_section('onboarding')) with check (public.has_portal_section('onboarding'));
