-- Client-specific contract templates (umowa zlecenie / umowa o pracę), keyed by the
-- employer's NIP. A firm without a row gets the portal's standard contract.
-- Portal users only (app_metadata.portal = true) — same access model as the
-- rest of the portal tables.

create table if not exists public.umowa_szablony (
  nip        text not null,
  typ        text not null check (typ in ('zlecenie', 'praca')),
  tresc      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (nip, typ)
);

alter table public.umowa_szablony enable row level security;

drop policy if exists us_all_portal on public.umowa_szablony;
create policy us_all_portal on public.umowa_szablony
  for all to authenticated
  using (public.is_portal_user()) with check (public.is_portal_user());
