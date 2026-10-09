-- Umowy z klientami — generator (page umowy.html, function umowy).
--
-- The office's contracts with its clients for accounting services: the new prepaid contracts, the old-style
-- ones and the annexes that move an existing client to prepayment. Contracts carry fees, so everything here
-- is for portal administrators only; every write goes through the `umowy` function with the service role.
--
--   umowy_szablony      versions of the DOCX templates (files in the private bucket umowy-wzory)
--   umowy_numeracja     the last number issued per family (SPZOO / JDG) and year
--   umowy_dokumenty     the register of generated documents — a number is taken only by a FINAL generation,
--                       never reused, and a cancelled document keeps its number (the gap stays visible)
--   umowy_zdarzenia     what happened to a document or a setting, who did it (append-only)
--   umowy_cennik        the price list as data (+ umowy_cennik_historia, written by a trigger)
--   umowy_sady          registry courts known so far (learned from the administrator, never guessed)
--   umowy_migracja      hand-set state of a client in the move to prepayment
--
-- Generated files: DOCX in the private bucket umowy-wygenerowane (service role only); the PDF copy and
-- later the signed copy live in the contracts module (bucket klienci-umowy + a row of klienci_umowy).
-- Purely additive: nothing existing is altered.

-- ---------------------------------------------------------------- buckets (no policies: service role only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('umowy-wzory', 'umowy-wzory', false, 8388608, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
       ('umowy-wygenerowane', 'umowy-wygenerowane', false, 8388608, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- templates
create table if not exists public.umowy_szablony (
  id             uuid primary key default gen_random_uuid(),
  rodzaj         text not null check (rodzaj in ('nowa_spzoo', 'nowa_jdg', 'stara_spzoo', 'stara_jdg', 'aneks_spzoo', 'aneks_jdg')),
  nazwa          text not null,
  wersja         int  not null check (wersja > 0),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  path           text not null unique check (path ~ '^[a-z_]+/v[0-9]+-[0-9a-f]{12}\.docx$'),
  rozmiar        int  not null,
  placeholdery   jsonb not null default '[]'::jsonb,   -- [{ nazwa, ile }]
  aktywny        boolean not null default true,
  do_sprawdzenia text,                                  -- e.g. 'odtworzony z PDF — do sprawdzenia'; null = confirmed
  uwagi          text,
  uploaded_by    text not null,
  uploaded_at    timestamptz not null default now(),
  unique (rodzaj, wersja)
);
create unique index if not exists umowy_szablony_aktywny on public.umowy_szablony (rodzaj) where aktywny;
alter table public.umowy_szablony enable row level security;
drop policy if exists umowy_szablony_select on public.umowy_szablony;
create policy umowy_szablony_select on public.umowy_szablony for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_szablony from anon, authenticated;
grant select on public.umowy_szablony to authenticated;

-- ---------------------------------------------------------------- numbering
create table if not exists public.umowy_numeracja (
  rodzina      text not null check (rodzina in ('SPZOO', 'JDG')),
  rok          int  not null check (rok between 2020 and 2100),
  ostatni      int  not null default 0 check (ostatni >= 0),   -- the last number issued; the next one is ostatni + 1
  zmienil      text,
  zmieniono_at timestamptz,
  primary key (rodzina, rok)
);
alter table public.umowy_numeracja enable row level security;
drop policy if exists umowy_numeracja_select on public.umowy_numeracja;
create policy umowy_numeracja_select on public.umowy_numeracja for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_numeracja from anon, authenticated;
grant select on public.umowy_numeracja to authenticated;
-- contracts issued before the generator: 11/SPZOO/2026 and 36/JDG/2026 were the last ones
insert into public.umowy_numeracja (rodzina, rok, ostatni, zmienil, zmieniono_at)
values ('SPZOO', 2026, 11, 'migracja', now()), ('JDG', 2026, 36, 'migracja', now())
on conflict (rodzina, rok) do nothing;

-- ---------------------------------------------------------------- register of generated documents
create table if not exists public.umowy_dokumenty (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  kto            text not null,                          -- staff e-mail from the verified session
  rodzaj         text not null check (rodzaj in ('nowa_spzoo', 'nowa_jdg', 'stara_spzoo', 'stara_jdg', 'aneks_spzoo', 'aneks_jdg')),
  rodzina        text not null check (rodzina in ('SPZOO', 'JDG')),
  rok            int,
  numer          int,                                    -- contracts: the number in the family and year
  aneks_nr       int,                                    -- annexes: the number of the annex to umowa_numer
  numer_pelny    text not null,                          -- '12/SPZOO/2026' | 'Aneks nr 1 do umowy 5/SPZOO/2026'
  umowa_numer    text,                                   -- annexes: the contract being changed
  umowa_data     date,
  klient         text references public.klienci_baza (id) on update cascade,   -- null: a firm not (yet) in the clients base
  klient_nazwa   text not null,
  klient_nip     text,
  data           date not null,                          -- the date written in the document
  szablon        uuid references public.umowy_szablony (id),
  szablon_wersja int,
  szablon_sha256 text,
  dane           jsonb not null default '{}'::jsonb,     -- the form as generated: values, their sources, the forecast
  kwota          numeric,                                -- first monthly rate, net (new contracts)
  docx_path      text,
  docx_sha256    text,
  docx_rozmiar   int,
  umowa_id       uuid,                                   -- the row of klienci_umowy holding the PDF / the signed copy
  status         text not null default 'wygenerowana' check (status in ('wygenerowana', 'wyslana', 'podpisana', 'anulowana')),
  status_at      timestamptz not null default now(),
  status_kto     text,
  uwagi          text,
  constraint umowy_dokumenty_numer check ((aneks_nr is null and numer is not null and rok is not null) or (aneks_nr is not null and numer is null and umowa_numer is not null))
);
create unique index if not exists umowy_dokumenty_nr on public.umowy_dokumenty (rodzina, rok, numer) where numer is not null;
create unique index if not exists umowy_dokumenty_aneks on public.umowy_dokumenty (rodzina, umowa_numer, aneks_nr) where aneks_nr is not null;
create index if not exists umowy_dokumenty_klient on public.umowy_dokumenty (klient, created_at desc);
alter table public.umowy_dokumenty enable row level security;
drop policy if exists umowy_dokumenty_select on public.umowy_dokumenty;
create policy umowy_dokumenty_select on public.umowy_dokumenty for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_dokumenty from anon, authenticated;
grant select on public.umowy_dokumenty to authenticated;

-- The only way a number is taken: one transaction that moves the counter (or, for an annex, takes the next
-- annex number of that contract) and writes the register row. Called by the `umowy` function (service role)
-- after it has checked the caller is an administrator and the document can be filled completely.
-- p: { kto, rodzaj, rodzina, rok, data, klient, klient_nazwa, klient_nip, szablon, szablon_wersja,
--      szablon_sha256, dane, kwota, umowa_numer, umowa_data, aneks_nr }   (aneks_nr: optional, never lower
--      than the next free one — for annexes signed before the generator existed)
create or replace function public.umowy_zarejestruj(p jsonb)
returns public.umowy_dokumenty language plpgsql security definer set search_path = '' as $$
declare
  r public.umowy_dokumenty;
  v_rodzaj text := p ->> 'rodzaj';
  v_rodzina text := p ->> 'rodzina';
  v_rok int := (p ->> 'rok')::int;
  v_numer int; v_aneks int; v_wolny int; v_pelny text;
  v_umowa text := nullif(btrim(coalesce(p ->> 'umowa_numer', '')), '');
begin
  if coalesce(p ->> 'kto', '') = '' then raise exception 'brak osoby generującej'; end if;
  if v_rodzina not in ('SPZOO', 'JDG') then raise exception 'nieznana rodzina numeracji'; end if;
  if v_rodzaj like 'aneks\_%' then
    if v_umowa is null then raise exception 'brak numeru umowy, do której jest aneks'; end if;
    perform pg_advisory_xact_lock(hashtextextended('umowy_aneks:' || v_rodzina || ':' || v_umowa, 0));
    select coalesce(max(aneks_nr), 0) + 1 into v_wolny from public.umowy_dokumenty where rodzina = v_rodzina and umowa_numer = v_umowa and aneks_nr is not null;
    v_aneks := coalesce((p ->> 'aneks_nr')::int, v_wolny);
    if v_aneks < v_wolny then raise exception 'numer aneksu % jest już użyty — najbliższy wolny to %', v_aneks, v_wolny; end if;
    v_pelny := 'Aneks nr ' || v_aneks || ' do umowy ' || v_umowa;
  else
    if v_rok is null then raise exception 'brak roku numeracji'; end if;
    insert into public.umowy_numeracja as n (rodzina, rok, ostatni) values (v_rodzina, v_rok, 1)
    on conflict (rodzina, rok) do update set ostatni = n.ostatni + 1
    returning ostatni into v_numer;
    v_pelny := v_numer || '/' || v_rodzina || '/' || v_rok;
  end if;
  insert into public.umowy_dokumenty (kto, rodzaj, rodzina, rok, numer, aneks_nr, numer_pelny, umowa_numer, umowa_data, klient, klient_nazwa, klient_nip,
                                      data, szablon, szablon_wersja, szablon_sha256, dane, kwota, status_kto)
  values (p ->> 'kto', v_rodzaj, v_rodzina, case when v_aneks is null then v_rok end, v_numer, v_aneks, v_pelny, v_umowa, nullif(p ->> 'umowa_data', '')::date,
          nullif(p ->> 'klient', ''), left(p ->> 'klient_nazwa', 300), nullif(p ->> 'klient_nip', ''), (p ->> 'data')::date,
          nullif(p ->> 'szablon', '')::uuid, (p ->> 'szablon_wersja')::int, p ->> 'szablon_sha256', coalesce(p -> 'dane', '{}'::jsonb),
          nullif(p ->> 'kwota', '')::numeric, p ->> 'kto')
  returning * into r;
  return r;
end $$;
revoke all on function public.umowy_zarejestruj(jsonb) from public, anon, authenticated;
grant execute on function public.umowy_zarejestruj(jsonb) to service_role;

-- The administrator corrects the counter (e.g. contracts issued by hand in the meantime). It can never go
-- below a number the register already holds — a number is not issued twice.
create or replace function public.umowy_numeracja_ustaw(p_rodzina text, p_rok int, p_ostatni int, p_kto text)
returns public.umowy_numeracja language plpgsql security definer set search_path = '' as $$
declare r public.umowy_numeracja; v_max int;
begin
  if coalesce(p_kto, '') = '' then raise exception 'brak osoby zmieniającej'; end if;
  if p_ostatni is null or p_ostatni < 0 then raise exception 'nieprawidłowy numer'; end if;
  perform 1 from public.umowy_numeracja where rodzina = p_rodzina and rok = p_rok for update;
  select coalesce(max(numer), 0) into v_max from public.umowy_dokumenty where rodzina = p_rodzina and rok = p_rok and numer is not null;
  if p_ostatni < v_max then raise exception 'w rejestrze jest już numer % — licznik nie może być niższy', v_max; end if;
  insert into public.umowy_numeracja as n (rodzina, rok, ostatni, zmienil, zmieniono_at) values (p_rodzina, p_rok, p_ostatni, p_kto, now())
  on conflict (rodzina, rok) do update set ostatni = excluded.ostatni, zmienil = excluded.zmienil, zmieniono_at = excluded.zmieniono_at
  returning * into r;
  return r;
end $$;
revoke all on function public.umowy_numeracja_ustaw(text, int, int, text) from public, anon, authenticated;
grant execute on function public.umowy_numeracja_ustaw(text, int, int, text) to service_role;

create table if not exists public.umowy_zdarzenia (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  kto        text not null,
  dokument   uuid,
  zdarzenie  text not null,       -- wygenerowano | pdf | status | podpisany | pobrano | szablon | numeracja | cennik | sad | migracja | blad
  szczegoly  jsonb
);
create index if not exists umowy_zdarzenia_dok on public.umowy_zdarzenia (dokument, at desc);
alter table public.umowy_zdarzenia enable row level security;
drop policy if exists umowy_zdarzenia_select on public.umowy_zdarzenia;
create policy umowy_zdarzenia_select on public.umowy_zdarzenia for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_zdarzenia from anon, authenticated;
grant select on public.umowy_zdarzenia to authenticated;

-- ---------------------------------------------------------------- price list
create table if not exists public.umowy_cennik (
  id           uuid primary key default gen_random_uuid(),
  rodzina      text not null check (rodzina in ('SPZOO', 'JDG')),
  grupa        text not null,                 -- heading of the price list the item stands under
  kod          text,                          -- what the calculator uses the item for: zapisy | zapis_kolejny | vat_jpk | srodek_trwaly | uop | uz | roznice_kursowe | …
  nazwa        text not null,
  jednostka    text,
  prog         int,                           -- kod = 'zapisy': the band (up to this many entries; 0 = no documents)
  cena         numeric check (cena is null or cena >= 0),   -- net, PLN; null when the price is not a plain number
  cena_opis    text,                          -- as printed when it is not a plain number: 'od 200,00', 'indywidualnie'
  stala        boolean not null default false,              -- a recurring service: offered in the forecast calculator
  kolejnosc    int not null default 0,
  aktywna      boolean not null default true,
  zmienil      text,
  zmieniono_at timestamptz not null default now(),
  constraint umowy_cennik_cena check (cena is not null or coalesce(cena_opis, '') <> '')
);
create index if not exists umowy_cennik_rodzina on public.umowy_cennik (rodzina, kolejnosc);
alter table public.umowy_cennik enable row level security;
drop policy if exists umowy_cennik_select on public.umowy_cennik;
create policy umowy_cennik_select on public.umowy_cennik for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_cennik from anon, authenticated;
grant select on public.umowy_cennik to authenticated;

create table if not exists public.umowy_cennik_historia (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  kto      text,
  op       text not null,
  pozycja  uuid not null,
  bylo     jsonb,
  jest     jsonb
);
alter table public.umowy_cennik_historia enable row level security;
drop policy if exists umowy_cennik_historia_select on public.umowy_cennik_historia;
create policy umowy_cennik_historia_select on public.umowy_cennik_historia for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_cennik_historia from anon, authenticated;
grant select on public.umowy_cennik_historia to authenticated;

create or replace function public.umowy_cennik_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.umowy_cennik_historia (kto, op, pozycja, bylo) values (old.zmienil, 'usunięcie', old.id, to_jsonb(old));
    return old;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(new) - 'zmienil' - 'zmieniono_at' = to_jsonb(old) - 'zmienil' - 'zmieniono_at' then return new; end if;
  insert into public.umowy_cennik_historia (kto, op, pozycja, bylo, jest)
  values (new.zmienil, case when tg_op = 'INSERT' then 'dodanie' else 'zmiana' end, new.id, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
drop trigger if exists umowy_cennik_log on public.umowy_cennik;
create trigger umowy_cennik_log after insert or update or delete on public.umowy_cennik for each row execute function public.umowy_cennik_log();

-- ---------------------------------------------------------------- registry courts
create table if not exists public.umowy_sady (
  id         uuid primary key default gen_random_uuid(),
  nazwa      text not null unique,          -- as written in a contract: court, division
  kod        text unique,                   -- prefix of the file reference of that division, e.g. 'PO.VIII'
  powiaty    text[] not null default '{}',  -- TERYT codes of counties for which an administrator confirmed this court
  dodal      text not null,
  created_at timestamptz not null default now()
);
alter table public.umowy_sady enable row level security;
drop policy if exists umowy_sady_select on public.umowy_sady;
create policy umowy_sady_select on public.umowy_sady for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_sady from anon, authenticated;
grant select on public.umowy_sady to authenticated;
-- the one court the office's own templates and contracts name (its own firm and Poznań clients, county 3064)
insert into public.umowy_sady (nazwa, kod, powiaty, dodal)
values ('SĄD REJONOWY POZNAŃ - NOWE MIASTO I WILDA W POZNANIU, VIII WYDZIAŁ GOSPODARCZY KRAJOWEGO REJESTRU SĄDOWEGO', 'PO.VIII', array['3064'], 'migracja')
on conflict (nazwa) do nothing;

-- ---------------------------------------------------------------- move of old clients to prepayment
create table if not exists public.umowy_migracja (
  klient       text primary key references public.klienci_baza (id) on update cascade,
  stan         text not null check (stan in ('przedplata', 'pomin', 'auto')),   -- set by hand: already prepaid | leave out | back to automatic
  uwagi        text,
  zmienil      text not null,
  zmieniono_at timestamptz not null default now()
);
alter table public.umowy_migracja enable row level security;
drop policy if exists umowy_migracja_select on public.umowy_migracja;
create policy umowy_migracja_select on public.umowy_migracja for select to authenticated using (public.is_portal_admin());
revoke all on public.umowy_migracja from anon, authenticated;
grant select on public.umowy_migracja to authenticated;
