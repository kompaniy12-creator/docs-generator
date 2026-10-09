-- Zespół: profiles of the office's own staff (page zespol.html, function portal-admin).
--
-- ONE place that says who is who and who answers for what; modules that used to keep their own
-- person -> something maps (Telegram chats and the default HR person in the `zadania` settings, the
-- short names of caretakers in the clients sheet, the mail and SMS modules) read it from here.
--
--   portal_pracownicy             one row per person, keyed by the portal login e-mail (lower case);
--                                 the profile may exist BEFORE the account does
--   portal_pracownicy_publiczne   what every portal user may see (view, caller's own rights)
--   portal_pracownicy_historia    who changed a profile or somebody's access, and when (append-only)
--   portal_pracownik_po_aliasie() short name from the clients sheet -> e-mail of who handles it today
--   portal_pracownik_dzis()       e-mail -> e-mail of who stands in today (the deputy during an absence)
--   portal_pracownik_domyslny()   'kadry' | 'ksiegowosc' -> the default person for that kind of work
--
-- Access. Both an administrator and an ordinary portal user are the same database role
-- (`authenticated`), and column privileges cannot tell them apart. So the role is granted the safe
-- columns only (name, short names, position, departments, active, absence, deputy), rows are limited
-- to portal users by RLS, and everything else — phone, Telegram chat, mailboxes, responsibilities,
-- notes, every write — goes through the portal-admin function, which checks the administrator flag
-- against the auth server and uses the service role. There is no write path with the browser's key.
-- Purely additive: nothing existing is altered.
--
-- `odpowiada` (jsonb object, every key optional, unknown keys are dropped by the function):
--   domyslny_kadry       bool  system HR tasks (function zadania) and unassigned mail of the HR
--                              mailbox go to this person
--   domyslny_ksiegowosc  bool  the same for accounting
--   sms                  bool  may send SMS to clients (SMS module)
--   akta                 bool  keeps the personnel files (akta osobowe)
--   podpisy_weryfikacja  bool  verifies signed employment documents
--   uwagi                text  free note on the scope of duties (max 500 characters)
-- Who stands in for whom is the column `zastepca`, not a key here.

-- Short names are compared without case, spaces (also non-breaking) and dots: "Testowa A." = "testowa a".
create or replace function public.portal_alias_norm(a text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(a, ''), '[\s .]+', '', 'g'))
$$;

-- Is a person with this absence period away today (Warsaw date)? An open end means "until further notice".
create or replace function public.portal_nieobecny(p_od date, p_do date) returns boolean
language sql stable set search_path = '' as $$
  select (p_od is not null or p_do is not null)
     and (now() at time zone 'Europe/Warsaw')::date between coalesce(p_od, '-infinity'::date) and coalesce(p_do, 'infinity'::date)
$$;

create table if not exists public.portal_pracownicy (
  email         text primary key,                       -- portal login e-mail, lower case
  imie_nazwisko text not null default '',
  aliasy        text[] not null default '{}',           -- short names exactly as in the clients sheet, e.g. {"Testowa A."}
  stanowisko    text,
  telefon       text,                                   -- administrators only
  telegram_chat text,                                   -- administrators only; chat id for the portal's bot
  dzialy        text[] not null default '{}',           -- kadry, ksiegowosc, legalizacja, spolka, zarzad
  skrzynki      text[] not null default '{}',           -- office mailboxes the person handles
  odpowiada     jsonb not null default '{}'::jsonb,     -- see the header
  aktywny       boolean not null default true,          -- false: left the team; kept for history, receives nothing
  nieobecny_od  date,
  nieobecny_do  date,
  zastepca      text references public.portal_pracownicy (email) on update cascade on delete set null,
  notatki       text,                                   -- administrators only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text,                                   -- staff e-mail from the verified session (trigger)
  constraint portal_pracownicy_email_ok check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  constraint portal_pracownicy_dzialy_ok check (dzialy <@ array['kadry', 'ksiegowosc', 'legalizacja', 'spolka', 'zarzad']),
  constraint portal_pracownicy_telegram_ok check (telegram_chat is null or telegram_chat ~ '^-?[0-9]{4,20}$'),
  constraint portal_pracownicy_odpowiada_ok check (jsonb_typeof(odpowiada) = 'object' and pg_column_size(odpowiada) < 4000),
  constraint portal_pracownicy_zastepca_ok check (zastepca is null or zastepca <> email),
  constraint portal_pracownicy_nieobecnosc_ok check (nieobecny_od is null or nieobecny_do is null or nieobecny_od <= nieobecny_do),
  constraint portal_pracownicy_rozmiar check (
    char_length(imie_nazwisko) <= 120 and char_length(coalesce(stanowisko, '')) <= 120 and char_length(coalesce(telefon, '')) <= 30
    and char_length(coalesce(notatki, '')) <= 2000 and coalesce(array_length(aliasy, 1), 0) <= 20 and coalesce(array_length(skrzynki, 1), 0) <= 10)
);

-- Tidy the row, refuse a short name that another person already has (one short name = one person,
-- otherwise the routing by short name would be a guess), stamp who and when.
create or replace function public.portal_pracownicy_przed() returns trigger
language plpgsql set search_path = '' as $$
declare kto text; zajety text;
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'UPDATE' and new.email <> old.email then raise exception 'Adresu e-mail profilu nie można zmienić — utwórz nowy profil.' using errcode = 'P0001'; end if;
  new.zastepca := nullif(lower(btrim(coalesce(new.zastepca, ''))), '');
  new.imie_nazwisko := btrim(coalesce(new.imie_nazwisko, ''));
  new.aliasy := coalesce((select array_agg(a order by a) from (select distinct btrim(x) as a from unnest(new.aliasy) x where btrim(x) <> '') s), '{}');
  new.skrzynki := coalesce((select array_agg(a order by a) from (select distinct lower(btrim(x)) as a from unnest(new.skrzynki) x where btrim(x) <> '') s), '{}');
  new.dzialy := coalesce((select array_agg(a order by a) from (select distinct x as a from unnest(new.dzialy) x) s), '{}');
  select p.email || ' („' || a || '”)' into zajety
    from public.portal_pracownicy p, unnest(p.aliasy) a
   where p.email <> new.email
     and public.portal_alias_norm(a) in (select public.portal_alias_norm(n) from unnest(new.aliasy) n)
   limit 1;
  if zajety is not null then raise exception 'Ten skrót ma już inna osoba: %.', zajety using errcode = 'P0001'; end if;
  -- a direct session wins; the function (service role) passes the e-mail of the session it verified
  kto := nullif(auth.jwt() ->> 'email', '');
  new.updated_by := coalesce(lower(kto), nullif(new.updated_by, ''), 'system');
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists portal_pracownicy_przed on public.portal_pracownicy;
create trigger portal_pracownicy_przed before insert or update on public.portal_pracownicy
  for each row execute function public.portal_pracownicy_przed();

alter table public.portal_pracownicy enable row level security;
drop policy if exists portal_pracownicy_select on public.portal_pracownicy;
create policy portal_pracownicy_select on public.portal_pracownicy for select to authenticated using (public.is_portal_user());
revoke all on public.portal_pracownicy from anon, authenticated;
grant select (email, imie_nazwisko, aliasy, stanowisko, dzialy, aktywny, nieobecny_od, nieobecny_do, zastepca)
  on public.portal_pracownicy to authenticated;

-- What every portal user may see. Read with the caller's own rights, so the RLS above applies.
create or replace view public.portal_pracownicy_publiczne with (security_invoker = true) as
  select email, imie_nazwisko, aliasy, stanowisko, dzialy, aktywny, nieobecny_od, nieobecny_do, zastepca,
         public.portal_nieobecny(nieobecny_od, nieobecny_do) as nieobecny_dzis
    from public.portal_pracownicy;
revoke all on public.portal_pracownicy_publiczne from anon, authenticated;
grant select on public.portal_pracownicy_publiczne to authenticated;

-- ---------------------------------------------------------------- history
-- Service role only. Values of phone, Telegram chat and notes are never copied here — only the
-- fact that they changed. `dostep` rows are written by the portal-admin function.
create table if not exists public.portal_pracownicy_historia (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  email   text not null,                                  -- whose profile / access
  kto     text,                                           -- who changed it
  op      text not null check (op in ('dodano', 'zmieniono', 'usunieto', 'dostep')),
  zmiany  jsonb not null default '{}'::jsonb              -- {pole: {bylo, jest}} or {pole: "zmieniono"}
);
create index if not exists portal_pracownicy_historia_email on public.portal_pracownicy_historia (email, at desc);
alter table public.portal_pracownicy_historia enable row level security;
revoke all on public.portal_pracownicy_historia from anon, authenticated;

create or replace function public.portal_pracownicy_po() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb; n jsonb; z jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'DELETE' then
    insert into public.portal_pracownicy_historia (email, kto, op, zmiany)
    values (old.email, coalesce(nullif(auth.jwt() ->> 'email', ''), nullif(current_setting('portal.kto', true), '')), 'usunieto', jsonb_build_object('imie_nazwisko', old.imie_nazwisko));
    return old;
  end if;
  n := to_jsonb(new) - array['created_at', 'updated_at', 'updated_by'];
  if tg_op = 'INSERT' then
    insert into public.portal_pracownicy_historia (email, kto, op, zmiany)
    values (new.email, new.updated_by, 'dodano', jsonb_build_object('imie_nazwisko', new.imie_nazwisko, 'dzialy', to_jsonb(new.dzialy), 'aliasy', to_jsonb(new.aliasy)));
    return new;
  end if;
  o := to_jsonb(old) - array['created_at', 'updated_at', 'updated_by'];
  for k in select jsonb_object_keys(n) loop
    if (o -> k) is distinct from (n -> k) then
      z := z || jsonb_build_object(k, case when k in ('telefon', 'telegram_chat', 'notatki') then to_jsonb('zmieniono'::text)
                                           else jsonb_build_object('bylo', o -> k, 'jest', n -> k) end);
    end if;
  end loop;
  if z <> '{}'::jsonb then
    insert into public.portal_pracownicy_historia (email, kto, op, zmiany) values (new.email, new.updated_by, 'zmieniono', z);
  end if;
  return new;
end $$;
revoke all on function public.portal_pracownicy_po() from public, anon, authenticated;
drop trigger if exists portal_pracownicy_po on public.portal_pracownicy;
create trigger portal_pracownicy_po after insert or update or delete on public.portal_pracownicy
  for each row execute function public.portal_pracownicy_po();

-- ---------------------------------------------------------------- helpers for other modules
-- All three run with the caller's own rights: the service role sees every row, a portal user sees
-- the rows RLS allows (and the functions read safe columns only), anybody else gets NULL.

-- Who does this person's work today: the deputy while the person is away (when a deputy is set and
-- active), otherwise the person; NULL for an unknown or inactive person. One step only — a deputy's
-- own absence is not followed, so the answer never loops.
create or replace function public.portal_pracownik_dzis(p_email text) returns text
language sql stable set search_path = '' as $$
  select case when public.portal_nieobecny(p.nieobecny_od, p.nieobecny_do) and z.email is not null then z.email else p.email end
    from public.portal_pracownicy p
    left join public.portal_pracownicy z on z.email = p.zastepca and z.aktywny
   where p.email = lower(btrim(coalesce(p_email, ''))) and p.aktywny
$$;

-- Short name from the clients sheet ("Testowa A.") -> e-mail of who handles it today.
-- Case, spaces and dots do not matter; only active people; NULL when nobody has the short name.
create or replace function public.portal_pracownik_po_aliasie(p_alias text) returns text
language sql stable set search_path = '' as $$
  select public.portal_pracownik_dzis(p.email)
    from public.portal_pracownicy p
   where p.aktywny and public.portal_alias_norm(p_alias) <> ''
     and exists (select 1 from unnest(p.aliasy) a where public.portal_alias_norm(a) = public.portal_alias_norm(p_alias))
   order by p.email
   limit 1
$$;

-- The default person for a kind of work ('kadry' | 'ksiegowosc'), today. Reads `odpowiada`, which
-- ordinary portal users cannot see — service role only.
create or replace function public.portal_pracownik_domyslny(p_dzial text) returns text
language sql stable set search_path = '' as $$
  select public.portal_pracownik_dzis(p.email)
    from public.portal_pracownicy p
   where p.aktywny and p_dzial in ('kadry', 'ksiegowosc')
     and p.odpowiada -> ('domyslny_' || p_dzial) = 'true'::jsonb
   order by p.email
   limit 1
$$;

revoke all on function public.portal_alias_norm(text), public.portal_nieobecny(date, date),
                       public.portal_pracownik_dzis(text), public.portal_pracownik_po_aliasie(text),
                       public.portal_pracownik_domyslny(text) from public, anon, authenticated;
grant execute on function public.portal_alias_norm(text), public.portal_nieobecny(date, date),
                          public.portal_pracownik_dzis(text), public.portal_pracownik_po_aliasie(text) to authenticated, service_role;
grant execute on function public.portal_pracownik_domyslny(text) to service_role;
