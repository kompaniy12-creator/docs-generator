-- Public site td-group.pl: contact-form submissions and a page-view counter (edge function `strona`).
-- Both tables are service-role only: no policies, so the site itself and portal sessions read nothing here.

create table if not exists public.strona_zgloszenia (
  id uuid primary key default gen_random_uuid(),
  utworzono timestamptz not null default now(),
  imie text not null,
  email text not null,
  telefon text not null default '',
  firma text not null default '',
  wiadomosc text not null default '',
  wycena text not null default '',
  jezyk text not null default 'pl',
  strona text not null default '',
  mail_ok boolean
);
create index if not exists strona_zgloszenia_utworzono on public.strona_zgloszenia (utworzono desc);
alter table public.strona_zgloszenia enable row level security;
revoke all on public.strona_zgloszenia from anon;
revoke all on public.strona_zgloszenia from authenticated;

-- one row per day, page and kind of source: a number only, nothing about the visitor
create table if not exists public.strona_wizyty (
  dzien date not null,
  sciezka text not null,
  zrodlo text not null,
  licznik integer not null default 0,
  primary key (dzien, sciezka, zrodlo)
);
alter table public.strona_wizyty enable row level security;
revoke all on public.strona_wizyty from anon;
revoke all on public.strona_wizyty from authenticated;

create or replace function public.strona_wizyta(p_sciezka text, p_zrodlo text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.strona_wizyty (dzien, sciezka, zrodlo, licznik)
  values ((now() at time zone 'Europe/Warsaw')::date, p_sciezka, p_zrodlo, 1)
  on conflict (dzien, sciezka, zrodlo) do update set licznik = public.strona_wizyty.licznik + 1;
$$;
revoke all on function public.strona_wizyta(text, text) from public;
revoke all on function public.strona_wizyta(text, text) from anon;
revoke all on function public.strona_wizyta(text, text) from authenticated;
grant execute on function public.strona_wizyta(text, text) to service_role;
