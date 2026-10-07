-- Per-section portal access. A portal user may be limited to some sections via
-- app_metadata.portal_sections (json array of 'rejestracja' | 'biezaca' | 'kadry').
-- No array = all sections (accounts created before this change keep full access);
-- portal_admin = all sections. Set only through the portal-admin edge function.

create or replace function public.has_portal_section(s text) returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'portal') = 'true', false)
     and (
       coalesce((auth.jwt() -> 'app_metadata' ->> 'portal_admin') = 'true', false)
       or coalesce(jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'portal_sections'), 'null') <> 'array'
       or coalesce((auth.jwt() -> 'app_metadata' -> 'portal_sections') ? s, false)
     )
$$;

-- which section a generated document (portal_doc_history.doc_type) belongs to
create or replace function public.portal_doc_section(doc_type text) returns text
language sql immutable as $$
  select case
    when doc_type = 'umowa-zlecenie' then 'kadry'
    when doc_type = 'rejestracja-s24' then 'rejestracja'
    else 'biezaca'
  end
$$;

-- ---- Kadry: intake requests, their files, worker directory, contract templates ----
alter policy zz_select_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry'));
alter policy zz_update_portal on public.zatrudnienie_zgloszenia
  using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
alter policy zz_delete_portal on public.zatrudnienie_zgloszenia using (public.has_portal_section('kadry'));

alter policy zz_obj_select_portal on storage.objects
  using (bucket_id = 'zatrudnienie-dokumenty' and public.has_portal_section('kadry'));
alter policy zz_obj_delete_portal on storage.objects
  using (bucket_id = 'zatrudnienie-dokumenty' and public.has_portal_section('kadry'));

alter policy us_all_portal on public.umowa_szablony
  using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));

alter policy "portal read" on public.portal_workers using (public.has_portal_section('kadry'));
alter policy "portal insert" on public.portal_workers with check (public.has_portal_section('kadry'));
alter policy "portal update" on public.portal_workers using (public.has_portal_section('kadry'));
alter policy "portal delete" on public.portal_workers using (public.has_portal_section('kadry'));

-- ---- Document history: each row / file belongs to the section of its doc type ----
alter policy "portal read" on public.portal_doc_history
  using (public.has_portal_section(public.portal_doc_section(doc_type)));
alter policy "portal insert" on public.portal_doc_history
  with check (public.has_portal_section(public.portal_doc_section(doc_type)));
alter policy "portal delete" on public.portal_doc_history
  using (public.has_portal_section(public.portal_doc_section(doc_type)));

-- history files are stored as <doc_type>/<date>/<id>.<ext>
alter policy "portal storage read" on storage.objects
  using (bucket_id = 'portal-documents' and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))));
alter policy "portal storage insert" on storage.objects
  with check (bucket_id = 'portal-documents' and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))));
alter policy "portal storage delete" on storage.objects
  using (bucket_id = 'portal-documents' and public.has_portal_section(public.portal_doc_section(split_part(name, '/', 1))));

-- pin the search path of the access-check functions (database linter 0011)
alter function public.is_portal_user() set search_path = '';
alter function public.has_portal_section(text) set search_path = '';
alter function public.portal_doc_section(text) set search_path = '';
