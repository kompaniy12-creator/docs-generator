-- GUS (REGON) answers kept by NIP, so the public lookups (gus-company, klient-by-nip) ask the paid
-- provider at most once per firm in 30 days. Written and read only by the edge functions (service role):
-- row level security is on and there is no policy. Purely additive.
create table if not exists public.portal_gus_cache (
  nip         text primary key check (nip ~ '^[0-9]{10}$'),
  znaleziono  boolean not null,
  dane        jsonb not null default '{}'::jsonb,   -- { nazwa, regon, adres } as the register gave them
  fetched_at  timestamptz not null default now()
);
alter table public.portal_gus_cache enable row level security;
revoke all on public.portal_gus_cache from anon, authenticated;
