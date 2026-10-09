-- Podpisy: more document kinds (single HR documents from dokumenty.html).
-- Only widens the list of allowed values in podpisy_dokumenty.rodzaj; every earlier kind stays.
-- The rules for each kind live in supabase/functions/podpisy/checks.ts (RODZAJE, regula()).
alter table public.podpisy_dokumenty drop constraint if exists podpisy_dokumenty_rodzaj_check;
alter table public.podpisy_dokumenty add constraint podpisy_dokumenty_rodzaj_check check (rodzaj in (
  'umowa_praca', 'aneks_praca', 'umowa_zlecenie', 'aneks_zlecenie', 'tlumaczenie',
  'zwiazki_info', 'rozwiazanie', 'ppk_rezygnacja', 'odpowiedzialnosc', 'pit2', 'kwestionariusz', 'oswiadczenie',
  'zgoda_rodo', 'informacja_warunki', 'inny',
  'zakaz_konkurencji', 'kara_porzadkowa', 'zgoda_potracenie', 'swiadectwo_pracy', 'skierowanie_badania', 'upowaznienie_rodo',
  'oswiadczenie_cudz_tresc', 'ppk_wniosek', 'wypowiedzenie_zlecenia', 'informacja_monitoring', 'informacja_dokumentacja',
  'informacja_dok_pobytowy'));
