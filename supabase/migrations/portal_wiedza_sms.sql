-- Knowledge base: the rules the SMS module relies on (page sms.html, function sms, SMS channel of terminy).
-- NOT RUN by the assistant that wrote it — to be reviewed and run by the orchestrator.
-- Read on 2026-10-09 in the ELI register: Prawo komunikacji elektronicznej, Dz.U. 2024 poz. 1221 — text
-- consolidated by the Sejm Chancellery as of 2026-07-07 (incl. Dz.U. 2025 poz. 637, 820 and 2026 poz. 252,
-- 815); the amendment Dz.U. 2026 poz. 1296 (in force from 2026-11-06) changes art. 419 only, not art. 398
-- and not art. 2 pkt 2 of the e-services act. Ustawa o świadczeniu usług drogą elektroniczną: t.j.
-- Dz.U. 2024 poz. 1513. RODO: regulation (EU) 2016/679 (no ELI entry — an EU act).

insert into public.portal_prawo_akty (eli, tytul, skrot) values
  ('DU/2024/1221', 'Ustawa – Prawo komunikacji elektronicznej', 'Prawo komunikacji elektronicznej'),
  ('DU/2002/1204', 'Ustawa o świadczeniu usług drogą elektroniczną', 'Ustawa o świadczeniu usług drogą elektroniczną')
on conflict (eli) do nothing;

insert into public.portal_wiedza (id, dzial, temat, tresc, podstawa, eli, zweryfikowano, kolejnosc) values
('sms-zgoda-informacja-handlowa', 'Powiadomienia SMS', 'Kiedy SMS wymaga uprzedniej zgody odbiorcy',
 $$Zakazane jest używanie automatycznych systemów wywołujących oraz telekomunikacyjnych urządzeń końcowych (w tym SMS) do przesyłania informacji handlowej, w tym marketingu bezpośredniego, do abonenta lub użytkownika końcowego, chyba że uprzednio wyraził on na to zgodę. Zakaz dotyczy wyłącznie informacji handlowej. SMS wysyłany klientowi biura w wykonaniu umowy o obsługę — przypomnienie o kończącym się dokumencie lub umowie jego pracownika, informacja o dokumentach do podpisu, prośba o kontakt lub o dostarczenie dokumentów — nie promuje towarów, usług ani wizerunku, więc nie jest informacją handlową i nie wymaga zgody z art. 398. Warunki: (1) treść dotyczy wyłącznie bieżącej obsługi tego klienta; (2) żadnych ofert, promocji, zachęt do nowych usług, haseł reklamowych ani linków do strony biura; (3) wiadomość idzie na numer, który klient podał biuru do kontaktu w sprawach obsługi; (4) nazwa biura w treści służy identyfikacji nadawcy, nie reklamie. Każdy SMS z ofertą wymaga uprzedniej zgody — portal takich wiadomości nie przewiduje.$$,
 'art. 398 ust. 1 Prawa komunikacji elektronicznej', 'DU/2024/1221', '2026-10-09', 700),
('sms-informacja-handlowa-definicja', 'Powiadomienia SMS', 'Co jest informacją handlową',
 $$Informacja handlowa to każda informacja przeznaczona bezpośrednio lub pośrednio do promowania towarów, usług lub wizerunku przedsiębiorcy lub osoby wykonującej zawód regulowany. Nie jest nią informacja umożliwiająca porozumiewanie się za pomocą środków komunikacji elektronicznej z określoną osobą ani informacja o towarach i usługach niesłużąca osiągnięciu efektu handlowego pożądanego przez podmiot zlecający jej rozpowszechnianie. O kwalifikacji decyduje cel i treść wiadomości, nie jej nazwa: „przypomnienie” z dopiskiem o nowej ofercie jest informacją handlową.$$,
 'art. 2 pkt 2 ustawy o świadczeniu usług drogą elektroniczną', 'DU/2002/1204', '2026-10-09', 701),
('sms-zgoda-forma', 'Powiadomienia SMS', 'Zgoda na informację handlową — jak się ją uzyskuje',
 $$Zgoda na przesyłanie informacji handlowej może być wyrażona przez udostępnienie przez odbiorcę identyfikującego go adresu elektronicznego w celu przesyłania informacji handlowej na ten adres. Do uzyskania zgody stosuje się odpowiednio przepisy o ochronie danych osobowych (zgoda dobrowolna, konkretna, świadoma i jednoznaczna; możliwa do wycofania w każdej chwili — art. 4 pkt 11 i art. 7 RODO). Przesyłanie informacji handlowej nie może odbywać się na koszt odbiorcy.$$,
 'art. 398 ust. 2 i 3, art. 400 Prawa komunikacji elektronicznej', 'DU/2024/1221', '2026-10-09', 702),
('sms-sankcje', 'Powiadomienia SMS', 'Sankcje za informację handlową bez zgody',
 $$Przesłanie informacji handlowej bez uprzedniej zgody stanowi czyn nieuczciwej konkurencji. Za niewypełnienie obowiązku uzyskania zgody Prezes UKE nakłada, w drodze decyzji, karę pieniężną w wysokości do 3% przychodu ukaranego podmiotu osiągniętego w poprzednim roku kalendarzowym lub do 1 000 000 zł — zastosowanie ma kwota wyższa.$$,
 'art. 398 ust. 4 i art. 446 ust. 5 Prawa komunikacji elektronicznej', 'DU/2024/1221', '2026-10-09', 703),
('sms-rodo-podstawa', 'Powiadomienia SMS', 'Podstawa przetwarzania numeru telefonu i treści SMS',
 $$Numer telefonu klienta będącego osobą fizyczną (jednoosobowa działalność) biuro przetwarza, bo jest to niezbędne do wykonania umowy o obsługę, której ta osoba jest stroną (art. 6 ust. 1 lit. b RODO). Numer osoby kontaktowej lub reprezentanta spółki — na podstawie prawnie uzasadnionego interesu administratora, jakim jest wykonywanie umowy z tą spółką i bieżący kontakt (art. 6 ust. 1 lit. f RODO); osobie tej przysługuje prawo sprzeciwu (art. 21 ust. 1 RODO). Dane pracowników klienta biuro przetwarza w imieniu klienta jako podmiot przetwarzający (art. 28 RODO) — przypomnienie pracodawcy o dokumencie jego pracownika mieści się w powierzonym przetwarzaniu. Minimalizacja i poufność (art. 5 ust. 1 lit. c i f, art. 32 RODO): w SMS-ie tylko inicjały pracownika, rodzaj dokumentu i data; bez pełnego nazwiska, PESEL, numeru dokumentu, kwot i linków dających dostęp do danych — SMS nie jest szyfrowany i wyświetla się na zablokowanym ekranie.$$,
 'art. 5 ust. 1 lit. c i f, art. 6 ust. 1 lit. b i f, art. 21 ust. 1, art. 28, art. 32 RODO (rozporządzenie (UE) 2016/679)', null, '2026-10-09', 704),
('sms-dostawca-powierzenie', 'Powiadomienia SMS', 'Dostawca SMS jako podmiot przetwarzający',
 $$SMS-y wysyła SMSAPI — usługa LINK Mobility Poland sp. z o.o. z siedzibą w Gliwicach. Dostawca przetwarza numery odbiorców i treść wiadomości w imieniu biura, więc potrzebna jest umowa powierzenia (art. 28 ust. 3 RODO); według regulaminu usługi stanowi ją załącznik do regulaminu (klient = administrator, LINK = podmiot przetwarzający), a dane są przetwarzane na terenie EOG — do potwierdzenia w aktualnym regulaminie i w panelu klienta przed włączeniem wysyłki. Tam, gdzie biuro samo jest podmiotem przetwarzającym (dane pracowników klienta w treści SMS), dostawca staje się dalszym podmiotem przetwarzającym: wymaga to zgody klienta — szczegółowej lub ogólnej — zapisanej w umowie powierzenia z klientem (art. 28 ust. 2 i 4 RODO). Dostawcę SMS należy wymienić w klauzuli informacyjnej jako odbiorcę danych (art. 13 ust. 1 lit. e RODO).$$,
 'art. 13 ust. 1 lit. e, art. 28 ust. 2–4 RODO (rozporządzenie (UE) 2016/679)', null, '2026-10-09', 705)
on conflict (id) do update set dzial = excluded.dzial, temat = excluded.temat, tresc = excluded.tresc,
  podstawa = excluded.podstawa, eli = excluded.eli, zweryfikowano = excluded.zweryfikowano, kolejnosc = excluded.kolejnosc;
