-- Uprawnienia szczegółowe (phase 3): the per-function switch-off list in row level security.
--
-- Until now the list (app_metadata.portal_wylaczone, see /uprawnienia.js) was enforced by the edge functions and
-- the page guard only; a person could still read or change a table straight from the browser. This migration
-- adds public.portal_moze('<key>') to the policies behind the catalogue's keys, and splits the three FOR ALL
-- policies per command so that reading, adding, changing and deleting can be switched off separately.
--
-- Who is affected: only a non-administrator whose token carries portal_wylaczone. portal_moze() is TRUE for an
-- administrator and for a person without that claim, so for them every policy below answers exactly as before
-- (verified claim by claim in a rolled-back transaction before publishing). A claim that is not a list = FALSE.
-- The list takes effect in RLS when the person's access token is renewed (their sessions are ended on save).
--
-- Not touched: the anonymous policies of the public worker form (zz_insert_anon, zz_obj_insert_anon,
-- stawki_read_all), everything the service role does, CRM / onboarding / tdcg_* / chat_* objects, pzad_select
-- and pzad_update (mail and the scheduler depend on them), klienci_baza_select (the pickers of many pages read
-- it through the view klienci_obsluga; it holds no contact data — those live in portal_klienci, service role only).
--
-- Key by policy:
--   akta_dokumenty   select kadry.akta · insert kadry.akta.dodaj · update kadry.akta.edycja · delete kadry.akta.usun
--   storage akta-osobowe   select kadry.akta · insert kadry.akta.dodaj · delete kadry.akta.usun
--   umowa_szablony   select (section only) · insert/update/delete kadry.komplet.szablony
--   ksieg_zamkniecia select ksiegowosc.zamkniecia · insert/update/delete ksiegowosc.zamkniecia.edycja
--   zatrudnienie_zgloszenia   update, insert (office) kadry.dane.edycja · delete kadry.zgloszenia.usun
--   storage zatrudnienie-dokumenty   select kadry.zgloszenia.pliki · delete kadry.zgloszenia.usun
--   portal_workers   insert/update/delete kadry.dane.edycja
--   portal_ustawienia kadry_wzory_update   kadry.dokumenty.wzory
--   portal_doc_history delete, storage portal-documents delete   wspolne.historia.usun
--   vat_sprawdzenia select ksiegowosc.narzedzia.rejestr · sms_wiadomosci select klienci.sms.historia
--   poczta_wiadomosci select   poczta.kadry / poczta.ksiegowosc (by the row's mailbox)
--   klient_komunikacja / klient_subskrypcje / klient_zgody select   klienci.rozsylki
--   rozsylki / rozsylka_odbiorcy / rozsylka_szablony / rozsylka_segmenty select   klienci.rozsylki
--   podpisy_pakiety / podpisy_dokumenty / podpisy_log select   kadry.podpisy
--   portal_zadania   insert ogolne.zadania.dodaj · delete ogolne.zadania.usun
--
-- ============================== ROLLBACK (the definitions as they were before; also in
-- ============================== portal_uprawnienia_rls_rollback.sql, ready to run) ==============================
-- -- ROLLBACK of portal_uprawnienia_rls.sql (Uprawnienia szczegółowe, phase 3).
-- -- Puts back, word for word, the policies as they were on 2026-10-13 before that migration (dumped from
-- -- pg_policies right before it was applied). Run from the repo root:
-- --   supabase db query --linked -f supabase/migrations/portal_uprawnienia_rls_rollback.sql
-- -- public.portal_moze(text) stays (phase 1 created it; nothing else depends on this file).
-- begin;
-- 
-- -- the three ALL policies that were split per command
-- drop policy if exists akta_select_kadry on public.akta_dokumenty;
-- drop policy if exists akta_insert_kadry on public.akta_dokumenty;
-- drop policy if exists akta_update_kadry on public.akta_dokumenty;
-- drop policy if exists akta_delete_kadry on public.akta_dokumenty;
-- drop policy if exists akta_all_kadry on public.akta_dokumenty;
-- create policy akta_all_kadry on public.akta_dokumenty for all to authenticated
--   using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
-- 
-- drop policy if exists us_select_portal on public.umowa_szablony;
-- drop policy if exists us_insert_portal on public.umowa_szablony;
-- drop policy if exists us_update_portal on public.umowa_szablony;
-- drop policy if exists us_delete_portal on public.umowa_szablony;
-- drop policy if exists us_all_portal on public.umowa_szablony;
-- create policy us_all_portal on public.umowa_szablony for all to authenticated
--   using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
-- 
-- drop policy if exists ksieg_zamkniecia_select on public.ksieg_zamkniecia;
-- drop policy if exists ksieg_zamkniecia_insert on public.ksieg_zamkniecia;
-- drop policy if exists ksieg_zamkniecia_update on public.ksieg_zamkniecia;
-- drop policy if exists ksieg_zamkniecia_delete on public.ksieg_zamkniecia;
-- drop policy if exists ksieg_zamkniecia_all on public.ksieg_zamkniecia;
-- create policy ksieg_zamkniecia_all on public.ksieg_zamkniecia for all to authenticated
--   using (public.has_portal_section('onboarding')) with check (public.has_portal_section('onboarding'));
-- 
-- -- storage: personnel files
-- alter policy akta_obj_select on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));
-- alter policy akta_obj_insert on storage.objects with check ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));
-- alter policy akta_obj_delete on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));
-- 
-- -- employment submissions and their files
-- alter policy zz_update_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
-- alter policy zz_insert_kadry on public.zatrudnienie_zgloszenia with check (public.has_portal_section('kadry'));
-- alter policy zz_delete_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry'));
-- alter policy zz_obj_select_portal on storage.objects using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry'));
-- alter policy zz_obj_delete_portal on storage.objects using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry'));
-- 
-- -- saved workers of the document generators
-- alter policy "portal insert" on public.portal_workers with check (public.has_portal_section('kadry'));
-- alter policy "portal update" on public.portal_workers using (public.has_portal_section('kadry'));
-- alter policy "portal delete" on public.portal_workers using (public.has_portal_section('kadry'));
-- 
-- -- approval of document templates
-- alter policy kadry_wzory_update on public.portal_ustawienia
--   using ((key = 'kadry_wzory') and public.has_portal_section('kadry')) with check ((key = 'kadry_wzory') and public.has_portal_section('kadry'));
-- 
-- -- history of generated documents: deleting
-- alter policy "portal delete" on public.portal_doc_history using (public.has_portal_section(public.portal_doc_section(doc_type)));
-- alter policy "portal storage delete" on storage.objects
--   using ((bucket_id = 'portal-documents') and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))));
-- 
-- -- registers read with the person's own token
-- alter policy vat_sprawdzenia_select on public.vat_sprawdzenia using (public.has_portal_section('onboarding'));
-- alter policy sms_wiadomosci_select on public.sms_wiadomosci using (
--   public.is_portal_admin()
--   or (public.has_portal_section('kadry') and ((cel = 'termin') or (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))))
--   or (public.has_portal_section('onboarding') and (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))));
-- alter policy poczta_wiadomosci_select on public.poczta_wiadomosci using (
--   public.is_portal_admin()
--   or ((skrzynka = 'kadry') and public.has_portal_section('kadry'))
--   or ((skrzynka = 'ksiegowosc') and public.has_portal_section('onboarding')));
-- alter policy klient_komunikacja_select on public.klient_komunikacja using (public.komunikacja_moze());
-- alter policy klient_subskrypcje_select on public.klient_subskrypcje using (public.komunikacja_moze());
-- alter policy klient_zgody_select on public.klient_zgody using (public.komunikacja_moze());
-- alter policy rozsylki_select on public.rozsylki using (public.komunikacja_moze());
-- alter policy rozsylka_odbiorcy_select on public.rozsylka_odbiorcy using (public.komunikacja_moze());
-- alter policy rozsylka_szablony_select on public.rozsylka_szablony using (public.komunikacja_moze());
-- alter policy rozsylka_segmenty_select on public.rozsylka_segmenty using (public.komunikacja_moze());
-- alter policy podpisy_pakiety_kadry on public.podpisy_pakiety using (public.has_portal_section('kadry'));
-- alter policy podpisy_dokumenty_kadry on public.podpisy_dokumenty using (public.has_portal_section('kadry'));
-- alter policy podpisy_log_kadry on public.podpisy_log using (public.has_portal_section('kadry'));
-- 
-- -- tasks: adding by hand and deleting
-- alter policy pzad_insert on public.portal_zadania with check (
--   public.is_portal_user() and (zrodlo = 'reczne') and (klucz is null) and (created_by = (auth.jwt() ->> 'email'))
--   and (eskalacja is null) and (przypomniano is null));
-- alter policy pzad_delete on public.portal_zadania using (
--   public.is_portal_user() and (zrodlo = 'reczne')
--   and ((created_by = (auth.jwt() ->> 'email')) or coalesce((((auth.jwt() -> 'app_metadata') ->> 'portal_admin') = 'true'), false)));
-- 
-- commit;
-- ============================== end of the rollback block ==============================

begin;

-- ---------------------------------------------------------------- personnel files (akta.html)
drop policy if exists akta_all_kadry on public.akta_dokumenty;
drop policy if exists akta_select_kadry on public.akta_dokumenty;
drop policy if exists akta_insert_kadry on public.akta_dokumenty;
drop policy if exists akta_update_kadry on public.akta_dokumenty;
drop policy if exists akta_delete_kadry on public.akta_dokumenty;
create policy akta_select_kadry on public.akta_dokumenty for select to authenticated
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.akta'));
create policy akta_insert_kadry on public.akta_dokumenty for insert to authenticated
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.akta.dodaj'));
create policy akta_update_kadry on public.akta_dokumenty for update to authenticated
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.akta.edycja'))
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.akta.edycja'));
create policy akta_delete_kadry on public.akta_dokumenty for delete to authenticated
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.akta.usun'));

alter policy akta_obj_select on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry') and public.portal_moze('kadry.akta'));
alter policy akta_obj_insert on storage.objects with check ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry') and public.portal_moze('kadry.akta.dodaj'));
alter policy akta_obj_delete on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry') and public.portal_moze('kadry.akta.usun'));

-- ---------------------------------------------------------------- own contract templates (umowa-zlecenie.html)
-- reading stays with the section: a saved template is used every time a set of documents is generated
drop policy if exists us_all_portal on public.umowa_szablony;
drop policy if exists us_select_portal on public.umowa_szablony;
drop policy if exists us_insert_portal on public.umowa_szablony;
drop policy if exists us_update_portal on public.umowa_szablony;
drop policy if exists us_delete_portal on public.umowa_szablony;
create policy us_select_portal on public.umowa_szablony for select to authenticated
  using (public.has_portal_section('kadry'));
create policy us_insert_portal on public.umowa_szablony for insert to authenticated
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.komplet.szablony'));
create policy us_update_portal on public.umowa_szablony for update to authenticated
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.komplet.szablony'))
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.komplet.szablony'));
create policy us_delete_portal on public.umowa_szablony for delete to authenticated
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.komplet.szablony'));

-- ---------------------------------------------------------------- month closing (ksiegowosc.html)
drop policy if exists ksieg_zamkniecia_all on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_select on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_insert on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_update on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_delete on public.ksieg_zamkniecia;
create policy ksieg_zamkniecia_select on public.ksieg_zamkniecia for select to authenticated
  using (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.zamkniecia'));
create policy ksieg_zamkniecia_insert on public.ksieg_zamkniecia for insert to authenticated
  with check (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.zamkniecia.edycja'));
create policy ksieg_zamkniecia_update on public.ksieg_zamkniecia for update to authenticated
  using (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.zamkniecia.edycja'))
  with check (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.zamkniecia.edycja'));
create policy ksieg_zamkniecia_delete on public.ksieg_zamkniecia for delete to authenticated
  using (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.zamkniecia.edycja'));

-- ---------------------------------------------------------------- employment submissions and their files
-- kadry.dane.edycja switched off = Kadry read-only: no change of a person's data from any page
alter policy zz_update_portal on public.zatrudnienie_zgloszenia
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'))
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'));
alter policy zz_insert_kadry on public.zatrudnienie_zgloszenia
  with check (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'));
alter policy zz_delete_portal on public.zatrudnienie_zgloszenia
  using (public.has_portal_section('kadry') and public.portal_moze('kadry.zgloszenia.usun'));
alter policy zz_obj_select_portal on storage.objects
  using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry') and public.portal_moze('kadry.zgloszenia.pliki'));
alter policy zz_obj_delete_portal on storage.objects
  using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry') and public.portal_moze('kadry.zgloszenia.usun'));

-- ---------------------------------------------------------------- saved workers of the document generators
alter policy "portal insert" on public.portal_workers with check (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'));
alter policy "portal update" on public.portal_workers using (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'));
alter policy "portal delete" on public.portal_workers using (public.has_portal_section('kadry') and public.portal_moze('kadry.dane.edycja'));

-- ---------------------------------------------------------------- approval of document templates (dokumenty.html)
alter policy kadry_wzory_update on public.portal_ustawienia
  using ((key = 'kadry_wzory') and public.has_portal_section('kadry') and public.portal_moze('kadry.dokumenty.wzory'))
  with check ((key = 'kadry_wzory') and public.has_portal_section('kadry') and public.portal_moze('kadry.dokumenty.wzory'));

-- ---------------------------------------------------------------- history of generated documents: deleting
alter policy "portal delete" on public.portal_doc_history
  using (public.has_portal_section(public.portal_doc_section(doc_type)) and public.portal_moze('wspolne.historia.usun'));
alter policy "portal storage delete" on storage.objects
  using ((bucket_id = 'portal-documents') and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))) and public.portal_moze('wspolne.historia.usun'));

-- ---------------------------------------------------------------- registers read with the person's own token
alter policy vat_sprawdzenia_select on public.vat_sprawdzenia
  using (public.has_portal_section('onboarding') and public.portal_moze('ksiegowosc.narzedzia.rejestr'));
alter policy sms_wiadomosci_select on public.sms_wiadomosci using (
  (public.is_portal_admin()
   or (public.has_portal_section('kadry') and ((cel = 'termin') or (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))))
   or (public.has_portal_section('onboarding') and (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))))
  and public.portal_moze('klienci.sms.historia'));
alter policy poczta_wiadomosci_select on public.poczta_wiadomosci using (
  public.is_portal_admin()
  or ((skrzynka = 'kadry') and public.has_portal_section('kadry') and public.portal_moze('poczta.kadry'))
  or ((skrzynka = 'ksiegowosc') and public.has_portal_section('onboarding') and public.portal_moze('poczta.ksiegowosc')));
alter policy klient_komunikacja_select on public.klient_komunikacja using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy klient_subskrypcje_select on public.klient_subskrypcje using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy klient_zgody_select on public.klient_zgody using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
-- the broadcasts themselves (text, recipients, templates, segments): read by the komunikacja function with the
-- service role only — no page reads them directly — so the page's key closes the direct read as well
alter policy rozsylki_select on public.rozsylki using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy rozsylka_odbiorcy_select on public.rozsylka_odbiorcy using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy rozsylka_szablony_select on public.rozsylka_szablony using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy rozsylka_segmenty_select on public.rozsylka_segmenty using (public.komunikacja_moze() and public.portal_moze('klienci.rozsylki'));
alter policy podpisy_pakiety_kadry on public.podpisy_pakiety using (public.has_portal_section('kadry') and public.portal_moze('kadry.podpisy'));
alter policy podpisy_dokumenty_kadry on public.podpisy_dokumenty using (public.has_portal_section('kadry') and public.portal_moze('kadry.podpisy'));
alter policy podpisy_log_kadry on public.podpisy_log using (public.has_portal_section('kadry') and public.portal_moze('kadry.podpisy'));

-- ---------------------------------------------------------------- tasks: adding by hand and deleting
-- (pzad_select / pzad_update are deliberately left alone)
alter policy pzad_insert on public.portal_zadania with check (
  public.is_portal_user() and (zrodlo = 'reczne') and (klucz is null) and (created_by = (auth.jwt() ->> 'email'))
  and (eskalacja is null) and (przypomniano is null) and public.portal_moze('ogolne.zadania.dodaj'));
alter policy pzad_delete on public.portal_zadania using (
  public.is_portal_user() and (zrodlo = 'reczne')
  and ((created_by = (auth.jwt() ->> 'email')) or coalesce((((auth.jwt() -> 'app_metadata') ->> 'portal_admin') = 'true'), false))
  and public.portal_moze('ogolne.zadania.usun'));

commit;
