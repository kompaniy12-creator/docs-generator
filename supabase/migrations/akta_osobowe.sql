-- Akta osobowe: scanned paper personnel files, sorted by firm, worker and part of the file.
-- Parts follow § 3 of the regulation on employee documentation (Dz.U. 2026 poz. 474, t.j.):
-- A — applying for the job and medical referrals / certificates, B — employment, C — termination,
-- D — disciplinary, E — sobriety checks. 'Z' is ours: papers of a civil-law contractor, who has
-- no statutory personnel file.
create table if not exists public.akta_dokumenty (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  uploaded_by   text,
  path          text not null unique,
  nazwa         text not null,
  rozmiar       int,
  mime          text,
  status        text not null default 'nowy' check (status in ('nowy', 'analiza', 'przypisany', 'do_sprawdzenia', 'blad')),
  nip           text,
  firma         text,
  worker_id     uuid,
  worker_name   text,
  czesc         text check (czesc is null or czesc in ('A', 'B', 'C', 'D', 'E', 'Z')),
  rodzaj        text,
  data_dok      date,
  strony        int,
  spis          jsonb not null default '[]'::jsonb,   -- documents found inside: [{strony, rodzaj, czesc, data}]
  ai            jsonb,                                 -- what was read and the candidate workers
  uwagi         text,
  sprawdzil     text,
  sprawdzono_at timestamptz
);
create index if not exists akta_dokumenty_worker on public.akta_dokumenty (nip, worker_id, czesc);
create index if not exists akta_dokumenty_status on public.akta_dokumenty (status, created_at desc);
alter table public.akta_dokumenty enable row level security;
drop policy if exists akta_all_kadry on public.akta_dokumenty;
create policy akta_all_kadry on public.akta_dokumenty for all to authenticated
  using (public.has_portal_section('kadry')) with check (public.has_portal_section('kadry'));
revoke all on public.akta_dokumenty from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('akta-osobowe', 'akta-osobowe', false, 41943040, array['application/pdf', 'image/*'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists akta_obj_insert on storage.objects;
create policy akta_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'akta-osobowe' and public.has_portal_section('kadry'));
drop policy if exists akta_obj_select on storage.objects;
create policy akta_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'akta-osobowe' and public.has_portal_section('kadry'));
drop policy if exists akta_obj_delete on storage.objects;
create policy akta_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'akta-osobowe' and public.has_portal_section('kadry'));
