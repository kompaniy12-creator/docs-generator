-- Baza klientów: scope of service. What the office does for a client follows from the caretakers in the
-- clients sheet (they sync into klienci_baza): no accounting caretaker (opiekun) — no accounting,
-- no HR caretaker (kadrowy) — no HR and payroll. Two columns are added at the end of the view; the rest is unchanged.
create or replace view public.klienci_obsluga with (security_invoker = true) as
  select id, nip, nazwa, status, obsluga_od, koniec_od, w_arkuszu,
         not (status = 'zakonczony' and koniec_od <= current_date) as obslugiwany,
         coalesce(btrim(opiekun), '') <> '' as zakres_ksiegowosc,
         coalesce(btrim(kadrowy), '') <> '' as zakres_kadry
    from public.klienci_baza;
revoke all on public.klienci_obsluga from anon, authenticated;
grant select on public.klienci_obsluga to authenticated;
