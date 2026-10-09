-- Komunikacja z klientami: prywatne subskrypcje bota Telegram i rozsyłki (page rozsylka.html,
-- functions komunikacja and tg-bot).
--
--   klient_komunikacja      per-client switches (today one: may automatic notices still go to the group?)
--   klient_zaproszenia_tg   invitation links https://t.me/<bot>?start=<token>. The token itself is never
--                           stored: only its SHA-256 and the random salt it is derived from
--                           (token = HMAC-SHA256(secret KOMUNIKACJA_SECRET, salt)); a copy of this table
--                           alone opens nothing.
--   klient_subskrypcje      a Telegram user who pressed START with a valid link: the private chat with the
--                           bot, tied to one client (or to a member of staff — for test messages)
--   klient_zgody            consents to commercial information (art. 398 Prawa komunikacji elektronicznej),
--                           append-only: the newest row for a client / channel / subscriber is what counts
--   tg_updates, tg_limity   idempotency of the webhook (update_id) and its rate limits
--   rozsylki                a broadcast: content per language, recipients, channels, approval, schedule
--   rozsylka_odbiorcy       one row per recipient and channel — the queue and the delivery log in one;
--                           unique (rozsylka, kanal, adres): nobody gets the same broadcast twice per channel
--   rozsylka_segmenty       saved recipient filters;  rozsylka_szablony  saved texts
--
-- Access. Subscribers are contact data of the clients' people (Telegram identity): rows are read by the
-- sections that talk to clients — Kadry and Księgowość ('onboarding') — and by administrators; the chat
-- and user ids and everything about invitation tokens are not readable from the browser at all. Every
-- write goes through the functions (service role). anon has nothing.
-- Purely additive: nothing existing is altered.

create or replace function public.komunikacja_moze() returns boolean
language sql stable set search_path = '' as $$
  select public.has_portal_section('kadry') or public.has_portal_section('onboarding')
$$;
revoke all on function public.komunikacja_moze() from public, anon;
grant execute on function public.komunikacja_moze() to authenticated, service_role;

-- ---------------------------------------------------------------- per-client switches
create table if not exists public.klient_komunikacja (
  klient           text primary key references public.klienci_baza (id) on update cascade on delete cascade,
  grupa_dozwolona  boolean not null default false,   -- true: automatic notices may still be posted to the client's GROUP
  zmienil          text not null,
  zmieniono_at     timestamptz not null default now()
);
alter table public.klient_komunikacja enable row level security;
drop policy if exists klient_komunikacja_select on public.klient_komunikacja;
create policy klient_komunikacja_select on public.klient_komunikacja for select to authenticated using (public.komunikacja_moze());
revoke all on public.klient_komunikacja from anon, authenticated;
grant select on public.klient_komunikacja to authenticated;

-- ---------------------------------------------------------------- invitations
create table if not exists public.klient_zaproszenia_tg (
  id          uuid primary key default gen_random_uuid(),
  klient      text references public.klienci_baza (id) on update cascade on delete cascade,
  pracownik   text,                                 -- staff e-mail: a personal link for test messages
  token_hash  text not null unique,                 -- SHA-256 (hex) of the token
  sol         text not null,                        -- random; the token is derived from it with the function's secret
  created_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  max_uzyc    int,                                  -- null = no limit (the counter still runs)
  uzycia      int not null default 0,
  revoked_at  timestamptz,
  revoked_by  text,
  constraint klient_zaproszenia_tg_czyje check ((klient is null) <> (pracownik is null)),
  constraint klient_zaproszenia_tg_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint klient_zaproszenia_tg_max check (max_uzyc is null or max_uzyc between 1 and 1000)
);
create index if not exists klient_zaproszenia_tg_klient on public.klient_zaproszenia_tg (klient) where revoked_at is null;
create index if not exists klient_zaproszenia_tg_prac on public.klient_zaproszenia_tg (pracownik) where revoked_at is null;
alter table public.klient_zaproszenia_tg enable row level security;
revoke all on public.klient_zaproszenia_tg from anon, authenticated;   -- service role only

-- ---------------------------------------------------------------- subscribers
create table if not exists public.klient_subskrypcje (
  id               uuid primary key default gen_random_uuid(),
  klient           text references public.klienci_baza (id) on update cascade on delete cascade,
  nip              text,
  pracownik        text,                            -- staff e-mail (test recipient), instead of a client
  tg_user_id       bigint not null,
  chat_id          bigint not null,                 -- the private chat = the user's id
  imie             text,                            -- as given by Telegram
  nazwisko         text,
  username         text,
  language_code    text,                            -- interface language reported by Telegram
  jezyk            text not null default 'pl' check (jezyk in ('pl', 'ru', 'uk')),
  rola             text check (rola in ('wlasciciel', 'ksiegowy', 'inna')),   -- set by staff
  subscribed_at    timestamptz not null default now(),
  zaproszenie      uuid references public.klient_zaproszenia_tg (id) on delete set null,
  aktywna          boolean not null default true,
  blocked_at       timestamptz,                     -- the user blocked the bot
  unsubscribed_at  timestamptz,                     -- /stop, or switched off by staff
  wylaczyl         text,                            -- 'uzytkownik' or the staff e-mail
  last_delivery_at timestamptz,
  zgoda_marketing  boolean not null default false,  -- commercial information allowed (art. 398 PKE)
  zgoda_at         timestamptz,
  zgoda_zrodlo     text,
  zgoda_kto        text,
  constraint klient_subskrypcje_czyja check ((klient is null) <> (pracownik is null)),
  constraint klient_subskrypcje_prywatny check (chat_id > 0 and tg_user_id > 0),
  constraint klient_subskrypcje_rozmiar check (char_length(coalesce(imie, '')) <= 100 and char_length(coalesce(nazwisko, '')) <= 100
    and char_length(coalesce(username, '')) <= 64 and char_length(coalesce(language_code, '')) <= 16)
);
create unique index if not exists klient_subskrypcje_klient_user on public.klient_subskrypcje (klient, tg_user_id) where klient is not null;
create unique index if not exists klient_subskrypcje_prac_user on public.klient_subskrypcje (pracownik, tg_user_id) where pracownik is not null;
create index if not exists klient_subskrypcje_user on public.klient_subskrypcje (tg_user_id);
alter table public.klient_subskrypcje enable row level security;
drop policy if exists klient_subskrypcje_select on public.klient_subskrypcje;
create policy klient_subskrypcje_select on public.klient_subskrypcje for select to authenticated using (public.komunikacja_moze());
revoke all on public.klient_subskrypcje from anon, authenticated;
-- every column except the Telegram ids
grant select (id, klient, nip, pracownik, imie, nazwisko, username, language_code, jezyk, rola, subscribed_at, aktywna, blocked_at,
              unsubscribed_at, wylaczyl, last_delivery_at, zgoda_marketing, zgoda_at, zgoda_zrodlo, zgoda_kto)
  on public.klient_subskrypcje to authenticated;

-- ---------------------------------------------------------------- consents (append-only)
create table if not exists public.klient_zgody (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  klient      text not null references public.klienci_baza (id) on update cascade on delete cascade,
  kanal       text not null check (kanal in ('telegram', 'sms', 'email')),
  subskrypcja uuid references public.klient_subskrypcje (id) on delete cascade,   -- telegram: whose consent
  zgoda       boolean not null,                     -- false = withdrawn
  zrodlo      text not null,                        -- where the consent comes from: "umowa § 9", "e-mail z 2026-10-01", …
  data        date not null,                        -- the day it was given / withdrawn
  kto         text not null,                        -- staff e-mail that recorded it
  constraint klient_zgody_zrodlo check (char_length(btrim(zrodlo)) between 3 and 300),
  constraint klient_zgody_tg check ((kanal = 'telegram') = (subskrypcja is not null))
);
create index if not exists klient_zgody_klient on public.klient_zgody (klient, kanal, created_at desc);
alter table public.klient_zgody enable row level security;
drop policy if exists klient_zgody_select on public.klient_zgody;
create policy klient_zgody_select on public.klient_zgody for select to authenticated using (public.komunikacja_moze());
revoke all on public.klient_zgody from anon, authenticated;
grant select on public.klient_zgody to authenticated;

-- ---------------------------------------------------------------- webhook: idempotency and limits
create table if not exists public.tg_updates (
  update_id bigint primary key,
  at        timestamptz not null default now()
);
alter table public.tg_updates enable row level security;
revoke all on public.tg_updates from anon, authenticated;

create table if not exists public.tg_limity (
  klucz text not null,
  slot  bigint not null,
  n     int not null default 0,
  primary key (klucz, slot)
);
alter table public.tg_limity enable row level security;
revoke all on public.tg_limity from anon, authenticated;

-- true: this update has not been seen before (and now it has). Telegram repeats an update until it gets 200.
create or replace function public.tg_update_nowy(p_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_id is null then return false; end if;
  delete from public.tg_updates where at < now() - interval '14 days';
  insert into public.tg_updates (update_id) values (p_id) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.tg_update_nowy(bigint) from public, anon, authenticated;
grant execute on function public.tg_update_nowy(bigint) to service_role;

-- true: still under p_max events for this key in the current window of p_okno_s seconds (and counted).
create or replace function public.tg_limit(p_klucz text, p_max int, p_okno_s int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s bigint := floor(extract(epoch from now()) / greatest(p_okno_s, 1)); ok boolean;
begin
  if coalesce(p_klucz, '') = '' or p_max < 1 then return false; end if;
  delete from public.tg_limity where slot < s - 2 and klucz = p_klucz;
  insert into public.tg_limity as l (klucz, slot, n) values (p_klucz, s, 1)
  on conflict (klucz, slot) do update set n = l.n + 1 where l.n + 1 <= p_max
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.tg_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.tg_limit(text, int, int) to service_role;

-- /start <token>: one transaction that checks the invitation and ties the Telegram user to its client.
-- wynik: ok | juz (already subscribed — nothing counted) | zly | wygasl | cofniety | limit | pracownik
--        (a member of staff pressed a client's link: staff are never subscribed as a client's person)
create or replace function public.tg_subskrybuj(p_hash text, p_user bigint, p_imie text, p_nazwisko text, p_username text, p_lang text, p_jezyk text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  z public.klient_zaproszenia_tg;
  s public.klient_subskrypcje;
  v_nazwa text; v_nip text; v_jezyk text := case when p_jezyk in ('pl', 'ru', 'uk') then p_jezyk else 'pl' end;
begin
  if p_user is null or p_user <= 0 or coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('wynik', 'zly'); end if;
  select * into z from public.klient_zaproszenia_tg where token_hash = p_hash for update;
  if not found then return jsonb_build_object('wynik', 'zly'); end if;
  if z.revoked_at is not null then return jsonb_build_object('wynik', 'cofniety'); end if;
  if z.expires_at <= now() then return jsonb_build_object('wynik', 'wygasl'); end if;

  if z.pracownik is not null then
    select * into s from public.klient_subskrypcje where pracownik = z.pracownik and tg_user_id = p_user;
    if found and s.aktywna and s.blocked_at is null then return jsonb_build_object('wynik', 'juz', 'pracownik', z.pracownik, 'jezyk', s.jezyk); end if;
    if z.max_uzyc is not null and z.uzycia >= z.max_uzyc then return jsonb_build_object('wynik', 'limit'); end if;
    -- one Telegram account per member of staff: an older one is switched off
    update public.klient_subskrypcje set aktywna = false, unsubscribed_at = now(), wylaczyl = 'zastapiona' where pracownik = z.pracownik and tg_user_id <> p_user and aktywna;
    insert into public.klient_subskrypcje as k (pracownik, tg_user_id, chat_id, imie, nazwisko, username, language_code, jezyk, zaproszenie)
    values (z.pracownik, p_user, p_user, left(p_imie, 100), left(p_nazwisko, 100), left(p_username, 64), left(p_lang, 16), 'pl', z.id)
    on conflict (pracownik, tg_user_id) where pracownik is not null do update
      set aktywna = true, blocked_at = null, unsubscribed_at = null, wylaczyl = null, subscribed_at = now(), zaproszenie = excluded.zaproszenie,
          imie = excluded.imie, nazwisko = excluded.nazwisko, username = excluded.username, language_code = excluded.language_code;
    update public.klient_zaproszenia_tg set uzycia = uzycia + 1 where id = z.id;
    return jsonb_build_object('wynik', 'ok', 'pracownik', z.pracownik, 'jezyk', 'pl');
  end if;

  if exists (select 1 from public.klient_subskrypcje where pracownik is not null and tg_user_id = p_user and aktywna) then
    return jsonb_build_object('wynik', 'pracownik');
  end if;
  select nazwa, nip into v_nazwa, v_nip from public.klienci_baza where id = z.klient;
  select * into s from public.klient_subskrypcje where klient = z.klient and tg_user_id = p_user;
  if found and s.aktywna and s.blocked_at is null then
    return jsonb_build_object('wynik', 'juz', 'klient', z.klient, 'nazwa', v_nazwa, 'jezyk', s.jezyk);
  end if;
  if z.max_uzyc is not null and z.uzycia >= z.max_uzyc then return jsonb_build_object('wynik', 'limit'); end if;
  insert into public.klient_subskrypcje as k (klient, nip, tg_user_id, chat_id, imie, nazwisko, username, language_code, jezyk, zaproszenie)
  values (z.klient, v_nip, p_user, p_user, left(p_imie, 100), left(p_nazwisko, 100), left(p_username, 64), left(p_lang, 16), v_jezyk, z.id)
  on conflict (klient, tg_user_id) where klient is not null do update
    set aktywna = true, blocked_at = null, unsubscribed_at = null, wylaczyl = null, subscribed_at = now(), zaproszenie = excluded.zaproszenie,
        imie = excluded.imie, nazwisko = excluded.nazwisko, username = excluded.username, language_code = excluded.language_code;
  update public.klient_zaproszenia_tg set uzycia = uzycia + 1 where id = z.id;
  return jsonb_build_object('wynik', 'ok', 'klient', z.klient, 'nazwa', v_nazwa,
    'jezyk', (select jezyk from public.klient_subskrypcje where klient = z.klient and tg_user_id = p_user));
end $$;
revoke all on function public.tg_subskrybuj(text, bigint, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tg_subskrybuj(text, bigint, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------- broadcasts
create table if not exists public.rozsylki (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  autor           text not null,                    -- staff e-mail from the verified session
  tytul           text not null,                    -- internal
  typ             text not null default 'serwisowa' check (typ in ('serwisowa', 'marketingowa')),
  status          text not null default 'szkic' check (status in ('szkic', 'do_akceptacji', 'zaplanowana', 'w_trakcie', 'zakonczona', 'wstrzymana', 'anulowana')),
  tresc           jsonb not null default '{}'::jsonb,   -- texts per language, buttons, SMS and e-mail variants
  kanaly          jsonb not null default '{"bot": true}'::jsonb,
  strategia       text not null default 'bot' check (strategia in ('bot', 'bot_sms', 'bot_mail', 'bot_grupa', 'wszystkie')),
  odbiorcy        jsonb not null default '{"tryb": "wszyscy"}'::jsonb,
  zalacznik       jsonb,                            -- phase 2: {path, nazwa, typ, rozmiar, file_id}
  tresc_hash      text,                             -- of everything that reaches a recipient; a test is valid for one hash
  test            jsonb,                            -- {at, hash, kto, wyniki}
  liczba          int,                              -- clients with at least one delivery, when submitted
  zgloszono_at    timestamptz,
  akceptowal      text,
  akceptowano_at  timestamptz,
  samoakceptacja  boolean not null default false,   -- the author approved it himself (no other administrator)
  zaplanowana_na  timestamptz,                      -- null = as soon as approved
  mimo_ciszy      boolean not null default false,   -- may be sent outside the allowed hours (administrator)
  start_at        timestamptz,
  koniec_at       timestamptz,
  wstrzymana_do   timestamptz,                      -- the provider asked to slow down (429 retry_after)
  bledy_z_rzedu   int not null default 0,
  powod           text,                             -- why it stopped / was rejected / cancelled
  constraint rozsylki_rozmiar check (char_length(tytul) between 1 and 200 and pg_column_size(tresc) < 200000 and pg_column_size(odbiorcy) < 200000)
);
create index if not exists rozsylki_status on public.rozsylki (status, zaplanowana_na);
alter table public.rozsylki enable row level security;
drop policy if exists rozsylki_select on public.rozsylki;
create policy rozsylki_select on public.rozsylki for select to authenticated using (public.komunikacja_moze());
revoke all on public.rozsylki from anon, authenticated;
grant select on public.rozsylki to authenticated;

create table if not exists public.rozsylka_odbiorcy (
  id             uuid primary key default gen_random_uuid(),
  rozsylka       uuid not null references public.rozsylki (id) on delete cascade,
  klient         text not null,                     -- client id at the time (no foreign key: the log outlives changes of id)
  nip            text,
  nazwa          text not null,
  kanal          text not null check (kanal in ('bot', 'grupa', 'sms', 'mail', 'brak')),   -- 'brak' = not reachable by the chosen strategy
  adres          text not null,                     -- chat id / phone / e-mail; for 'brak' the client id
  subskrypcja    uuid,
  jezyk          text,
  status         text not null default 'kolejka' check (status in ('kolejka', 'wysylanie', 'wyslano', 'blad', 'pominieto', 'niepewny')),
  powod          text,
  proby          int not null default 0,
  nastepna_proba timestamptz not null default now(),
  pobrano_at     timestamptz,
  wyslano_at     timestamptz,
  tg_message_id  bigint,
  ref            text,                              -- id of the row in sms_wiadomosci / the SMTP message id
  constraint rozsylka_odbiorcy_raz unique (rozsylka, kanal, adres)
);
create index if not exists rozsylka_odbiorcy_kolejka on public.rozsylka_odbiorcy (nastepna_proba) where status = 'kolejka';
create index if not exists rozsylka_odbiorcy_rozsylka on public.rozsylka_odbiorcy (rozsylka, status);
alter table public.rozsylka_odbiorcy enable row level security;
drop policy if exists rozsylka_odbiorcy_select on public.rozsylka_odbiorcy;
create policy rozsylka_odbiorcy_select on public.rozsylka_odbiorcy for select to authenticated using (public.komunikacja_moze());
revoke all on public.rozsylka_odbiorcy from anon, authenticated;
-- without the address for Telegram rows the browser needs nothing more; the function masks what it shows
grant select (id, rozsylka, klient, nip, nazwa, kanal, jezyk, status, powod, proby, nastepna_proba, wyslano_at, tg_message_id)
  on public.rozsylka_odbiorcy to authenticated;

-- Takes up to p_limit queued rows of running broadcasts for one worker (two workers never get the same
-- row). A row left in 'wysylanie' by a worker that died is NOT sent again: nobody knows whether the
-- message went out, so it becomes 'niepewny' and a person decides.
create or replace function public.rozsylka_pobierz(p_limit int, p_cisza boolean)
returns setof public.rozsylka_odbiorcy language plpgsql security definer set search_path = '' as $$
begin
  update public.rozsylka_odbiorcy set status = 'niepewny', powod = 'przerwane w trakcie wysyłania — nie wiadomo, czy wiadomość wyszła'
   where status = 'wysylanie' and pobrano_at < now() - interval '10 minutes';
  return query
  update public.rozsylka_odbiorcy o set status = 'wysylanie', pobrano_at = now()
   where o.id in (
     select x.id from public.rozsylka_odbiorcy x join public.rozsylki r on r.id = x.rozsylka
      where x.status = 'kolejka' and x.nastepna_proba <= now() and r.status = 'w_trakcie'
        and (r.wstrzymana_do is null or r.wstrzymana_do <= now()) and (not p_cisza or r.mimo_ciszy)
      order by x.nastepna_proba, x.id
      limit greatest(1, least(coalesce(p_limit, 1), 100))
      for update of x skip locked)
  returning o.*;
end $$;
revoke all on function public.rozsylka_pobierz(int, boolean) from public, anon, authenticated;
grant execute on function public.rozsylka_pobierz(int, boolean) to service_role;

create table if not exists public.rozsylka_segmenty (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  autor      text not null,
  nazwa      text not null check (char_length(nazwa) between 1 and 120),
  odbiorcy   jsonb not null check (pg_column_size(odbiorcy) < 100000)
);
alter table public.rozsylka_segmenty enable row level security;
drop policy if exists rozsylka_segmenty_select on public.rozsylka_segmenty;
create policy rozsylka_segmenty_select on public.rozsylka_segmenty for select to authenticated using (public.komunikacja_moze());
revoke all on public.rozsylka_segmenty from anon, authenticated;
grant select on public.rozsylka_segmenty to authenticated;

create table if not exists public.rozsylka_szablony (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  autor      text not null,
  nazwa      text not null check (char_length(nazwa) between 1 and 120),
  typ        text not null default 'serwisowa' check (typ in ('serwisowa', 'marketingowa')),
  tresc      jsonb not null check (pg_column_size(tresc) < 200000)
);
alter table public.rozsylka_szablony enable row level security;
drop policy if exists rozsylka_szablony_select on public.rozsylka_szablony;
create policy rozsylka_szablony_select on public.rozsylka_szablony for select to authenticated using (public.komunikacja_moze());
revoke all on public.rozsylka_szablony from anon, authenticated;
grant select on public.rozsylka_szablony to authenticated;

-- ---------------------------------------------------------------- knowledge base
-- Read on 2026-10-09: Prawo komunikacji elektronicznej, Dz.U. 2024 poz. 1221 (art. 398, 400) in the ELI
-- register; none of its amending acts (Dz.U. 2025 poz. 637, 820; 2026 poz. 252, 815, 1296) touches
-- art. 398 or 400. Telegram: Privacy Policy and Bot Developer Terms as published on telegram.org that day.
insert into public.portal_wiedza (id, dzial, temat, tresc, podstawa, eli, zweryfikowano, kolejnosc) values
('rozsylka-typ-serwisowa-marketingowa', 'Rozsyłki i bot Telegram', 'Wiadomość serwisowa a marketingowa',
 $$Każda rozsyłka ma typ. SERWISOWA dotyczy wykonywania umowy o obsługę: terminy, dokumenty, prośby o dane, zmiany organizacyjne (np. zmiana kanału powiadomień, godziny pracy biura, zmiana przepisów, która wymaga działania klienta). Nie jest informacją handlową i nie wymaga zgody z art. 398. MARKETINGOWA to wszystko, co bezpośrednio lub pośrednio promuje usługi lub wizerunek biura: oferty, promocje, nowe usługi, zaproszenia na płatne szkolenia, prośby o polecenie. Zakaz z art. 398 ust. 1 obejmuje używanie telekomunikacyjnych urządzeń końcowych „w szczególności w ramach korzystania z usług komunikacji interpersonalnej” — a więc także komunikatorów (Telegram), SMS i e-mail. Rozsyłka marketingowa trafia wyłącznie do odbiorców z zapisaną zgodą (źródło i data); nigdy do grupy klienta, bo w grupie jest wiele osób, a zgodę wyraża konkretny użytkownik końcowy. Wiadomość mieszana (informacja serwisowa z dopiskiem o ofercie) jest marketingowa.$$,
 'art. 398 ust. 1 Prawa komunikacji elektronicznej; art. 2 pkt 2 ustawy o świadczeniu usług drogą elektroniczną', 'DU/2024/1221', '2026-10-09', 720),
('rozsylka-zgoda-zapis', 'Rozsyłki i bot Telegram', 'Jak zapisuje się zgodę marketingową',
 $$Zgodę zapisuje pracownik w portalu: kanał (Telegram — konkretny subskrybent; SMS i e-mail — klient), źródło (np. „umowa § 9”, „e-mail z 2026-10-01”, „formularz”), data i kto zapisał. Zgoda musi być dobrowolna, konkretna, świadoma i jednoznaczna, a jej wycofanie równie łatwe jak wyrażenie (art. 4 pkt 11 i art. 7 RODO stosowane odpowiednio na podstawie art. 400). Samo naciśnięcie START w bocie nie jest zgodą na informację handlową: subskrybent zapisuje się na powiadomienia o obsłudze. Rejestr zgód jest tylko do dopisywania — liczy się najnowszy wpis; wycofanie to nowy wpis. Bez zapisanej zgody system pomija odbiorcę rozsyłki marketingowej i podaje powód.$$,
 'art. 398 ust. 1–2, art. 400 Prawa komunikacji elektronicznej; art. 4 pkt 11, art. 7 RODO', 'DU/2024/1221', '2026-10-09', 721),
('bot-dane-subskrybenta', 'Rozsyłki i bot Telegram', 'Jakie dane subskrybenta bota przechowuje biuro i po co',
 $$Po naciśnięciu START z linku biura bot poznaje i zapisuje: identyfikator użytkownika Telegram (jest też identyfikatorem prywatnego czatu), imię, nazwisko i nazwę użytkownika w takim brzmieniu, jakie podaje Telegram, język interfejsu, wybrany język wiadomości, datę zapisu, z którego zaproszenia (czyli którego klienta) pochodzi zapis, daty wypisania lub zablokowania bota oraz datę ostatniego doręczenia. Bot nie poznaje numeru telefonu ani listy kontaktów. Cel: doręczanie powiadomień o obsłudze osobie wskazanej przez klienta i możliwość sprawdzenia, kto je otrzymuje. Podstawa: art. 6 ust. 1 lit. b RODO (klient będący osobą fizyczną) albo art. 6 ust. 1 lit. f RODO (osoba działająca za spółkę: uzasadniony interes — sprawna komunikacja w wykonaniu umowy; prawo sprzeciwu z art. 21 RODO realizuje komenda /stop). Treści wiadomości, które użytkownik sam pisze do bota, nie są zapisywane. Retencja (propozycja do zatwierdzenia przez właściciela; automatyczne usuwanie nie jest jeszcze wdrożone): subskrypcja aktywna — przez czas obsługi klienta; po /stop, zablokowaniu bota albo zakończeniu obsługi wiersz zostaje jako dowód doręczeń przez 12 miesięcy, potem do usunięcia; dziennik rozsyłek — 3 lata, do końca roku kalendarzowego (termin przedawnienia roszczeń związanych z prowadzeniem działalności gospodarczej, art. 118 Kodeksu cywilnego, t.j. Dz.U. 2026 poz. 795).$$,
 'art. 5 ust. 1 lit. b, c, e, art. 6 ust. 1 lit. b i f, art. 13, art. 21 RODO (rozporządzenie (UE) 2016/679); art. 118 Kodeksu cywilnego', null, '2026-10-09', 722),
('bot-telegram-odbiorca-danych', 'Rozsyłki i bot Telegram', 'Telegram jako odbiorca danych; państwa trzecie',
 $$Według Polityki prywatności Telegrama (telegram.org/privacy, odczyt 2026-10-09) usługę świadczy Telegram Messenger Inc., który sam określa się jako administrator danych swoich użytkowników; ma przedstawiciela w UE (European Data Protection Office, art. 27 RODO). Dane użytkowników z EOG i Wielkiej Brytanii są według tej polityki przechowywane w centrach danych w Niderlandach; mogą być udostępniane spółkom grupy: Telegram Group Inc. i Telegraph Inc. (Brytyjskie Wyspy Dziewicze) oraz Telegram FZ-LLC (Dubaj, ZEA) na podstawie standardowych klauzul umownych. Telegram nie zawiera z twórcami botów umowy powierzenia (art. 28 RODO) — jest niezależnym administratorem, a regulamin dla twórców botów wymaga, by bot miał własną, łatwo dostępną politykę prywatności i nie wysyłał niezamówionych wiadomości. Skutki: (1) treść wiadomości wysyłanej przez bota przechodzi przez serwery Telegrama — nie wolno w niej podawać danych pracowników klienta ponad inicjały, rodzaj dokumentu i datę, żadnych numerów PESEL, dokumentów, kwot wynagrodzeń; szczegóły idą e-mailem lub w profilu klienta; (2) klauzula informacyjna biura musi wymieniać Telegram jako odbiorcę danych i informować o możliwym przekazaniu poza EOG; (3) nieznane pozostaje, gdzie fizycznie przetwarzane są wiadomości botów i czy lokalizacja „Niderlandy” dotyczy także ich — Telegram tego nie publikuje.$$,
 'art. 13 ust. 1 lit. e i f, art. 28, art. 44–46 RODO (rozporządzenie (UE) 2016/679)', null, '2026-10-09', 723)
on conflict (id) do update set dzial = excluded.dzial, temat = excluded.temat, tresc = excluded.tresc,
  podstawa = excluded.podstawa, eli = excluded.eli, zweryfikowano = excluded.zweryfikowano, kolejnosc = excluded.kolejnosc;
