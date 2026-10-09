-- Poczta: triage of e-mail arriving at the office mailboxes (page poczta.html, function poczta).
--
--   poczta_skrzynki    per mailbox: where the fallback IMAP poll stopped (UIDVALIDITY + last UID), when it
--                      last ran and with what result, and the lock that keeps two runs apart.
--                      Service role only (no policies).
--   poczta_wiadomosci  one row per message: who wrote, when, the subject, the FIRST 600 CHARACTERS of the
--                      cleaned text (quotes and signature cut; PESEL-like numbers, document, card and
--                      account numbers masked before storing), names / types / sizes of attachments, what
--                      the model proposed, the matched client, the person responsible and the state.
--
-- What is deliberately NOT kept (art. 5 ust. 1 lit. c RODO — data minimisation): the full text of the
-- message and the contents of attachments. The original stays in the mailbox, where staff read it as before;
-- 600 characters are enough to recognise the message and to check the proposal against it.
--
-- A message is identified by its Message-ID within a mailbox, so the same mail delivered by the forwarder
-- (push, no UID) and later seen by the fallback poll (UID) is one row.
--
-- Who reads: kadry rows — section Kadry; ksiegowosc rows — section Księgowość ('onboarding');
-- administrators — everything. All writes go through the function (service role).
-- Purely additive: nothing existing is altered.

create table if not exists public.poczta_skrzynki (
  skrzynka     text primary key check (skrzynka in ('kadry', 'ksiegowosc')),
  uidvalidity  bigint,
  last_uid     bigint,
  last_run     timestamptz,
  last_ok      timestamptz,
  last_error   text,
  lock_at      timestamptz,                        -- a poll is running since
  info         jsonb not null default '{}'::jsonb  -- counters of the last run (numbers only)
);
alter table public.poczta_skrzynki enable row level security;
revoke all on public.poczta_skrzynki from anon, authenticated;

create table if not exists public.poczta_wiadomosci (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  skrzynka      text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  droga         text not null check (droga in ('push', 'poll', 'test')),  -- how the message reached the portal
  uidvalidity   bigint,
  uid           bigint,                             -- null until the poll has seen a pushed message
  message_id    text not null check (char_length(message_id) <= 320),
  watek         text check (watek is null or char_length(watek) <= 320),  -- first id of the thread
  odwolania     text[] not null default '{}',       -- In-Reply-To + References (ids only)
  data          timestamptz,
  od_nazwa      text,
  od_adres      text,
  do_adresy     text[] not null default '{}',
  temat         text check (temat is null or char_length(temat) <= 300),
  fragment      text check (fragment is null or char_length(fragment) <= 600),
  rozmiar       integer,
  zalaczniki    jsonb not null default '[]'::jsonb, -- [{nazwa, typ, rozmiar}] — never the contents
  flagi         jsonb not null default '{}'::jsonb, -- auto / odbicie / lista / wlasna / podejrzany / obciete
  analiza_start timestamptz,                        -- set when the message was queued for the model (daily cap)
  ai            jsonb,                              -- the validated answer of the model
  ai_at         timestamptz,
  kategoria     text,
  pilnosc       text check (pilnosc is null or pilnosc in ('niska', 'normalna', 'wysoka')),
  wymaga        boolean,
  klient_id     text,                               -- as klienci_baza.id
  klient_nip    text check (klient_nip is null or klient_nip ~ '^[0-9]{10}$'),
  klient_nazwa  text,
  klient_jak    text check (klient_jak is null or klient_jak in ('adres', 'domena', 'nip')),
  assignee      text,
  status        text not null default 'nowa' check (status in ('nowa', 'zadanie', 'bez_dzialania', 'pominieta', 'blad')),
  powod         text,
  zadanie_id    uuid references public.portal_zadania (id) on delete set null,
  sprawdzil     text,                               -- staff e-mail from the verified session
  sprawdzono_at timestamptz,
  constraint poczta_wiadomosci_msg unique (skrzynka, message_id)
);
create unique index if not exists poczta_wiadomosci_uid on public.poczta_wiadomosci (skrzynka, uidvalidity, uid) where uid is not null;
create index if not exists poczta_wiadomosci_lista on public.poczta_wiadomosci (skrzynka, created_at desc);
create index if not exists poczta_wiadomosci_watek on public.poczta_wiadomosci (skrzynka, watek);
create index if not exists poczta_wiadomosci_od on public.poczta_wiadomosci (skrzynka, od_adres, created_at desc);

alter table public.poczta_wiadomosci enable row level security;
drop policy if exists poczta_wiadomosci_select on public.poczta_wiadomosci;
create policy poczta_wiadomosci_select on public.poczta_wiadomosci for select to authenticated using (
  public.is_portal_admin()
  or (skrzynka = 'kadry' and public.has_portal_section('kadry'))
  or (skrzynka = 'ksiegowosc' and public.has_portal_section('onboarding'))
);
revoke all on public.poczta_wiadomosci from anon, authenticated;
grant select on public.poczta_wiadomosci to authenticated;

-- One poll per mailbox at a time: takes the lock unless a run younger than 5 minutes holds it.
create or replace function public.poczta_lock(p_skrzynka text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.poczta_skrzynki (skrzynka) values (p_skrzynka) on conflict do nothing;
  update public.poczta_skrzynki set lock_at = now()
   where skrzynka = p_skrzynka and (lock_at is null or lock_at < now() - interval '5 minutes');
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.poczta_lock(text) from public, anon, authenticated;
grant execute on function public.poczta_lock(text) to service_role;
