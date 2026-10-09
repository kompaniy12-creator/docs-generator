-- SMS notifications (page sms.html, function sms; provider SMSAPI.pl).
--
--   sms_wiadomosci  the log of every attempt to send an SMS: who, to whom, what, with what result.
--                   Rows are written and updated only by the function (service role): inserted before the
--                   provider is called, then completed with the provider's answer and, later, with the
--                   delivery report. Staff can neither change nor delete them.
--   sms_limity      daily counters (all messages, per number) and the lock against sending the same text
--                   twice — one atomic statement, so two requests arriving together cannot both pass.
--
-- Who reads the log (message bodies and phone numbers are personal data — art. 5 ust. 1 lit. c and f RODO):
--   administrators      everything;
--   Kadry section       their own messages and the automatic deadline reminders (cel = 'termin'): the same
--                       people already see those workers and firms in Kontrola;
--   Księgowość section  their own messages only.
-- Column `idx` (the secret each delivery report must repeat) is never readable from the browser.
-- Settings live in portal_ustawienia under key 'sms' (service role only; read and saved by the function).
-- Purely additive: nothing existing is altered.

create table if not exists public.sms_wiadomosci (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  kto            text not null,                    -- staff e-mail from the verified session, or 'automat'
  odbiorca_nip   text,
  odbiorca_nazwa text,
  telefon        text not null,                    -- E.164, e.g. +48600100200
  tresc          text not null,                    -- exactly what was handed to the provider
  tresc_hash     text not null,                    -- SHA-256 of the text (duplicate guard)
  czesci         int  not null default 1,
  kodowanie      text not null default 'GSM-7' check (kodowanie in ('GSM-7', 'UCS-2')),
  nadawca        text,
  cel            text not null default 'reczny',   -- reczny | termin | podpis_link | test | …
  ref            text,                             -- id of the related object
  status         text not null default 'nowy' check (status in ('nowy', 'test', 'wyslany', 'dostarczony', 'blad', 'odrzucony')),
  test           boolean not null default true,    -- true: provider test mode, nothing was delivered or charged
  provider_id    text,
  provider_status text,                            -- last delivery status reported by the provider
  provider_blad  text,
  koszt          numeric(10, 4),                   -- points charged, when the provider says
  idx            text,                             -- random value sent with the message; a delivery report must repeat it
  dostarczono_at timestamptz,
  constraint sms_wiadomosci_telefon check (telefon ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sms_wiadomosci_nip check (odbiorca_nip is null or odbiorca_nip ~ '^[0-9]{10}$')
);
create index if not exists sms_wiadomosci_created on public.sms_wiadomosci (created_at desc);
create index if not exists sms_wiadomosci_telefon on public.sms_wiadomosci (telefon, created_at desc);
create index if not exists sms_wiadomosci_provider on public.sms_wiadomosci (provider_id) where provider_id is not null;

alter table public.sms_wiadomosci enable row level security;
drop policy if exists sms_wiadomosci_select on public.sms_wiadomosci;
create policy sms_wiadomosci_select on public.sms_wiadomosci for select to authenticated using (
  public.is_portal_admin()
  or (public.has_portal_section('kadry') and (cel = 'termin' or lower(kto) = lower(coalesce(auth.jwt() ->> 'email', ''))))
  or (public.has_portal_section('onboarding') and lower(kto) = lower(coalesce(auth.jwt() ->> 'email', '')))
);
revoke all on public.sms_wiadomosci from anon, authenticated;
-- every column except idx
grant select (id, created_at, kto, odbiorca_nip, odbiorca_nazwa, telefon, tresc, czesci, kodowanie, nadawca, cel, ref,
              status, test, provider_id, provider_status, provider_blad, koszt, dostarczono_at)
  on public.sms_wiadomosci to authenticated;

-- ---------------------------------------------------------------- counters
create table if not exists public.sms_limity (
  dzien  date not null,
  klucz  text not null,                -- 'dzien' | 'nr:<hash>' | 'dup:<hash>:<slot>'  (prefix 'test:' in test mode)
  n      int  not null default 0,
  primary key (dzien, klucz)
);
alter table public.sms_limity enable row level security;
revoke all on public.sms_limity from anon, authenticated;

-- Adds 1 to each of today's counters unless one of them is already at its maximum; then nothing is
-- counted at all. Returns null when everything was counted, otherwise the key that is full.
create or replace function public.sms_rezerwuj(p_klucze text[], p_maxy int[])
returns text language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Europe/Warsaw')::date;
  i int;
  ok boolean;
begin
  if p_klucze is null or p_maxy is null or coalesce(array_length(p_klucze, 1), 0) = 0
     or array_length(p_klucze, 1) <> array_length(p_maxy, 1) then
    raise exception 'sms_rezerwuj: bad arguments';
  end if;
  delete from public.sms_limity where dzien < d - 7;
  begin
    for i in 1 .. array_length(p_klucze, 1) loop
      ok := null;
      if p_maxy[i] >= 1 then
        insert into public.sms_limity as l (dzien, klucz, n) values (d, p_klucze[i], 1)
        on conflict (dzien, klucz) do update set n = l.n + 1 where l.n + 1 <= p_maxy[i]
        returning true into ok;
      end if;
      if ok is not true then
        raise exception using errcode = 'P0001', message = p_klucze[i];
      end if;
    end loop;
  exception when sqlstate 'P0001' then
    return sqlerrm; -- the block's inserts are rolled back
  end;
  return null;
end $$;
revoke all on function public.sms_rezerwuj(text[], int[]) from public, anon, authenticated;
grant execute on function public.sms_rezerwuj(text[], int[]) to service_role;

-- ---------------------------------------------------------------- deadline reminders by SMS
-- The e-mail reminders keep their own key (rodzaj = 'termin_klient'); the SMS that accompanies one is logged
-- as 'termin_klient_sms' and gets the same guarantee: one successful notice per worker / document / date /
-- threshold, even when two runs overlap.
create unique index if not exists portal_powiadomienia_dedupe_sms
  on public.portal_powiadomienia (worker_id, doc_key, doc_date, prog)
  where rodzaj = 'termin_klient_sms' and status = 'ok';
