-- Poczta — writing from the portal (sending, drafts, changes in a mailbox).
--
--   poczta_wyslane   the log of every send attempt: who, when, from which mailbox, to whom, the SUBJECT (stored —
--                    the owner must be able to see what left the office; the body and attachments are not),
--                    Message-ID, size, number of attachments, result. A row is written BEFORE the mail server is
--                    asked; `klucz` (the page's key of that send) is unique, so one message cannot go out twice.
--                    Append-only for people: written by the function; administrators may read.
--   poczta_podpisy   a person's signature per mailbox (cleaned HTML). Service role only.
-- Drafts are NOT kept here: they live in the mailbox's own Drafts folder, visible from any mail program.
create table if not exists public.poczta_wyslane (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  kto           text not null,                      -- staff e-mail from the verified session
  skrzynka      text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  klucz         uuid not null unique,
  odbiorcy_do   text[] not null default '{}',
  odbiorcy_dw   text[] not null default '{}',
  odbiorcy_udw  text[] not null default '{}',
  temat         text check (temat is null or char_length(temat) <= 250),
  temat_hash    text,
  message_id    text,
  rozmiar       integer,
  zalaczniki    integer not null default 0,
  odp_tryb      text check (odp_tryb is null or odp_tryb in ('reply', 'forward')),
  odp_hash      text check (odp_hash is null or odp_hash ~ '^[0-9a-f]{32}$'),  -- the message answered / forwarded (hash of its Message-ID)
  wynik         text not null default 'wysylanie' check (wynik in ('wysylanie', 'wyslano', 'blad')),
  blad          text
);
create index if not exists poczta_wyslane_kto on public.poczta_wyslane (kto, at desc);
create index if not exists poczta_wyslane_skrzynka on public.poczta_wyslane (skrzynka, at desc);
create index if not exists poczta_wyslane_odp on public.poczta_wyslane (skrzynka, odp_hash) where odp_hash is not null;
alter table public.poczta_wyslane enable row level security;
drop policy if exists poczta_wyslane_select on public.poczta_wyslane;
create policy poczta_wyslane_select on public.poczta_wyslane for select to authenticated using (public.is_portal_admin());
revoke all on public.poczta_wyslane from anon, authenticated;
grant select on public.poczta_wyslane to authenticated;

create table if not exists public.poczta_podpisy (
  kto        text not null,
  skrzynka   text not null check (skrzynka in ('kadry', 'ksiegowosc')),
  html       text not null check (char_length(html) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (kto, skrzynka)
);
alter table public.poczta_podpisy enable row level security;
revoke all on public.poczta_podpisy from anon, authenticated;

-- the access log also records changes made in a mailbox from the portal (read / flag / move ...)
alter table public.poczta_dostep add column if not exists szczegoly text check (szczegoly is null or char_length(szczegoly) <= 300);
alter table public.poczta_dostep drop constraint if exists poczta_dostep_akcja_check;
alter table public.poczta_dostep add constraint poczta_dostep_akcja_check check (akcja in ('otwarcie', 'zalacznik', 'analiza', 'lista', 'foldery', 'zmiana'));
create index if not exists poczta_dostep_msg on public.poczta_dostep (skrzynka, msg_hash) where msg_hash is not null;
