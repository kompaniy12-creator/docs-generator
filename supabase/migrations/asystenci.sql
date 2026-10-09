-- Asystenci AI (test mode): the log of runs, the bucket for files kept for review, the settings seed.
-- Additive only. Everything here is read and written by the `asystent` edge function with the service
-- role; the browser never touches these objects (RLS on, no policies; private bucket, no policies).

create table if not exists public.asystent_przebiegi (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  koniec_at       timestamptz,
  kto             text not null,                         -- the tester's e-mail
  asystent        text not null,
  tryb            text not null check (tryb in ('staff', 'klient')),
  kontekst        jsonb not null default '{}'::jsonb,    -- ids only: nip, worker_id, wiadomosc_id, okres, eli, file names and sizes
  model           text not null,
  status          text not null default 'w_toku' check (status in ('w_toku', 'gotowe', 'blad', 'odmowa', 'limit')),
  kroki           jsonb not null default '[]'::jsonb,    -- progress the page shows while it polls
  zapis           jsonb,                                 -- what the model was given (masked) and which tools were read
  wynik           jsonb,                                 -- the validated answer
  uwagi           jsonb,                                 -- what validation dropped or warns about
  tlumaczenie_ru  jsonb,
  blad            text,
  iteracje        int,
  tokeny_we       int not null default 0,
  tokeny_wy       int not null default 0,
  tokeny_cache_r  int not null default 0,
  tokeny_cache_w  int not null default 0,
  koszt_usd       numeric(12, 6) not null default 0,     -- an estimate from the price table in modele.ts
  czas_ms         int,
  pliki           text[] not null default '{}',          -- paths in the bucket, only when "zachowaj do oceny" was ticked
  ocena           smallint check (ocena is null or ocena in (-1, 1)),
  ocena_komentarz text,
  ocena_at        timestamptz,
  ocena_kto       text
);
create index if not exists asystent_przebiegi_created_idx on public.asystent_przebiegi (created_at desc);
create index if not exists asystent_przebiegi_kto_idx on public.asystent_przebiegi (kto, created_at desc);

alter table public.asystent_przebiegi enable row level security;
revoke all on table public.asystent_przebiegi from anon, authenticated;

comment on table public.asystent_przebiegi is
  'Asystenci AI (tryb testowy): dziennik uruchomień z tokenami i szacowanym kosztem. Zawiera to, co dostał model (zamaskowane), i odpowiedź — do oceny przez właściciela; retencja według ustawienia asystenci.retencja_dni (domyślnie 30 dni). Tylko service role.';

-- files the owner ticked "zachowaj do oceny" (PDF/JPG/PNG up to 10 MB); removed together with the run
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asystenci-pliki', 'asystenci-pliki', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- settings: the testers list is the gate (together with the administrator flag); never overwritten here
insert into public.portal_ustawienia (key, value)
values ('asystenci', jsonb_build_object(
  'testerzy', jsonb_build_array('portal@td-group.pl'),
  'wylaczone', '[]'::jsonb,
  'limity', jsonb_build_object('dziennie_osoba', 40, 'dziennie_razem', 80, 'koszt_dzien_usd', 5),
  'retencja_dni', 30,
  'ru_auto', false,
  'modele', '{}'::jsonb))
on conflict (key) do nothing;
