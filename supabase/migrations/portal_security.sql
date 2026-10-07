-- Hardening after the security review of 2026-10-08.

-- 1) Clients base: a private copy inside the database, so the portal does not depend on
--    the clients sheet being readable by link. Service role only (no policies).
create table if not exists public.portal_klienci (
  id        text primary key,           -- NIP, or 'nazwa:<name>' when the sheet row has no NIP
  nip       text,
  dane      jsonb not null,
  synced_at timestamptz not null default now()
);
alter table public.portal_klienci enable row level security;

-- 2) Public intake form: the anonymous insert may only create a plain new request.
--    Keys the portal itself writes later (packet file, send log, flags) are refused, so a
--    forged request cannot point "send to client" at somebody else's file; size is capped.
drop policy if exists zz_insert_anon on public.zatrudnienie_zgloszenia;
create policy zz_insert_anon on public.zatrudnienie_zgloszenia
  for insert to anon, authenticated
  with check (
    status = 'nowe'
    and reviewed_by is null and reviewed_at is null
    and jsonb_typeof(payload) = 'object'
    and not (payload ?| array['komplet', 'wyslano', '_powiadomiono', '_import', 'k_zus', 'k_pup', '_zid'])
    and pg_column_size(payload) < 200000
    and coalesce(array_length(doc_paths, 1), 0) <= 40
    and char_length(coalesce(worker_name, '')) <= 200
  );

-- 3) Uploaded documents: images and PDF only, 20 MB per file.
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['image/*', 'application/pdf']
 where id = 'zatrudnienie-dokumenty';
update storage.buckets set file_size_limit = 52428800 where id = 'portal-documents' and file_size_limit is null;

-- 4) Internal helper tables must not be reachable with the public key at all.
revoke all on public.portal_klienci, public.portal_ustawienia, public.portal_firmy_cache,
              public.portal_stawki_check, public.portal_powiadomienia, public.portal_zadania_log from anon;
revoke insert, update, delete on public.portal_wiedza, public.portal_prawo_akty, public.portal_stawki from anon, authenticated;

-- 5) Tables of the invoices bot that had no row-level security: anyone holding the public
--    key could read them (755 invoices at the time of the review). Usage statistics show only
--    the service role and the owner touch them, and both bypass RLS, so the bot is unaffected.
--    Undo for one table: alter table public.<name> disable row level security;
alter table public.invoices           enable row level security;
alter table public.payments           enable row level security;
alter table public.accounting_clients enable row level security;
alter table public.sync_log           enable row level security;
alter table public.fetch_log          enable row level security;
