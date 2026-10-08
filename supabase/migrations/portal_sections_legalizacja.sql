-- "Legalizacja pobytu" becomes a module with its own access section.
create or replace function public.portal_doc_section(doc_type text) returns text
language sql immutable set search_path = '' as $$
  select case
    when doc_type = 'umowa-zlecenie' then 'kadry'
    when doc_type = 'rejestracja-s24' then 'rejestracja'
    when doc_type = 'zalacznik-pobyt' then 'legalizacja'
    else 'biezaca'
  end
$$;
-- nobody loses what they could open before: the documents of this module used to belong to
-- "Bieżąca działalność", so accounts limited to a list of sections that has it get the new one too
update auth.users
   set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{portal_sections}', (raw_app_meta_data -> 'portal_sections') || '["legalizacja"]'::jsonb)
 where raw_app_meta_data ->> 'portal' = 'true'
   and jsonb_typeof(raw_app_meta_data -> 'portal_sections') = 'array'
   and raw_app_meta_data -> 'portal_sections' ? 'biezaca'
   and not raw_app_meta_data -> 'portal_sections' ? 'legalizacja';
