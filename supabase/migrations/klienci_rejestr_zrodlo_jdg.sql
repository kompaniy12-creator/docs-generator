-- Sole traders (JDG) are now read through a chain of sources (supabase/functions/_shared/jdg.ts):
-- CEIDG (official register), GUS / REGON (DataPort) and, without any key, MF's register of VAT payers.
-- klienci_rejestr.zrodlo says which one a snapshot came from; 'mf' marks a BASIC record (name, REGON,
-- address, VAT status) that a later reading from CEIDG / GUS replaces. Purely additive: existing rows
-- ('krs', 'gus') stay valid.
alter table public.klienci_rejestr drop constraint if exists klienci_rejestr_zrodlo_check;
alter table public.klienci_rejestr add constraint klienci_rejestr_zrodlo_check check (zrodlo in ('krs', 'gus', 'ceidg', 'mf'));
comment on column public.klienci_rejestr.zrodlo is 'krs = rejestr.io (KRS); ceidg = CEIDG API v3; gus = REGON through DataPort; mf = Wykaz podatników VAT (basic data only, replaced once CEIDG / GUS answers)';
