-- Baza klientów: the Telegram audit — does every client in service have its group with the office and
-- are the office's bots in it. Filled by the klienci-baza function (actions telegram_sprawdz and
-- telegram_cron); the function only ever READS from Telegram. Purely additive.
--
--   klienci_telegram            the last result per client, and since when its status holds
--   klienci_telegram_historia   status changes only (append-only)
-- Settings (required bots, the state of the daily run) live in portal_ustawienia under the key
-- 'klienci_telegram'. Chat ids and group titles are for administrators; every portal user gets
-- only the status of each client, through the function.

create table if not exists public.klienci_telegram (
  klient        text primary key references public.klienci_baza (id) on update cascade,
  chat_id       text,
  status        text not null check (status in ('ok', 'brak_grupy', 'zly_id', 'brak_czatu', 'bot_usuniety', 'przeniesiona', 'bot_bez_praw', 'brak_bota', 'blad')),
  od            timestamptz not null default now(),   -- since when this status holds
  sprawdzono_at timestamptz not null default now(),
  tytul         text,
  typ           text,
  czlonkow      int,
  bot_status    text,
  boty          jsonb not null default '[]'::jsonb,    -- bots among the group's administrators: [{id, username, nazwa}]
  brak_botow    jsonb not null default '[]'::jsonb,    -- names of required bots that are missing
  nowe_id       text,                                  -- after a migration to a supergroup: the id to enter
  blad          text,
  uwagi         jsonb not null default '[]'::jsonb
);
alter table public.klienci_telegram enable row level security;
drop policy if exists klienci_telegram_select on public.klienci_telegram;
create policy klienci_telegram_select on public.klienci_telegram for select to authenticated using (public.is_portal_admin());
revoke all on public.klienci_telegram from anon, authenticated;
grant select on public.klienci_telegram to authenticated;

create table if not exists public.klienci_telegram_historia (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  klient      text not null references public.klienci_baza (id) on update cascade,
  bylo        text,
  jest        text not null,
  opis        text
);
create index if not exists klienci_telegram_historia_klient on public.klienci_telegram_historia (klient, created_at desc);
create index if not exists klienci_telegram_historia_czas on public.klienci_telegram_historia (created_at desc);
alter table public.klienci_telegram_historia enable row level security;
drop policy if exists klienci_telegram_historia_select on public.klienci_telegram_historia;
create policy klienci_telegram_historia_select on public.klienci_telegram_historia for select to authenticated using (public.is_portal_admin());
revoke all on public.klienci_telegram_historia from anon, authenticated;
grant select on public.klienci_telegram_historia to authenticated;
