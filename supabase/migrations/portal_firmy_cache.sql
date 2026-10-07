-- Company data fetched from rejestr.io (paid per request), kept so the same firm
-- is not paid for again within the cache period. Service role only: no policies.
create table if not exists public.portal_firmy_cache (
  nip        text primary key,
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.portal_firmy_cache enable row level security;
