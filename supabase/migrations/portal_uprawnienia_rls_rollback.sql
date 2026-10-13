-- ROLLBACK of portal_uprawnienia_rls.sql (Uprawnienia szczegółowe, phase 3).
-- Puts back, word for word, the policies as they were on 2026-10-13 before that migration (dumped from
-- pg_policies right before it was applied). Run from the repo root:
--   supabase db query --linked -f supabase/migrations/portal_uprawnienia_rls_rollback.sql
-- public.portal_moze(text) stays (phase 1 created it; nothing else depends on this file).
begin;

-- the three ALL policies that were split per command
drop policy if exists akta_select_kadry on public.akta_dokumenty;
drop policy if exists akta_insert_kadry on public.akta_dokumenty;
drop policy if exists akta_update_kadry on public.akta_dokumenty;
drop policy if exists akta_delete_kadry on public.akta_dokumenty;
drop policy if exists akta_all_kadry on public.akta_dokumenty;
create policy akta_all_kadry on public.akta_dokumenty for all to authenticated
  using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));

drop policy if exists us_select_portal on public.umowa_szablony;
drop policy if exists us_insert_portal on public.umowa_szablony;
drop policy if exists us_update_portal on public.umowa_szablony;
drop policy if exists us_delete_portal on public.umowa_szablony;
drop policy if exists us_all_portal on public.umowa_szablony;
create policy us_all_portal on public.umowa_szablony for all to authenticated
  using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));

drop policy if exists ksieg_zamkniecia_select on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_insert on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_update on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_delete on public.ksieg_zamkniecia;
drop policy if exists ksieg_zamkniecia_all on public.ksieg_zamkniecia;
create policy ksieg_zamkniecia_all on public.ksieg_zamkniecia for all to authenticated
  using (public.has_portal_section('onboarding')) with check (public.has_portal_section('onboarding'));

-- storage: personnel files
alter policy akta_obj_select on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));
alter policy akta_obj_insert on storage.objects with check ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));
alter policy akta_obj_delete on storage.objects using ((bucket_id = 'akta-osobowe') and public.has_portal_section('kadry'));

-- employment submissions and their files
alter policy zz_update_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
alter policy zz_insert_kadry on public.zatrudnienie_zgloszenia with check (public.has_portal_section('kadry'));
alter policy zz_delete_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry'));
alter policy zz_obj_select_portal on storage.objects using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry'));
alter policy zz_obj_delete_portal on storage.objects using ((bucket_id = 'zatrudnienie-dokumenty') and public.has_portal_section('kadry'));

-- saved workers of the document generators
alter policy "portal insert" on public.portal_workers with check (public.has_portal_section('kadry'));
alter policy "portal update" on public.portal_workers using (public.has_portal_section('kadry'));
alter policy "portal delete" on public.portal_workers using (public.has_portal_section('kadry'));

-- approval of document templates
alter policy kadry_wzory_update on public.portal_ustawienia
  using ((key = 'kadry_wzory') and public.has_portal_section('kadry')) with check ((key = 'kadry_wzory') and public.has_portal_section('kadry'));

-- history of generated documents: deleting
alter policy "portal delete" on public.portal_doc_history using (public.has_portal_section(public.portal_doc_section(doc_type)));
alter policy "portal storage delete" on storage.objects
  using ((bucket_id = 'portal-documents') and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))));

-- registers read with the person's own token
alter policy vat_sprawdzenia_select on public.vat_sprawdzenia using (public.has_portal_section('onboarding'));
alter policy sms_wiadomosci_select on public.sms_wiadomosci using (
  public.is_portal_admin()
  or (public.has_portal_section('kadry') and ((cel = 'termin') or (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))))
  or (public.has_portal_section('onboarding') and (lower(kto) = lower(coalesce((auth.jwt() ->> 'email'), '')))));
alter policy poczta_wiadomosci_select on public.poczta_wiadomosci using (
  public.is_portal_admin()
  or ((skrzynka = 'kadry') and public.has_portal_section('kadry'))
  or ((skrzynka = 'ksiegowosc') and public.has_portal_section('onboarding')));
alter policy klient_komunikacja_select on public.klient_komunikacja using (public.komunikacja_moze());
alter policy klient_subskrypcje_select on public.klient_subskrypcje using (public.komunikacja_moze());
alter policy klient_zgody_select on public.klient_zgody using (public.komunikacja_moze());
alter policy rozsylki_select on public.rozsylki using (public.komunikacja_moze());
alter policy rozsylka_odbiorcy_select on public.rozsylka_odbiorcy using (public.komunikacja_moze());
alter policy rozsylka_szablony_select on public.rozsylka_szablony using (public.komunikacja_moze());
alter policy rozsylka_segmenty_select on public.rozsylka_segmenty using (public.komunikacja_moze());
alter policy podpisy_pakiety_kadry on public.podpisy_pakiety using (public.has_portal_section('kadry'));
alter policy podpisy_dokumenty_kadry on public.podpisy_dokumenty using (public.has_portal_section('kadry'));
alter policy podpisy_log_kadry on public.podpisy_log using (public.has_portal_section('kadry'));

-- tasks: adding by hand and deleting
alter policy pzad_insert on public.portal_zadania with check (
  public.is_portal_user() and (zrodlo = 'reczne') and (klucz is null) and (created_by = (auth.jwt() ->> 'email'))
  and (eskalacja is null) and (przypomniano is null));
alter policy pzad_delete on public.portal_zadania using (
  public.is_portal_user() and (zrodlo = 'reczne')
  and ((created_by = (auth.jwt() ->> 'email')) or coalesce((((auth.jwt() -> 'app_metadata') ->> 'portal_admin') = 'true'), false)));

commit;
