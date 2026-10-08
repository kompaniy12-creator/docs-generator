-- Podpisy elektroniczne: signing of employment documents between the employer (client firm)
-- and the worker. The signing itself happens outside the portal (qualified signature in the
-- signer's own software, podpis zaufany on podpis.gov.pl, or by hand on a printout); the portal
-- issues the files, collects what comes back, checks what bytes can tell and keeps the trail.
-- Purely additive. Everything is written by the `podpisy` edge function (service role):
-- staff of the Kadry section may read, nobody writes from a browser, anon sees nothing.
create table if not exists public.podpisy_pakiety (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      text not null,
  zgloszenie_id   uuid,                       -- zatrudnienie_zgloszenia.id = worker_id in akta_dokumenty
  nip             text not null check (nip ~ '^[0-9]{10}$'),
  firma           text,
  worker_name     text not null,
  typ             text not null check (typ in ('praca', 'zlecenie')),
  cudzoziemiec    boolean not null default false,
  bez_pesel       boolean not null default false,   -- default route for the worker: by hand + scan
  status          text not null default 'szkic'
                  check (status in ('szkic', 'u_pracodawcy', 'u_pracownika', 'weryfikacja', 'gotowy', 'zakonczony', 'anulowany')),
  wydano_at       timestamptz,
  -- the worker's link: only the SHA-256 of the token is kept
  link_hash       text unique,
  link_expires    timestamptz,
  link_at         timestamptz,
  link_by         text,
  anulowano_at    timestamptz,
  anulowano_by    text,
  anulowano_powod text,
  zakonczono_at   timestamptz,
  zakonczono_by   text,
  uwagi           text
);
create index if not exists podpisy_pakiety_nip on public.podpisy_pakiety (nip, created_at desc);
create index if not exists podpisy_pakiety_status on public.podpisy_pakiety (status, created_at desc);
create index if not exists podpisy_pakiety_zgl on public.podpisy_pakiety (zgloszenie_id);

-- one row = one PDF. pd_* = the employer's step, pr_* = the worker's step.
create table if not exists public.podpisy_dokumenty (
  id              uuid primary key default gen_random_uuid(),
  pakiet_id       uuid not null references public.podpisy_pakiety (id) on delete cascade,
  created_at      timestamptz not null default now(),
  lp              int not null default 1,
  rodzaj          text not null check (rodzaj in ('umowa_praca', 'aneks_praca', 'umowa_zlecenie', 'aneks_zlecenie', 'tlumaczenie',
                  'zwiazki_info', 'rozwiazanie', 'ppk_rezygnacja', 'odpowiedzialnosc', 'pit2', 'kwestionariusz', 'oswiadczenie',
                  'zgoda_rodo', 'informacja_warunki', 'inny')),
  tytul           text not null,
  czesc           text not null default 'B' check (czesc in ('A', 'B', 'C', 'D', 'E', 'Z')),
  podpisuje       text not null check (podpisuje in ('obie', 'pracodawca', 'pracownik', 'potwierdzenie')),
  status          text not null default 'u_pracodawcy'
                  check (status in ('u_pracodawcy', 'weryfikacja_pracodawcy', 'u_pracownika', 'weryfikacja_pracownika', 'gotowy', 'w_aktach', 'anulowany')),
  -- the file we issued
  wydany_path     text not null,
  wydany_nazwa    text not null,
  wydany_sha256   text not null check (wydany_sha256 ~ '^[0-9a-f]{64}$'),
  wydany_rozmiar  int not null,
  -- employer
  pd_status       text not null default 'oczekuje' check (pd_status in ('nie_dotyczy', 'oczekuje', 'wgrany', 'zweryfikowany', 'odrzucony')),
  pd_metoda       text check (pd_metoda is null or pd_metoda in ('kwalifikowany', 'zaufany', 'odreczny')),
  pd_path         text,
  pd_mime         text,
  pd_sha256       text,
  pd_rozmiar      int,
  pd_baza         text check (pd_baza is null or pd_baza in ('wydany', 'pracodawca')),   -- which file the upload continues (PAdES prefix)
  pd_wiazanie     text check (pd_wiazanie is null or pd_wiazanie in ('prefiks', 'wzrokowa', 'pominiete')),
  pd_at           timestamptz,
  pd_przez        text,                        -- 'pracodawca:<e-mail>' | 'biuro:<e-mail>'
  pd_ostrzezenie  jsonb,                       -- acknowledged warning: {wersja, sha256, at, kto}
  pd_wer_przez    text,
  pd_wer_at       timestamptz,
  pd_odrzucenie   text,
  pd_raport       jsonb,                       -- reserved: automatic validation report (later stage)
  -- worker
  pr_status       text not null default 'oczekuje' check (pr_status in ('nie_dotyczy', 'oczekuje', 'wgrany', 'zweryfikowany', 'odrzucony')),
  pr_metoda       text check (pr_metoda is null or pr_metoda in ('kwalifikowany', 'zaufany', 'odreczny')),
  pr_path         text,
  pr_mime         text,
  pr_sha256       text,
  pr_rozmiar      int,
  pr_baza         text check (pr_baza is null or pr_baza in ('wydany', 'pracodawca')),
  pr_wiazanie     text check (pr_wiazanie is null or pr_wiazanie in ('prefiks', 'wzrokowa', 'pominiete')),
  pr_at           timestamptz,
  pr_przez        text,                        -- 'pracownik:link' | 'pracodawca:<e-mail>' | 'biuro:<e-mail>'
  pr_ostrzezenie  jsonb,
  pr_wer_przez    text,
  pr_wer_at       timestamptz,
  pr_odrzucenie   text,
  pr_raport       jsonb,
  -- informacja o warunkach zatrudnienia: no signature, the worker confirms receipt
  odbior_at       timestamptz,
  odbior_ip       text,
  -- rows of akta_dokumenty created when the package was closed
  akta_ids        uuid[] not null default '{}'
);
create index if not exists podpisy_dokumenty_pakiet on public.podpisy_dokumenty (pakiet_id, lp);

-- append-only trail: who / what / when / from where / which bytes / with what result
create table if not exists public.podpisy_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  pakiet_id    uuid,
  dokument_id  uuid,
  strona       text not null check (strona in ('biuro', 'pracodawca', 'pracownik', 'system')),
  kto          text,
  akcja        text not null,
  wynik        text not null default 'ok',
  ip           text,
  ua           text,
  sha256       text,
  info         jsonb
);
create index if not exists podpisy_log_pakiet on public.podpisy_log (pakiet_id, id);
create index if not exists podpisy_log_akcja on public.podpisy_log (akcja, at desc);

-- wrong link tokens, per address — only to slow guessing down; rows older than a day are
-- removed by the function itself
create table if not exists public.podpisy_proby (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now(),
  ip  text not null
);
create index if not exists podpisy_proby_ip on public.podpisy_proby (ip, at desc);

-- the trail cannot be rewritten: no UPDATE at all, DELETE only by the database owner
-- (retention / erasure after the storage period), never by the API roles
create or replace function public.podpisy_log_stale() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin') then return old; end if;
  raise exception 'podpisy_log jest dziennikiem tylko do dopisywania';
end $$;
drop trigger if exists podpisy_log_stale on public.podpisy_log;
create trigger podpisy_log_stale before update or delete on public.podpisy_log for each row execute function public.podpisy_log_stale();

alter table public.podpisy_pakiety   enable row level security;
alter table public.podpisy_dokumenty enable row level security;
alter table public.podpisy_log       enable row level security;
alter table public.podpisy_proby     enable row level security;
revoke all on public.podpisy_pakiety, public.podpisy_dokumenty, public.podpisy_log, public.podpisy_proby from anon, authenticated;
grant select on public.podpisy_pakiety, public.podpisy_dokumenty, public.podpisy_log to authenticated;
drop policy if exists podpisy_pakiety_kadry on public.podpisy_pakiety;
create policy podpisy_pakiety_kadry on public.podpisy_pakiety for select to authenticated using (public.has_portal_section('kadry'));
drop policy if exists podpisy_dokumenty_kadry on public.podpisy_dokumenty;
create policy podpisy_dokumenty_kadry on public.podpisy_dokumenty for select to authenticated using (public.has_portal_section('kadry'));
drop policy if exists podpisy_log_kadry on public.podpisy_log;
create policy podpisy_log_kadry on public.podpisy_log for select to authenticated using (public.has_portal_section('kadry'));

-- private bucket for issued and returned files; no storage policies on purpose —
-- files leave only as short-lived signed links made by the function
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('podpisy', 'podpisy', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- how many revisions were appended after the file the upload continues (PAdES); the "prefix"
-- binding says the issued bytes are in there, not that nothing was added on top of them
alter table public.podpisy_dokumenty add column if not exists pd_rewizje int, add column if not exists pr_rewizje int;
-- the function's role can only add to the trail (TRUNCATE would slip past the row trigger)
revoke update, delete, truncate on public.podpisy_log from service_role;
