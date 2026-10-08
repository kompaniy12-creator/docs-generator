-- Current KRS extracts (PDF, base64) fetched from rejestr.io — the source of PESEL numbers
-- for the generators. Fetched once per company, refreshed on request. Service role only.
create table if not exists public.portal_odpisy_cache (
  krs        text primary key,
  pdf        text not null,
  fetched_at timestamptz not null default now()
);
alter table public.portal_odpisy_cache enable row level security;
revoke all on public.portal_odpisy_cache from anon, authenticated;
