-- Performance (2026-10-13). The dashboard (function pulpit) asks for the time of the last invoice sync on every
-- load: without an index that was a scan and a sort of the whole table (measured 39.6 ms for 755 rows on the
-- shared compute; with the index it is a one-row index scan). Additive, idempotent.
create index if not exists invoices_synced_at on public.invoices (synced_at desc);
