-- Telegram: creating a client's group from the portal (page klienci.html, function telegram-grupa).
--
-- The Bot API cannot create groups, so the function works as the office's technical Telegram account
-- (MTProto). Every creation is one row here: the plan that was confirmed (title, topics, messages),
-- each finished step, and the result. A run that stopped half-way is continued from its row instead of
-- creating a second group.
--
--   telegram_grupy                 log + state of every creation
--   klienci_baza.rachunek_zus      the client's individual ZUS contribution account (NRS, 26 digits)
--   portal_pracownicy.telegram_username   the staff member's public @name, for the welcome message
-- The template of a group and the daily cap live in portal_ustawienia under the key 'telegram_grupa'
-- (that table has no policies: service role only, so the key is written by the function alone).
-- Purely additive: nothing existing is altered.

create table if not exists public.telegram_grupy (
  id          uuid primary key default gen_random_uuid(),
  klient      text not null references public.klienci_baza (id) on update cascade,
  nip         text,
  tytul       text not null,
  chat_id     bigint,                               -- Bot API id of the group: -100<channel id>
  link        text,                                 -- invitation link exported after the creation
  status      text not null default 'w_toku' check (status in ('w_toku', 'gotowa', 'blad')),
  plan        jsonb not null default '{}'::jsonb,   -- what was confirmed: topics, messages, bots, staff
  kroki       jsonb not null default '{}'::jsonb,   -- finished steps: channel, topic ids, message ids, …
  ostrzezenia jsonb not null default '[]'::jsonb,
  blad        text,
  porzucono   boolean not null default false,       -- given up (a new creation was forced): never continued
  zajete_do   timestamptz,                          -- a run holds the row until then (one run at a time)
  utworzyl    text not null,                        -- staff e-mail from the verified session
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint telegram_grupy_rozmiar check (pg_column_size(plan) < 200000 and pg_column_size(kroki) < 20000 and char_length(tytul) <= 255)
);
create index if not exists telegram_grupy_klient on public.telegram_grupy (klient, created_at desc);
create index if not exists telegram_grupy_czas on public.telegram_grupy (created_at desc);
-- one creation in progress per client: two requests arriving together cannot both start
create unique index if not exists telegram_grupy_jedna_w_toku on public.telegram_grupy (klient) where status = 'w_toku' and not porzucono;

alter table public.telegram_grupy enable row level security;
drop policy if exists telegram_grupy_select on public.telegram_grupy;
create policy telegram_grupy_select on public.telegram_grupy for select to authenticated using (public.is_portal_admin());
revoke all on public.telegram_grupy from anon, authenticated;
-- the plan (message texts with the client's accounts) and the steps are read through the function only
grant select (id, klient, nip, tytul, chat_id, link, status, ostrzezenia, blad, porzucono, utworzyl, created_at, updated_at)
  on public.telegram_grupy to authenticated;

-- The client's individual ZUS account. Not added to the columns the browser may read (the column
-- grants of klienci_baza stay as they are): it is read and written through the function.
alter table public.klienci_baza add column if not exists rachunek_zus text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'klienci_baza_rachunek_zus_ok') then
    alter table public.klienci_baza add constraint klienci_baza_rachunek_zus_ok check (rachunek_zus is null or rachunek_zus ~ '^[0-9]{26}$');
  end if;
end $$;

-- The staff member's public Telegram name (without @). Administrators only, like the chat id:
-- it is not among the columns granted to `authenticated`.
alter table public.portal_pracownicy add column if not exists telegram_username text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'portal_pracownicy_tg_username_ok') then
    alter table public.portal_pracownicy add constraint portal_pracownicy_tg_username_ok check (telegram_username is null or telegram_username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$');
  end if;
end $$;
