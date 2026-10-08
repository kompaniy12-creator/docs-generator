-- Baza klientów: the office's own, lasting register of clients (page klienci.html, function klienci-baza).
--
-- portal_klienci is only a copy of the clients sheet and loses a row the moment it leaves the sheet.
-- These tables are keyed the same way (NIP, or 'nazwa:<name>' when the sheet has no NIP) but are never
-- deleted from: a client who left stays here with the date the service ended, the last register
-- snapshot and the contracts.
--
--   klienci_baza            one row per client: what the sheet last said + service status
--   klienci_status_historia every change of the service status (append-only)
--   klienci_rejestr         register snapshots (KRS through rejestr.io, or GUS for sole traders); a new
--                           row only when something changed, so the rows are the history of changes
--   klienci_umowy           scans of contracts with what was read from them  (+ bucket klienci-umowy)
--
-- Access: clients and register data — every portal user (read only; all writes go through the
-- klienci-baza function with the service role). Status history, contracts and their files — portal
-- administrators only: contracts carry fees and private data of sole traders.
-- Purely additive: nothing existing is altered.

create or replace function public.is_portal_admin() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'portal') = 'true', false)
     and coalesce((auth.jwt() -> 'app_metadata' ->> 'portal_admin') = 'true', false)
$$;

-- ---------------------------------------------------------------- clients
create table if not exists public.klienci_baza (
  id            text primary key,                 -- NIP (10 digits) or 'nazwa:<lower-case name>', as portal_klienci.id
  nip           text,
  nazwa         text not null,
  forma         text,
  opodatkowanie text,
  adres         text,
  miasto        text,
  opiekun       text,
  kadrowy       text,
  w_arkuszu     boolean not null default true,    -- false: the row is gone from the clients sheet
  arkusz_at     timestamptz,                      -- when it was last seen in the sheet
  brak_od       timestamptz,                      -- since when it is missing
  status        text not null default 'obslugiwany' check (status in ('obslugiwany', 'wstrzymany', 'zakonczony')),
  obsluga_od    date,
  koniec_od     date,                             -- the service ended on this day (required for 'zakonczony')
  zmienil       text,                             -- staff e-mail from the verified session (set by the function)
  zmieniono_at  timestamptz,
  rejestr_at    timestamptz,                      -- last attempt to read the register
  rejestr_blad  text,                             -- why the last attempt failed (null = fine)
  created_at    timestamptz not null default now(),
  constraint klienci_baza_id_ok check (id ~ '^[0-9]{10}$' or id like 'nazwa:%'),
  constraint klienci_baza_koniec check (status <> 'zakonczony' or koniec_od is not null)
);
create index if not exists klienci_baza_nip on public.klienci_baza (nip);
alter table public.klienci_baza enable row level security;
drop policy if exists klienci_baza_select on public.klienci_baza;
create policy klienci_baza_select on public.klienci_baza for select to authenticated using (public.is_portal_user());
revoke all on public.klienci_baza from anon, authenticated;
grant select on public.klienci_baza to authenticated;

create table if not exists public.klienci_status_historia (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  klient      text not null references public.klienci_baza (id) on update cascade,
  status      text not null check (status in ('obslugiwany', 'wstrzymany', 'zakonczony')),
  obsluga_od  date,
  koniec_od   date,
  powod       text,
  zmienil     text not null
);
create index if not exists klienci_status_historia_klient on public.klienci_status_historia (klient, created_at desc);
alter table public.klienci_status_historia enable row level security;
drop policy if exists klienci_status_historia_select on public.klienci_status_historia;
create policy klienci_status_historia_select on public.klienci_status_historia for select to authenticated using (public.is_portal_admin());
revoke all on public.klienci_status_historia from anon, authenticated;
grant select on public.klienci_status_historia to authenticated;

-- The only way the status changes: one transaction that updates the client and appends the history row.
-- Called by the klienci-baza function (service role) after it has checked the caller is an administrator;
-- p_kto is the e-mail from the verified session.
create or replace function public.klienci_ustaw_status(p_id text, p_status text, p_obsluga_od date, p_koniec_od date, p_powod text, p_kto text)
returns public.klienci_baza language plpgsql security definer set search_path = '' as $$
declare r public.klienci_baza;
begin
  if p_status not in ('obslugiwany', 'wstrzymany', 'zakonczony') then raise exception 'nieznany status'; end if;
  if p_status = 'zakonczony' and p_koniec_od is null then raise exception 'brak daty zakończenia obsługi'; end if;
  if coalesce(p_kto, '') = '' then raise exception 'brak osoby zmieniającej'; end if;
  update public.klienci_baza
     set status = p_status,
         obsluga_od = coalesce(p_obsluga_od, obsluga_od),
         koniec_od = case when p_status = 'zakonczony' then p_koniec_od else null end,
         zmienil = p_kto, zmieniono_at = now()
   where id = p_id returning * into r;
  if not found then raise exception 'nie ma takiego klienta'; end if;
  insert into public.klienci_status_historia (klient, status, obsluga_od, koniec_od, powod, zmienil)
  values (r.id, r.status, r.obsluga_od, r.koniec_od, nullif(left(coalesce(p_powod, ''), 1000), ''), p_kto);
  return r;
end $$;
revoke all on function public.klienci_ustaw_status(text, text, date, date, text, text) from public, anon, authenticated;
grant execute on function public.klienci_ustaw_status(text, text, date, date, text, text) to service_role;

-- What other modules need to know: is the client still served. Read with the caller's own rights.
create or replace view public.klienci_obsluga with (security_invoker = true) as
  select id, nip, nazwa, status, obsluga_od, koniec_od, w_arkuszu,
         not (status = 'zakonczony' and koniec_od <= current_date) as obslugiwany
    from public.klienci_baza;
revoke all on public.klienci_obsluga from anon, authenticated;
grant select on public.klienci_obsluga to authenticated;

-- ---------------------------------------------------------------- register snapshots
create table if not exists public.klienci_rejestr (
  id               uuid primary key default gen_random_uuid(),
  klient           text not null references public.klienci_baza (id) on update cascade,
  nip              text,
  fetched_at       timestamptz not null default now(),   -- when this state was first seen
  sprawdzono_at    timestamptz not null default now(),   -- when it was last confirmed unchanged
  zrodlo           text not null check (zrodlo in ('krs', 'gus')),
  znaleziono       boolean not null default true,
  krs              text,
  regon            text,
  nazwa            text,
  forma            text,
  data_rejestracji date,
  kapital          numeric,
  adres            text,
  organ            text,
  reprezentacja    text,                                  -- the rule of representation, as entered in KRS
  zarzad           jsonb not null default '[]'::jsonb,    -- [{imie, nazwisko, funkcja}]
  wspolnicy        jsonb not null default '[]'::jsonb,    -- [{imie, nazwisko, udzialy}]
  prokurenci       jsonb not null default '[]'::jsonb,    -- [{imie_nazwisko, rodzaj}]
  pkd              text,
  stan             text,                                  -- aktywna | w likwidacji | w upadłości | w restrukturyzacji | wykreślona | zawieszona
  zmiany           jsonb not null default '[]'::jsonb,    -- differences against the previous snapshot: [{pole, bylo, jest}]
  odcisk           text,                                  -- fingerprint of the compared fields
  dane             jsonb,                                 -- the answer of getFirma (or of GUS) in full
  surowe           jsonb                                  -- the register's own basic record, untouched
);
create index if not exists klienci_rejestr_klient on public.klienci_rejestr (klient, fetched_at desc);
alter table public.klienci_rejestr enable row level security;
drop policy if exists klienci_rejestr_select on public.klienci_rejestr;
create policy klienci_rejestr_select on public.klienci_rejestr for select to authenticated using (public.is_portal_user());
revoke all on public.klienci_rejestr from anon, authenticated;
grant select on public.klienci_rejestr to authenticated;

-- ---------------------------------------------------------------- contracts
create table if not exists public.klienci_umowy (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  uploaded_by    text,
  path           text not null unique,
  nazwa          text not null,
  rozmiar        int,
  mime           text check (mime is null or mime in ('application/pdf', 'image/jpeg', 'image/png')),
  status         text not null default 'nowy' check (status in ('nowy', 'analiza', 'przypisany', 'do_sprawdzenia', 'blad')),
  analiza_at     timestamptz,
  klient         text references public.klienci_baza (id) on update cascade,   -- null until assigned
  rodzaj         text check (rodzaj is null or rodzaj in ('ksiegowosc', 'kadry', 'powierzenie', 'aneks', 'pelnomocnictwo', 'upowaznienie', 'wypowiedzenie', 'inne')),
  podtyp         text,                                   -- e.g. UPL-1, ZUS PEL, KSeF
  obejmuje       text[] not null default '{}',           -- what the document covers: ksiegowosc, kadry, powierzenie
  data_zawarcia  date,
  kontrahent     text,                                   -- the client's name as written in the document
  kontrahent_nip text,
  kontrahent_krs text,
  reprezentanci  jsonb not null default '[]'::jsonb,     -- who signed for the client, as read: [{imie_nazwisko, funkcja}]
  obowiazuje_od  date,
  obowiazuje_do  date,
  bezterminowa   boolean,
  wypowiedzenie  text,                                   -- notice period, as read
  zakres         text,
  wynagrodzenie  text,                                   -- as read; administrators only, like the whole table
  podpisy        text check (podpisy is null or podpisy in ('obie_strony', 'tylko_klient', 'tylko_biuro', 'brak', 'nieczytelne')),
  stron          int,
  ai             jsonb,
  uwagi          text,
  sprawdzil      text,
  sprawdzono_at  timestamptz,
  constraint klienci_umowy_path_ok check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' and path !~ '\.\.' and path like id::text || '/%'),
  constraint klienci_umowy_obejmuje_ok check (obejmuje <@ array['ksiegowosc', 'kadry', 'powierzenie']),
  constraint klienci_umowy_przypisany check (status <> 'przypisany' or klient is not null)
);
create index if not exists klienci_umowy_klient on public.klienci_umowy (klient, rodzaj);
create index if not exists klienci_umowy_status on public.klienci_umowy (status, created_at desc);
alter table public.klienci_umowy enable row level security;
drop policy if exists klienci_umowy_admin on public.klienci_umowy;
create policy klienci_umowy_admin on public.klienci_umowy for all to authenticated
  using (public.is_portal_admin()) with check (public.is_portal_admin());
revoke all on public.klienci_umowy from anon;

-- who uploaded / checked is taken from the session; a person can neither move the file nor forge the reading
create or replace function public.klienci_umowy_audit() returns trigger language plpgsql set search_path = '' as $$
declare me text := nullif(auth.jwt() ->> 'email', '');
begin
  if me is null then return new; end if; -- service role (the klienci-baza function)
  if tg_op = 'INSERT' then
    new.uploaded_by := me; new.created_at := now(); new.status := 'nowy'; new.analiza_at := null;
    new.ai := null; new.sprawdzil := null; new.sprawdzono_at := null;
  else
    new.id := old.id; new.path := old.path; new.uploaded_by := old.uploaded_by; new.created_at := old.created_at;
    new.rozmiar := old.rozmiar; new.mime := old.mime; new.ai := old.ai; new.analiza_at := old.analiza_at;
    if new.status = 'analiza' then new.status := old.status; end if;
    new.sprawdzil := me; new.sprawdzono_at := now();
  end if;
  return new;
end $$;
drop trigger if exists klienci_umowy_audit on public.klienci_umowy;
create trigger klienci_umowy_audit before insert or update on public.klienci_umowy for each row execute function public.klienci_umowy_audit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('klienci-umowy', 'klienci-umowy', false, 25165824, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists klienci_umowy_obj_insert on storage.objects;
create policy klienci_umowy_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'klienci-umowy' and public.is_portal_admin() and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]+$');
drop policy if exists klienci_umowy_obj_select on storage.objects;
create policy klienci_umowy_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'klienci-umowy' and public.is_portal_admin());
drop policy if exists klienci_umowy_obj_delete on storage.objects;
create policy klienci_umowy_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'klienci-umowy' and public.is_portal_admin());
