-- Baza klientów: hardening after the security review of 2026-10-09.

-- 1) Daily counters: paid register requests (all together) and contract readings (per user).
--    Service role only; the function asks klienci_limit() before every paid call.
create table if not exists public.klienci_limity (
  dzien  date not null default current_date,
  klucz  text not null,                -- 'rejestr' | 'odczyt:<e-mail>'
  n      int  not null default 0,
  primary key (dzien, klucz)
);
alter table public.klienci_limity enable row level security;
revoke all on public.klienci_limity from anon, authenticated;

-- adds p_ile to today's counter unless that would pass p_max; true = allowed (one atomic statement)
create or replace function public.klienci_limit(p_klucz text, p_max int, p_ile int default 1)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ok boolean := false;
begin
  if p_ile < 1 or p_ile > p_max then return false; end if;
  insert into public.klienci_limity as l (dzien, klucz, n) values (current_date, p_klucz, p_ile)
  on conflict (dzien, klucz) do update set n = l.n + excluded.n where l.n + excluded.n <= p_max
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.klienci_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.klienci_limit(text, int, int) to service_role;

-- 2) Deleted contracts: who removed which file and when, with the file's SHA-256. Written by the function
--    (action usun_umowe) — a contract can no longer be deleted straight from the browser, so neither a
--    row without a file nor a file without a row can be left behind.
create table if not exists public.klienci_umowy_usuniete (
  id            uuid primary key default gen_random_uuid(),
  usunieto_at   timestamptz not null default now(),
  usunal        text not null,
  umowa_id      uuid not null,
  klient        text,
  nazwa         text,
  path          text,
  rozmiar       int,
  sha256        text,
  rodzaj        text,
  data_zawarcia date,
  uploaded_by   text,
  wgrano_at     timestamptz
);
alter table public.klienci_umowy_usuniete enable row level security;
drop policy if exists klienci_umowy_usuniete_select on public.klienci_umowy_usuniete;
create policy klienci_umowy_usuniete_select on public.klienci_umowy_usuniete for select to authenticated using (public.is_portal_admin());
revoke all on public.klienci_umowy_usuniete from anon, authenticated;
grant select on public.klienci_umowy_usuniete to authenticated;

revoke delete on public.klienci_umowy from authenticated;
drop policy if exists klienci_umowy_obj_delete on storage.objects;

-- 3) Birth dates of board members and shareholders are not kept in the stored register answers.
update public.klienci_rejestr r
   set dane = r.dane
     || case when jsonb_typeof(r.dane -> 'zarzad') = 'array' then jsonb_build_object('zarzad', (select coalesce(jsonb_agg(e - 'dataUr'), '[]'::jsonb) from jsonb_array_elements(r.dane -> 'zarzad') e)) else '{}'::jsonb end
     || case when jsonb_typeof(r.dane -> 'wspolnicy') = 'array' then jsonb_build_object('wspolnicy', (select coalesce(jsonb_agg(e - 'dataUr'), '[]'::jsonb) from jsonb_array_elements(r.dane -> 'wspolnicy') e)) else '{}'::jsonb end
 where r.dane::text like '%dataUr%';
