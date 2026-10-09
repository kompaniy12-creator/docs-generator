-- Baza klientów: the portal is the master of the clients list (the Google Sheet is retired).
-- portal_klienci is the store of record; it is edited only through the klienci-baza function
-- (administrators), which calls klienci_zapisz(): one transaction that writes the client, keeps
-- klienci_baza in step, moves the client's id when its NIP (or, without a NIP, its name) changes,
-- and appends who changed what. Purely additive.

create table if not exists public.klienci_zmiany (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  klient      text not null references public.klienci_baza (id) on update cascade,
  kto         text not null,                        -- staff e-mail from the verified session
  akcja       text not null check (akcja in ('dodanie', 'edycja', 'zmiana_id')),
  poprzedni   text,                                 -- the id before a change of NIP / name
  zmiany      jsonb not null default '[]'::jsonb    -- [{pole, bylo, jest}]
);
create index if not exists klienci_zmiany_klient on public.klienci_zmiany (klient, created_at desc);
alter table public.klienci_zmiany enable row level security;
drop policy if exists klienci_zmiany_select on public.klienci_zmiany;
create policy klienci_zmiany_select on public.klienci_zmiany for select to authenticated using (public.is_portal_admin());
revoke all on public.klienci_zmiany from anon, authenticated;
grant select on public.klienci_zmiany to authenticated;

-- p_id: the client being edited (null = a new client); p_nowe_id: the id the data gives (NIP, or
-- 'nazwa:<lower-case name>'), computed by the function the same way the list has always been keyed;
-- p_dane: the whole row (nazwa, nip, adres, …, telegram, jezyk). Returns the client's id afterwards.
-- When the id changes, the tables of this module follow it: klienci_rejestr, klienci_umowy,
-- klienci_status_historia and klienci_zmiany through their foreign keys (on update cascade),
-- klienci_umowy_usuniete here. Tables of other modules keyed by NIP are not touched.
create or replace function public.klienci_zapisz(p_id text, p_nowe_id text, p_dane jsonb, p_kto text, p_zmiany jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_nip   text := coalesce(p_dane ->> 'nip', '');
  v_nazwa text := btrim(coalesce(p_dane ->> 'nazwa', ''));
  v_poz   jsonb;
  v_old   public.portal_klienci;
begin
  if coalesce(p_kto, '') = '' then raise exception 'brak osoby zmieniającej'; end if;
  if v_nazwa = '' then raise exception 'brak nazwy'; end if;
  if v_nip <> '' and v_nip !~ '^[0-9]{10}$' then raise exception 'nieprawidłowy NIP'; end if;
  if jsonb_typeof(p_dane) <> 'object' or pg_column_size(p_dane) > 20000 then raise exception 'nieprawidłowe dane'; end if;
  if (v_nip <> '' and p_nowe_id <> v_nip) or (v_nip = '' and (p_nowe_id not like 'nazwa:_%' or length(p_nowe_id) > 300)) then raise exception 'nieprawidłowy identyfikator'; end if;

  if p_id is null then
    if exists (select 1 from public.portal_klienci where id = p_nowe_id) or exists (select 1 from public.klienci_baza where id = p_nowe_id) then raise exception 'klient_istnieje'; end if;
    select to_jsonb(coalesce(max((dane ->> 'poz')::int), -1) + 1) into v_poz from public.portal_klienci where dane ->> 'poz' ~ '^[0-9]+$';
    insert into public.portal_klienci (id, nip, dane, synced_at) values (p_nowe_id, v_nip, p_dane || jsonb_build_object('poz', v_poz), now());
  else
    select * into v_old from public.portal_klienci where id = p_id for update;
    if not found then raise exception 'nie ma takiego klienta'; end if;
    if p_nowe_id <> p_id then
      if exists (select 1 from public.portal_klienci where id = p_nowe_id) or exists (select 1 from public.klienci_baza where id = p_nowe_id) then raise exception 'klient_istnieje'; end if;
      update public.klienci_baza set id = p_nowe_id where id = p_id;
      update public.klienci_umowy_usuniete set klient = p_nowe_id where klient = p_id;
    end if;
    update public.portal_klienci
       set id = p_nowe_id, nip = v_nip, dane = p_dane || jsonb_build_object('poz', coalesce(v_old.dane -> 'poz', '0'::jsonb)), synced_at = now()
     where id = p_id;
  end if;

  insert into public.klienci_baza as b (id, nip, nazwa, forma, opodatkowanie, adres, miasto, opiekun, kadrowy, w_arkuszu, arkusz_at, brak_od)
  values (p_nowe_id, nullif(v_nip, ''), v_nazwa, nullif(p_dane ->> 'forma', ''), nullif(p_dane ->> 'opodatkowanie', ''), nullif(p_dane ->> 'adres', ''), nullif(p_dane ->> 'miasto', ''),
          nullif(p_dane ->> 'opiekun', ''), nullif(p_dane ->> 'kadrowy', ''), true, now(), null)
  on conflict (id) do update set nip = excluded.nip, nazwa = excluded.nazwa, forma = excluded.forma, opodatkowanie = excluded.opodatkowanie, adres = excluded.adres,
          miasto = excluded.miasto, opiekun = excluded.opiekun, kadrowy = excluded.kadrowy, w_arkuszu = true, arkusz_at = now(), brak_od = null;

  insert into public.klienci_zmiany (klient, kto, akcja, poprzedni, zmiany)
  values (p_nowe_id, p_kto, case when p_id is null then 'dodanie' when p_nowe_id <> p_id then 'zmiana_id' else 'edycja' end,
          case when p_id is not null and p_nowe_id <> p_id then p_id end, coalesce(p_zmiany, '[]'::jsonb));
  return p_nowe_id;
end $$;
revoke all on function public.klienci_zapisz(text, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.klienci_zapisz(text, text, jsonb, text, jsonb) to service_role;
