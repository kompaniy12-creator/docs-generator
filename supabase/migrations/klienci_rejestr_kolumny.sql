-- Security review 2026-10-09: the raw register answers (dane, surowe) hold board members' and
-- shareholders' birth dates; portal users read only the extracted columns, the raw JSON stays
-- with the service role.
revoke select on public.klienci_rejestr from authenticated;
grant select (id, klient, nip, fetched_at, sprawdzono_at, zrodlo, znaleziono, krs, regon, nazwa, forma,
  data_rejestracji, kapital, adres, organ, reprezentacja, zarzad, wspolnicy, prokurenci, pkd, stan, zmiany, odcisk)
  on public.klienci_rejestr to authenticated;
revoke truncate, references, trigger on public.klienci_umowy from authenticated;
