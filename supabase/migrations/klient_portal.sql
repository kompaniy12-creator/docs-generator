-- Client profile, stage 2: requests from clients to the office and what the office shares with a client.
-- Purely additive. Everything here is read and written only by the `klient` edge function (service
-- role): RLS is on with no policies, anon and authenticated have nothing — the function is the only door.

-- ---------------------------------------------------------------- requests of clients
create table if not exists public.klient_zgloszenia (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  konto_id      uuid references public.klient_konta (id) on delete set null,
  email         text not null,                           -- the client account that wrote it
  nip           text not null check (nip ~ '^[0-9]{10}$'),
  firma         text,
  kategoria     text not null check (kategoria in ('kadry', 'ksiegowosc', 'inne')),
  rodzaj        text not null default 'pytanie' check (rodzaj in ('pytanie', 'zmiana_pracownika', 'dane_firmy', 'dokumenty_ksiegowe')),
  worker_id     uuid,                                    -- zatrudnienie_zgloszenia.id, for requests about one worker
  worker_name   text,
  temat         text not null check (char_length(temat) between 1 and 200),
  tresc         text not null check (char_length(tresc) between 1 and 4000),
  zalaczniki    jsonb not null default '[]'::jsonb,      -- [{n, nazwa, mime, rozmiar, path, sha256}] — path never leaves the function
  status        text not null default 'przyjete' check (status in ('przyjete', 'w_toku', 'zalatwione')),
  status_reczny boolean not null default false,          -- true: set by the office; false: follows the task
  odpowiedz     text check (odpowiedz is null or char_length(odpowiedz) <= 2000),
  odpowiedzial  text,                                    -- staff e-mail (never shown to the client)
  odpowiedz_at  timestamptz,
  zadanie_id    uuid,                                    -- portal_zadania.id
  assignee      text
);
create index if not exists klient_zgloszenia_nip on public.klient_zgloszenia (nip, created_at desc);
create index if not exists klient_zgloszenia_konto on public.klient_zgloszenia (konto_id, created_at desc);
alter table public.klient_zgloszenia enable row level security;
revoke all on public.klient_zgloszenia from anon, authenticated;

-- ---------------------------------------------------------------- what the office shares
-- A scan in Akta osobowe / a contract in Baza klientów is visible to the client only when its row
-- here says so. No row = not shared. Side tables, because akta_dokumenty and klienci_umowy belong to
-- other modules; no foreign keys on purpose (nothing of theirs is altered) — a flag whose document is
-- gone simply matches nothing.
create table if not exists public.akta_udostepnienia (
  dokument_id            uuid primary key,               -- akta_dokumenty.id
  udostepniony_klientowi boolean not null default false,
  zmienil                text not null,                  -- staff e-mail from the verified session
  zmieniono_at           timestamptz not null default now()
);
create table if not exists public.klienci_umowy_udostepnienia (
  umowa_id               uuid primary key,               -- klienci_umowy.id
  udostepniony_klientowi boolean not null default false,
  zmienil                text not null,
  zmieniono_at           timestamptz not null default now()
);
alter table public.akta_udostepnienia enable row level security;
alter table public.klienci_umowy_udostepnienia enable row level security;
revoke all on public.akta_udostepnienia, public.klienci_umowy_udostepnienia from anon, authenticated;

create index if not exists klient_log_konto_akcja on public.klient_log (konto_id, akcja, at desc);

-- private bucket for attachments of client requests; no storage policies on purpose — files go in
-- and out only through the function (magic-byte check on the way in, short-lived download links out)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('klient-zgloszenia', 'klient-zgloszenia', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
