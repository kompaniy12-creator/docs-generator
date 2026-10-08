-- Register of VAT checks (Księgowość -> Narzędzia księgowe -> "Rejestr sprawdzeń VAT"): every question the
-- `vat` edge function put to the Ministry of Finance's register of VAT payers (art. 96b ustawy o VAT) or to
-- VIES, with the identifier the register returned — the proof that the contractor was checked.
-- Written only by the function (service role); staff can read but not add, change or delete entries.
create table if not exists public.vat_sprawdzenia (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  kto          text not null,                       -- staff e-mail from the verified JWT (never from the request body)
  rodzaj       text not null check (rodzaj in ('wl_search', 'wl_check', 'vies')),
  zapytanie    jsonb not null,                      -- {by, value, date} | {nip, konto, date} | {kraj, numer, wlasny}; account in full
  nip          text,                                -- checked subject: NIP, or country code + VAT number for a foreign one
  nazwa        text,
  wynik        text not null,                       -- Czynny / Zwolniony / Niezarejestrowany / brak w wykazie / TAK / NIE / ważny / nieważny / błąd <kod>
  na_dzien     date,                                -- the day the answer is for
  request_id   text,                                -- MF requestId or VIES requestIdentifier (consultation number)
  request_time text,                                -- as returned upstream
  szczegoly    jsonb not null default '{}'::jsonb   -- the trimmed answer the page showed (no persons' data)
);
create index if not exists vat_sprawdzenia_created on public.vat_sprawdzenia (created_at desc);
create index if not exists vat_sprawdzenia_nip on public.vat_sprawdzenia (nip);

alter table public.vat_sprawdzenia enable row level security;

-- read: the Księgowość section. No insert / update / delete policies on purpose — with RLS on, that denies
-- them to every signed-in user; the table privileges are cut down to SELECT as well (TRUNCATE is not covered by RLS).
drop policy if exists vat_sprawdzenia_select on public.vat_sprawdzenia;
create policy vat_sprawdzenia_select on public.vat_sprawdzenia for select to authenticated
  using (public.has_portal_section('onboarding'));

revoke all on public.vat_sprawdzenia from anon;
revoke all on public.vat_sprawdzenia from authenticated;
grant select on public.vat_sprawdzenia to authenticated;
