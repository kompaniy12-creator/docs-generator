-- Client profile: the client sets a password at the first sign-in (one-time link) and uses it
-- afterwards. Only a salted PBKDF2 hash is stored; wrong attempts lock the account for a while.
alter table public.klient_konta
  add column if not exists haslo_hash text,
  add column if not exists haslo_salt text,
  add column if not exists haslo_ustawione timestamptz,
  add column if not exists bledne int not null default 0,
  add column if not exists blokada_do timestamptz;
-- a session opened by a one-time link may set a new password (first sign-in, forgotten password)
alter table public.klient_sesje add column if not exists z_linku boolean not null default false;
