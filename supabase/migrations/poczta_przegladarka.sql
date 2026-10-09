-- Poczta — mailbox browser (read-only view of every folder of the office mailboxes).
--
-- Nothing of the browsed mail is stored. The only trace is this access log: the browser lets staff read the
-- whole content of a mailbox, so the owner must be able to see who opened which message and who downloaded
-- which attachment (art. 5 ust. 2 and art. 32 RODO — accountability, control of access).
--   akcja  otwarcie | zalacznik | analiza   the audit proper (kept)
--          lista | foldery                  only counted for the per-person rate limit; dropped after a day
--   msg_hash  first 32 hex characters of SHA-256 of the Message-ID — identifies the message without its subject
-- Append-only for people: written by the function (service role); administrators may read; nobody else.
create table if not exists public.poczta_dostep (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  kto       text not null,                           -- staff e-mail from the verified session
  akcja     text not null check (akcja in ('otwarcie', 'zalacznik', 'analiza', 'lista', 'foldery')),
  skrzynka  text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  folder    text check (folder is null or char_length(folder) <= 300),
  uid       bigint,
  msg_hash  text check (msg_hash is null or msg_hash ~ '^[0-9a-f]{32}$'),
  czesc     text check (czesc is null or czesc ~ '^[0-9.]{1,60}$'),
  rozmiar   integer
);
create index if not exists poczta_dostep_kto on public.poczta_dostep (kto, at desc);
create index if not exists poczta_dostep_at on public.poczta_dostep (at desc);
alter table public.poczta_dostep enable row level security;
drop policy if exists poczta_dostep_select on public.poczta_dostep;
create policy poczta_dostep_select on public.poczta_dostep for select to authenticated using (public.is_portal_admin());
revoke all on public.poczta_dostep from anon, authenticated;
grant select on public.poczta_dostep to authenticated;

-- a message analysed on a person's request from the browser is neither "push" nor "poll"
alter table public.poczta_wiadomosci drop constraint if exists poczta_wiadomosci_droga_check;
alter table public.poczta_wiadomosci add constraint poczta_wiadomosci_droga_check check (droga in ('push', 'poll', 'test', 'reczna'));
