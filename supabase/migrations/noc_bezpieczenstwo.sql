-- Night security review 2026-10-09 — hardening applied live, one group at a time (each verified before/after).
-- Only tightening: revokes of grants that no page and no policy uses. Portal objects only (no CRM / invoices bot /
-- onboarding / tdcg objects). Idempotent — safe to re-run.

-- [1] anon: no table privileges on portal tables except what the public pages use
--     (wages table: read; employment form: insert). RLS already returned nothing; this removes the grant itself.
revoke all on public.portal_doc_history, public.portal_workers, public.umowa_szablony,
              public.portal_prawo_akty, public.portal_wiedza from anon;
revoke insert, update, delete, truncate, references, trigger on public.portal_stawki from anon;
revoke update, delete, truncate, references, trigger on public.zatrudnienie_zgloszenia from anon;

-- [2] authenticated: TRUNCATE is not governed by RLS; REFERENCES/TRIGGER are never needed by the pages
revoke truncate, references, trigger on
  public.akta_dokumenty, public.ksieg_zamkniecia, public.portal_doc_history, public.portal_firmy_cache,
  public.portal_klienci, public.portal_powiadomienia, public.portal_prawo_akty, public.portal_stawki,
  public.portal_stawki_check, public.portal_ustawienia, public.portal_wiedza, public.portal_workers,
  public.portal_zadania, public.portal_zadania_log, public.umowa_szablony, public.zatrudnienie_zgloszenia
  from authenticated;
-- [3] tables written only by the edge functions (service role): no policy lets a session write, so no grant either
revoke all on public.portal_firmy_cache, public.portal_klienci, public.portal_stawki_check from authenticated;
revoke insert, update, delete on public.portal_powiadomienia, public.portal_zadania_log from authenticated;
revoke insert, delete on public.portal_ustawienia from authenticated;
revoke update on public.portal_doc_history from authenticated;

-- [4] sequences of tables that only the service role writes: no USAGE/UPDATE for browser roles
revoke all on sequence public.klient_log_id_seq, public.poczta_dostep_id_seq, public.podpisy_log_id_seq,
  public.podpisy_proby_id_seq, public.portal_pracownicy_historia_id_seq, public.portal_zadania_log_id_seq
  from anon, authenticated;
-- [5] clients base read directly by a portal session: only the columns the function `klienci-baza` gives a
--     non-administrator, without the address (a sole trader's is often a home address — the function hides it from
--     non-Kadry staff, the direct REST read did not) and without "who changed it" / upstream error texts.
--     The view klienci_obsluga (security_invoker) needs: id, nip, nazwa, status, obsluga_od, koniec_od, w_arkuszu, opiekun, kadrowy.
revoke select on public.klienci_baza from authenticated;
grant select (id, nip, nazwa, forma, opodatkowanie, miasto, opiekun, kadrowy, w_arkuszu, brak_od, status, obsluga_od, koniec_od)
  on public.klienci_baza to authenticated;
-- register snapshots: the same rule for the address and for the change log that quotes old/new addresses
revoke select (adres, zmiany, odcisk) on public.klienci_rejestr from authenticated;
