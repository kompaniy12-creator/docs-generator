-- Poczta — the mail client proper: several signatures per person, templates and contacts shared by the people of a
-- mailbox, and the queue of "Wyślij później". Purely additive. All four tables are read and written only by the
-- `poczta` function (service role), which checks the caller's section for the mailbox: RLS is on, there are no
-- policies and no grants for people.
--
--   poczta_sygnatury  a person's signatures (cleaned HTML); `domyslna` lists the mailboxes where it is the default.
--   poczta_szablony   canned replies of a mailbox (cleaned HTML, places {klient} and {imie} filled in by the page).
--   poczta_kontakty   the address book of a mailbox: address, name, firm, a short note.
--   poczta_kolejka    one row per scheduled send: when, who, which DRAFT (the message itself stays in the mailbox's
--                     Drafts folder — body and attachments are not copied here), the subject and recipients (the same
--                     that the send log keeps), the state. `klucz` is the send key: one message cannot go out twice.
create table if not exists public.poczta_sygnatury (
  id         uuid primary key default gen_random_uuid(),
  kto        text not null check (char_length(kto) <= 200),
  nazwa      text not null check (char_length(nazwa) between 1 and 60),
  html       text not null check (char_length(html) <= 4000),
  domyslna   text[] not null default '{}' check (domyslna <@ array['kadry', 'ksiegowosc']),
  updated_at timestamptz not null default now()
);
create index if not exists poczta_sygnatury_kto on public.poczta_sygnatury (kto);
alter table public.poczta_sygnatury enable row level security;
revoke all on public.poczta_sygnatury from anon, authenticated;

create table if not exists public.poczta_szablony (
  id         uuid primary key default gen_random_uuid(),
  skrzynka   text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  nazwa      text not null check (char_length(nazwa) between 1 and 80),
  temat      text check (temat is null or char_length(temat) <= 250),
  html       text not null check (char_length(html) <= 20000),
  utworzyl   text not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
create index if not exists poczta_szablony_skrzynka on public.poczta_szablony (skrzynka);
alter table public.poczta_szablony enable row level security;
revoke all on public.poczta_szablony from anon, authenticated;

create table if not exists public.poczta_kontakty (
  id         uuid primary key default gen_random_uuid(),
  skrzynka   text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  adres      text not null check (adres = lower(adres) and char_length(adres) <= 254 and adres ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nazwa      text check (nazwa is null or char_length(nazwa) <= 120),
  firma      text check (firma is null or char_length(firma) <= 160),
  notatka    text check (notatka is null or char_length(notatka) <= 300),
  utworzyl   text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (skrzynka, adres)
);
alter table public.poczta_kontakty enable row level security;
revoke all on public.poczta_kontakty from anon, authenticated;

create table if not exists public.poczta_kolejka (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kto        text not null,                       -- staff e-mail from the verified session
  skrzynka   text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  kiedy      timestamptz not null,
  stan       text not null default 'czeka' check (stan in ('czeka', 'wysylanie', 'wyslano', 'blad', 'anulowano')),
  klucz      uuid not null unique,
  szkic_id   uuid not null,                       -- X-Portal-Szkic of the draft in the mailbox
  temat      text check (temat is null or char_length(temat) <= 250),
  odbiorcy   text[] not null default '{}',
  opcje      jsonb not null default '{}'::jsonb check (pg_column_size(opcje) < 4000),
  blad       text check (blad is null or char_length(blad) <= 300),
  proba_at   timestamptz,
  koniec_at  timestamptz
);
create index if not exists poczta_kolejka_stan on public.poczta_kolejka (stan, kiedy);
create index if not exists poczta_kolejka_skrzynka on public.poczta_kolejka (skrzynka, kiedy desc);
alter table public.poczta_kolejka enable row level security;
revoke all on public.poczta_kolejka from anon, authenticated;

-- the access log tells a message fetched ahead (the next one on the list) from a message a person opened
alter table public.poczta_dostep drop constraint if exists poczta_dostep_akcja_check;
alter table public.poczta_dostep add constraint poczta_dostep_akcja_check check (akcja in ('otwarcie', 'zalacznik', 'analiza', 'lista', 'foldery', 'zmiana', 'wstepne'));

-- Schedule (run once by the owner; every 5 minutes):
--   select cron.schedule('portal-poczta-kolejka', '*/5 * * * *', $$select public.portal_cron_call('poczta', 'wyslij_zaplanowane')$$);
