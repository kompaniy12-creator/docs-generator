-- Client requests, office side (page zgloszenia-klientow.html): an internal note that never leaves
-- to the client, and the flag table for documents from the history of generated documents
-- (used when the office switches the client portal to "only ticked documents").
-- Purely additive; service role only, like the rest of the client-profile tables.
alter table public.klient_zgloszenia add column if not exists notatka_wewnetrzna text
  check (notatka_wewnetrzna is null or char_length(notatka_wewnetrzna) <= 4000);
create table if not exists public.historia_udostepnienia (
  dokument_id            uuid primary key,               -- portal_doc_history.id
  udostepniony_klientowi boolean not null default false,
  zmienil                text not null,
  zmieniono_at           timestamptz not null default now()
);
alter table public.historia_udostepnienia enable row level security;
revoke all on public.historia_udostepnienia from anon, authenticated;
