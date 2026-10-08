-- Client profile: an employer signs in by a one-time e-mail link and sees its own firm(s).
-- Client accounts are deliberately NOT Supabase auth users: an auth session would also open
-- the tables of the other applications in this project that trust every signed-in user.
-- Everything a client sees goes through the `klient` edge function, filtered by its NIP.
create table if not exists public.klient_konta (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nip         text[] not null check (array_length(nip, 1) between 1 and 20),
  nazwa       text,
  aktywny     boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  text,
  last_login  timestamptz
);
-- one-time links and sessions; only the SHA-256 of a token is stored
create table if not exists public.klient_sesje (
  token_hash  text primary key,
  konto_id    uuid not null references public.klient_konta (id) on delete cascade,
  rodzaj      text not null check (rodzaj in ('link', 'sesja')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists klient_sesje_konto on public.klient_sesje (konto_id, rodzaj, created_at desc);
-- what clients did (sign-ins, downloads) — for the office and for RODO accountability
create table if not exists public.klient_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  konto_id  uuid,
  email     text,
  akcja     text not null,
  info      jsonb
);
alter table public.klient_konta enable row level security;
alter table public.klient_sesje enable row level security;
alter table public.klient_log   enable row level security;
revoke all on public.klient_konta, public.klient_sesje, public.klient_log from anon, authenticated;

-- old links and sessions are removed daily
select cron.unschedule(jobname) from cron.job where jobname = 'portal-klient-sesje';
select cron.schedule('portal-klient-sesje', '15 3 * * *', $$delete from public.klient_sesje where expires_at < now() - interval '1 day'$$);
