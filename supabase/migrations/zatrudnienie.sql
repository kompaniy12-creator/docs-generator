-- Employment intake (AI-кадровик, phase 1): public client form -> portal task.
-- Apply once against the shared TD CONSULTING GROUP project.
-- RLS: anon may only INSERT a request + upload a document; reading/updating is
-- restricted to portal users (app_metadata.portal = true). Mirrors the
-- portal_doc_history access model — do NOT loosen.

-- ---- Table ------------------------------------------------------------------
create table if not exists public.zatrudnienie_zgloszenia (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  status      text not null default 'nowe',          -- nowe | sprawdzone | wyslane
  worker_name text,
  payload     jsonb not null,
  doc_paths   text[] not null default '{}',
  reviewed_by uuid,
  reviewed_at timestamptz
);

alter table public.zatrudnienie_zgloszenia enable row level security;

-- helper: is the current JWT a portal user?
create or replace function public.is_portal_user() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'portal') = 'true', false)
$$;

-- anon (public form) may insert a new request, nothing else.
drop policy if exists zz_insert_anon on public.zatrudnienie_zgloszenia;
create policy zz_insert_anon on public.zatrudnienie_zgloszenia
  for insert to anon, authenticated
  with check (status = 'nowe');

-- portal users may read / update / delete everything.
drop policy if exists zz_select_portal on public.zatrudnienie_zgloszenia;
create policy zz_select_portal on public.zatrudnienie_zgloszenia
  for select to authenticated using (public.is_portal_user());

drop policy if exists zz_update_portal on public.zatrudnienie_zgloszenia;
create policy zz_update_portal on public.zatrudnienie_zgloszenia
  for update to authenticated using (public.is_portal_user()) with check (public.is_portal_user());

drop policy if exists zz_delete_portal on public.zatrudnienie_zgloszenia;
create policy zz_delete_portal on public.zatrudnienie_zgloszenia
  for delete to authenticated using (public.is_portal_user());

-- ---- Storage bucket (private) -----------------------------------------------
insert into storage.buckets (id, name, public)
values ('zatrudnienie-dokumenty', 'zatrudnienie-dokumenty', false)
on conflict (id) do nothing;

-- anon may upload document files into this bucket only.
drop policy if exists zz_obj_insert_anon on storage.objects;
create policy zz_obj_insert_anon on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'zatrudnienie-dokumenty');

-- portal users may read / delete those files.
drop policy if exists zz_obj_select_portal on storage.objects;
create policy zz_obj_select_portal on storage.objects
  for select to authenticated
  using (bucket_id = 'zatrudnienie-dokumenty' and public.is_portal_user());

drop policy if exists zz_obj_delete_portal on storage.objects;
create policy zz_obj_delete_portal on storage.objects
  for delete to authenticated
  using (bucket_id = 'zatrudnienie-dokumenty' and public.is_portal_user());
