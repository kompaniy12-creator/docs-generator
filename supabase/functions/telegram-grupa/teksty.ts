// Default texts of a new client group — the office's own messages as they stand in the existing groups
// (accounts and people replaced by placeholders). Data only; edited in the portal: Baza klientów → Szablon grupy.
// Generated once from the office's texts; change the wording in the portal, not here.

export const WAZNE = "<strong>WAŻNE INFORMACJE / ВАЖНАЯ ИНФОРМАЦИЯ / ВАЖЛИВА ІНФОРМАЦІЯ</strong>\n" +
  "\n" +
  "Aby ułatwić współpracę, grupa została podzielona na 3 tematy:\n" +
  "Чтобы упростить сотрудничество, группа разделена на 3 темы:\n" +
  "Щоб спростити співпрацю, групу поділено на 3 теми:\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>1. OGÓLNE / ОБЩАЯ / ЗАГАЛЬНА</strong>\n" +
  "Tutaj piszemy wszystkie ogólne pytania, prośby, informacje organizacyjne.\n" +
  "Сюда пишем все общие вопросы, просьбы, организационные моменты.\n" +
  "Сюди пишемо всі загальні питання, прохання, організаційні моменти.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>2. KSIĘGOWOŚĆ / БУХГАЛТЕРИЯ / БУХГАЛТЕРІЯ</strong>\n" +
  "Tu kierujemy wszystkie dokumenty i pytania dotyczące faktur, kosztów, rozliczeń, podatków i raportów.\n" +
  "Сюда отправляем документы и вопросы, касающиеся счетов, затрат, отчетности, налогов и бухгалтерии.\n" +
  "Сюди надсилаємо документи та питання щодо рахунків, витрат, звітності, податків і бухгалтерії.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>3. KADRY / КАДРЫ / КАДРИ</strong>\n" +
  "Tutaj zgłaszamy zmiany w zatrudnieniu, dokumenty pracownicze, umowy, ZUS, urlopy, L4.\n" +
  "Сюда направляем информацию по сотрудникам: приёмы, увольнения, договоры, ZUS, отпуска, больничные и т.д.\n" +
  "Сюди надсилаємо інформацію про працівників: прийоми, звільнення, договори, ZUS, відпустки, лікарняні тощо.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Jeśli masz wątpliwości, napisz w temacie OGÓLNE — skierujemy dalej.\n" +
  "Если не уверены, куда писать — напишите в теме ОБЩАЯ, мы перенаправим.\n" +
  "Якщо не впевнені, куди писати — напишіть у темі ЗАГАЛЬНА, ми перенаправимо.";

export const POWITANIE = "<strong>Добрый день! Рады приветствовать вас в нашей рабочей группе!</strong>\n" +
  "Чтобы ваше сотрудничество с нами было максимально удобным и эффективным, давайте познакомимся:\n" +
  "\n" +
  "<strong>Сергей</strong> - руководитель бюро\n" +
  "@twojaksiegowa_admin - по всем административным вопросам вы можете обращаться ко мне.\n" +
  "\n" +
  "{{#ma_ksiegowa}}<strong>{{ksiegowa_imie}}</strong> - ваш бухгалтер\n" +
  "@{{ksiegowa_tg}} - помогает с налогами, отчётностью и всеми бухгалтерскими вопросами.\n" +
  "\n" +
  "{{/ma_ksiegowa}}{{#ma_kadrowa}}<strong>{{kadrowa_imie}}</strong> - ваш кадровый специалист\n" +
  "@{{kadrowa_tg}} - отвечает за трудоустройство, кадровые процессы и документы.\n" +
  "\n" +
  "{{/ma_kadrowa}}<strong>Наш бот</strong>\n" +
  "@twojksiegowy_bot - будет присылать вам важные новости, напоминания о сроках и полезную информацию.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если возникнут вопросы - пишите, мы всегда на связи и рады помочь!\n" +
  "Спасибо, что выбрали нас!";

export const PLATNOSCI_OGOLNE = "<strong>Инструкция по оплате налогов и ZUS</strong>\n" +
  "\n" +
  "<strong>1. Оплата налогов (PIT, VAT)</strong>\n" +
  "Используйте микросчёт налогоплательщика:\n" +
  "<strong>{{mikrorachunek}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "• NIP\n" +
  "• тип налога (например: PIT-4R, PIT-28, PIT-36, VAT-7)\n" +
  "• месяц/период, за который производится оплата\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>2. Оплата взносов ZUS</strong>\n" +
  "Счёт для оплаты ZUS:\n" +
  "<strong>{{rachunek_zus}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "Wplata ZUS - месяц и год\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если нужна помощь - пишите, всё подскажем и проверим 🙂";

export const PLATNOSCI_RYCZALT = "<strong>Инструкция по оплате налогов и ZUS</strong>\n" +
  "\n" +
  "<strong>1. Оплата налогов (PIT-28, PIT-4, VAT-7)</strong>\n" +
  "Используйте микросчёт налогоплательщика:\n" +
  "<strong>{{mikrorachunek}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "• NIP\n" +
  "• тип налога (например: PIT-4, PIT-28, VAT-7)\n" +
  "• месяц/период, за который производится оплата\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>2. Оплата взносов ZUS</strong>\n" +
  "Счёт для оплаты ZUS:\n" +
  "<strong>{{rachunek_zus}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "Wplata ZUS - месяц и год\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если нужна помощь - пишите, всё подскажем и проверим 🙂";

export const PLATNOSCI_SKALA = "<strong>Инструкция по оплате налогов и ZUS</strong>\n" +
  "\n" +
  "<strong>1. Оплата налогов (PIT-36, PIT-4, VAT-7)</strong>\n" +
  "Используйте микросчёт налогоплательщика:\n" +
  "<strong>{{mikrorachunek}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "• NIP\n" +
  "• тип налога (например: PIT-4, PIT-36, VAT-7)\n" +
  "• месяц/период, за который производится оплата\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>2. Оплата взносов ZUS</strong>\n" +
  "Счёт для оплаты ZUS:\n" +
  "<strong>{{rachunek_zus}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "Wplata ZUS - месяц и год\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если нужна помощь - пишите, всё подскажем и проверим 🙂";

export const PLATNOSCI_CIT = "<strong>Инструкция по оплате налогов и ZUS</strong>\n" +
  "\n" +
  "<strong>1. Оплата налогов (CIT, PIT-4, VAT-7)</strong>\n" +
  "Используйте микросчёт налогоплательщика:\n" +
  "<strong>{{mikrorachunek}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "• NIP\n" +
  "• тип налога (например: CIT, PIT-4, VAT-7)\n" +
  "• месяц/период, за который производится оплата\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>2. Оплата взносов ZUS</strong>\n" +
  "Счёт для оплаты ZUS:\n" +
  "<strong>{{rachunek_zus}}</strong>\n" +
  "В названии платежа укажите:\n" +
  "Wplata ZUS - месяц и год\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если нужна помощь - пишите, всё подскажем и проверим 🙂";

export const KADRY_RU = "<strong>Инструкция по трудоустройству новых сотрудников</strong>\n" +
  "\n" +
  "Добрый день!\n" +
  "Для оформления новых работников просим направлять всю информацию на e-mail: <a href=\"mailto:kadry@td-group.pl\">kadry@td-group.pl</a>\n" +
  "\n" +
  "Чтобы мы могли оперативно подготовить документы, пожалуйста, отправляйте полные данные согласно списку ниже:\n" +
  "\n" +
  "<strong>1. Документы работника</strong>\n" +
  "\n" +
  "Отправьте скан-копии или чёткие фото:\n" +
  " • Паспорт (все страницы с отметками)\n" +
  " • PESEL (если есть)\n" +
  " • Карта побыта / децизия (если есть)\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "2. Адрес проживания\n" +
  "\n" +
  "Укажите актуальный адрес, по которому проживает работник в Польше.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "3. Информация по трудоустройству\n" +
  "\n" +
  "Укажите:\n" +
  " • Должность\n" +
  " • Тип договора (<strong>umowa zlecenia</strong> или <strong>umowa o pracę)</strong>\n" +
  " • Количество часов или ставка\n" +
  " • Почасовая\n" +
  " • Фиксированная (месячная)\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "<strong>4. Дополнительная информация</strong>\n" +
  "\n" +
  "Если сотрудник подаёт документы на карту побыта по работе, обязательно сообщите.\n" +
  "Это влияет на параметры договора:\n" +
  " • при umowa zlecenia для карты побыта работник обязан отработать не менее 160 часов в месяц при ставке минимум {{stawka_godzinowa}} zł брутто/час.\n" +
  "\n" +
  "⸻\n" +
  "\n" +
  "Если какой-то информации не хватает, оформление может задержаться - заранее спасибо за полноту данных!\n" +
  "\n" +
  "⸻";

export const KADRY_3J = "Dzień dobry!\n" +
  "W celu zatrudnienia nowych pracowników prosimy o przesłanie informacji drogą mailową na adres: <a href=\"mailto:kadry@td-group.pl\">kadry@td-group.pl</a>\n" +
  "\n" +
  "Do zatrudnienia należy wysłać:\n" +
  "\n" +
  "Dokumenty pracownika (paszport – wszystkie strony z pieczątkami, PESEL, karta pobytu / decyzja).\n" +
  "\n" +
  "Adres zamieszkania.\n" +
  "\n" +
  "Stanowisko pracownika, rodzaj umowy, ilość godzin lub etat, stawka godzinowa albo stała.\n" +
  "\n" +
  "Jeżeli któryś z pracowników składa wniosek o kartę pobytu na podstawie pracy – prosimy o informację. (Od tego zależy minimalna liczba godzin pracy: przy umowie zlecenia pracownik musi przepracować min. 160 godzin miesięcznie ze stawką {{stawka_godzinowa}} zł brutto).\n" +
  "\n" +
  "_______________________________________\n" +
  "\n" +
  "Доброго дня!\n" +
  "Для працевлаштування нових працівників просимо надсилати інформацію на email: <a href=\"mailto:kadry@td-group.pl\">kadry@td-group.pl</a>\n" +
  "\n" +
  "Для працевлаштування необхідно надати:\n" +
  "\n" +
  "Документи працівника (паспорт – усі сторінки з відмітками, PESEL, карта побиту / децизія).\n" +
  "\n" +
  "Адресу проживання.\n" +
  "\n" +
  "Посаду працівника, тип договору, кількість годин або повна/часткова зайнятість, погодинна чи фіксована ставка.\n" +
  "\n" +
  "Якщо хтось із працівників подає на карту побиту від роботи – просимо повідомити. (Від цього залежить мінімальна кількість годин: за umowa zlecenia потрібно працювати мінімум 160 годин на місяць зі ставкою {{stawka_godzinowa}} зл брутто).\n" +
  "\n" +
  "_______________________________________\n" +
  "\n" +
  "Добрый день!\n" +
  "Для трудоустройства новых работников просим высылать информацию на email: <a href=\"mailto:kadry@td-group.pl\">kadry@td-group.pl</a>\n" +
  "\n" +
  "Для оформления необходимо:\n" +
  "\n" +
  "Документы работника (паспорт – все страницы с отметками, PESEL, карта побыта / децизия).\n" +
  "\n" +
  "Адрес проживания.\n" +
  "\n" +
  "Должность работника, тип договора, количество часов или ставка (почасовая либо фиксированная).\n" +
  "\n" +
  "Если кто-то из работников подает на карту побыта от работы – просим сообщить. (От этого зависит минимальное количество часов: по umowa zlecenia сотрудник обязан отработать не менее 160 часов в месяц при ставке {{stawka_godzinowa}} зл брутто).";
