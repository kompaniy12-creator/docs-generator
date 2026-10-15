// node --test tests/uprawnienia.test.cjs
// The catalogue of Uprawnienia szczegółowe (uprawnienia.js) as the browser uses it: inheritance, normalisation,
// pages, the landing page, and the menu of portal-shell.js / the guard of auth-guard.js against it.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const U = require('../uprawnienia.js');
const czytaj = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const M = (o) => Object.assign({ portal: true }, o);

test('kopia dla funkcji jest identyczna', () => {
  assert.equal(czytaj('supabase/functions/_shared/uprawnienia.js'), czytaj('uprawnienia.js'), 'cp uprawnienia.js supabase/functions/_shared/');
});

test('dziedziczenie: klucz, przodek, podobny prefiks, potomek', () => {
  assert.equal(U.mozna(M({}), 'kadry.kontrola'), true);
  assert.equal(U.mozna(M({ portal_wylaczone: null }), 'kadry.kontrola'), true);
  assert.equal(U.mozna(M({ portal_wylaczone: [] }), 'kadry.kontrola'), true);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry.kontrola'] }), 'kadry.kontrola'), false);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry.kontrola'] }), 'kadry.kontrola.przypomnienia'), false);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry'] }), 'kadry.kontrola.przypomnienia'), false);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry.kontrola.przypomnienia'] }), 'kadry.kontrola'), true);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry.kont'] }), 'kadry.kontrola'), true);
  assert.equal(U.mozna(M({ portal_wylaczone: ['kadry.kontrola'] }), 'kadry.kontrolaX'), true);
});

test('zepsuta lista zamyka wszystko; administrator nigdy nie jest ograniczony', () => {
  for (const zle of ['kadry', 5, 0, true, false, {}]) {
    assert.equal(U.mozna(M({ portal_wylaczone: zle }), 'ogolne.zadania'), false, JSON.stringify(zle));
    assert.equal(U.ograniczony(M({ portal_wylaczone: zle })), true);
    assert.equal(U.mozna(M({ portal_admin: true, portal_wylaczone: zle }), 'ogolne.zadania'), true);
    assert.equal(U.pierwszaStrona(M({ portal_wylaczone: zle })), '');
    assert.equal(U.mozeStrone(M({ portal_wylaczone: zle }), 'zadania.html'), false);
    assert.equal(U.mozeStrone(M({ portal_wylaczone: zle }), 'index.html'), true, 'strona startowa nigdy nie jest zamknięta');
  }
  assert.equal(U.ograniczony(M({})), false);
  assert.equal(U.ograniczony(M({ portal_wylaczone: null })), false);
  assert.equal(U.ograniczony(M({ portal_wylaczone: [] })), true);
  assert.equal(U.ograniczony(M({ portal_admin: true, portal_wylaczone: ['kadry'] })), false);
  assert.equal(U.mozna(null, 'kadry.kontrola'), true); // no metadata at all = no claim (the guard has already required portal: true)
});

test('normalizacja: znane klucze, bez powtórek, potomek znika przy przodku, sortowanie, limity', () => {
  assert.deepEqual(U.normalizuj(['poczta.kadry', 'kadry.akta.ai', 'kadry.akta', 'poczta.kadry']), { ok: true, lista: ['kadry.akta', 'poczta.kadry'] });
  assert.deepEqual(U.normalizuj(undefined), { ok: true, lista: [] });
  assert.equal(U.normalizuj(['kadry.akta', 'kadry.akta.nie_ma']).ok, false);
  assert.equal(U.normalizuj(['ogolne.pulpit']).ok, false, 'funkcja administratora nie wchodzi na listę');
  assert.equal(U.normalizuj(['hasOwnProperty']).ok, false);
  assert.equal(U.normalizuj('kadry').ok, false);
  const wszystkie = U.LISTA.filter((n) => !n.tylkoAdmin).map((n) => n.klucz);
  const n = U.normalizuj(wszystkie);
  assert.equal(n.ok, true);
  assert.deepEqual(n.lista, U.DRZEWO.map((x) => x.klucz).sort());
  for (const s of U.SZABLONY) assert.deepEqual(U.normalizuj(s.wylaczone).lista, s.wylaczone, s.id);
});

test('sekcje: lista wyłączeń nigdy niczego nie dodaje', () => {
  const kadry = M({ portal_sections: ['kadry'], portal_wylaczone: [] });
  assert.equal(U.dostepny(kadry, 'kadry.kontrola'), true);
  assert.equal(U.dostepny(kadry, 'ksiegowosc.zamkniecia'), false);
  assert.equal(U.dostepny(kadry, 'spolka.rejestracja'), false);
  assert.equal(U.dostepny(kadry, 'ogolne.pulpit'), false, 'tylko administrator');
  assert.equal(U.dostepny(kadry, 'klienci.sms'), true, 'jedna z dwóch sekcji wystarcza');
  assert.equal(U.dostepny(kadry, 'asystenci.asystent_legalizacji'), false, 'wymaga obu sekcji');
  assert.equal(U.dostepny(M({ portal_sections: ['kadry', 'legalizacja'] }), 'asystenci.asystent_legalizacji'), true);
  assert.equal(U.dostepny(M({}), 'ksiegowosc.zamkniecia'), true, 'brak listy sekcji = wszystkie');
  assert.equal(U.dostepny(M({ portal_admin: true, portal_sections: [] }), 'ogolne.pulpit'), true);
});

test('strony: klucz z adresu, także z ?s= i ?p=', () => {
  assert.deepEqual(U.kluczeStrony('kontrola.html', ''), ['kadry.kontrola']);
  assert.deepEqual(U.kluczeStrony('historia.html', '?s=kadry'), ['kadry.historia']);
  assert.deepEqual(U.kluczeStrony('historia.html', '?x=1&s=spolka'), ['spolka.historia']);
  assert.deepEqual(U.kluczeStrony('historia.html', ''), ['kadry.historia', 'spolka.historia', 'legalizacja.historia']);
  assert.deepEqual(U.kluczeStrony('historia.html', '?s=wymyslona'), ['kadry.historia', 'spolka.historia', 'legalizacja.historia']);
  assert.deepEqual(U.kluczeStrony('onboarding.html', '?p=/deadlines'), ['klienci.terminy_klientow']);
  assert.deepEqual(U.kluczeStrony('onboarding.html', '?p=%2Fdeadlines%2F5'), ['klienci.terminy_klientow']);
  assert.deepEqual(U.kluczeStrony('onboarding.html', '?p=/clients/7'), ['klienci.onboarding']);
  assert.deepEqual(U.kluczeStrony('onboarding.html', ''), ['klienci.onboarding']);
  assert.deepEqual(U.kluczeStrony('index.html', '?brak=1'), []);
  assert.deepEqual(U.kluczeStrony('/sciezka/poczta.html', ''), ['poczta']);
  const m = M({ portal_sections: ['kadry', 'onboarding'], portal_wylaczone: ['kadry.historia', 'klienci.terminy_klientow'] });
  assert.equal(U.mozeStrone(m, 'historia.html?s=kadry'), false);
  assert.equal(U.mozeStrone(m, 'historia.html?s=spolka'), true);
  assert.equal(U.mozeStrone(m, 'historia.html'), false, 'bez ?s= strona pokazuje wszystkie moduły');
  assert.equal(U.mozeStrone(m, 'onboarding.html?p=/deadlines'), false);
  assert.equal(U.mozeStrone(m, 'onboarding.html'), true);
  assert.equal(U.mozeStrone(m, 'index.html#kadry'), true);
  assert.equal(U.mozeStrone(m, 'kontrola.html#rem'), true);
});

test('strona startowa osoby: pierwsza dozwolona strona menu — i nigdy taka, z której strażnik by zawrócił', () => {
  const k = (wyl) => M({ portal_sections: ['kadry'], portal_wylaczone: wyl });
  assert.equal(U.pierwszaStrona(k([])), 'kontrola.html');
  assert.equal(U.pierwszaStrona(k(['kadry.kontrola'])), 'zatrudnienie.html');
  assert.equal(U.pierwszaStrona(k(['kadry.kontrola', 'kadry.zgloszenia', 'kadry.komplet', 'kadry.dokumenty'])), 'rejestr.html');
  assert.equal(U.pierwszaStrona(k(['kadry'])), 'zgloszenia-klientow.html', 'najpierw strony własnych modułów');
  assert.equal(U.pierwszaStrona(k(['kadry', 'klienci', 'poczta'])), 'zadania.html', 'potem zadania');
  assert.equal(U.pierwszaStrona(k(['kadry', 'klienci', 'poczta', 'ogolne'])), 'historia.html?s=spolka', 'na końcu cokolwiek zostało');
  assert.equal(U.pierwszaStrona(k(['kadry', 'spolka', 'klienci', 'poczta', 'ogolne', 'asystenci'])), '', 'nie ma dokąd — zostaje strona startowa');
  assert.equal(U.pierwszaStrona(M({ portal_sections: ['onboarding'], portal_wylaczone: ['ksiegowosc.zamkniecia'] })), 'terminy-ksiegowe.html');
  // whatever is switched off, the landing page is one the guard lets in (this is what rules the redirect loop out)
  const klucze = U.LISTA.filter((n) => !n.tylkoAdmin).map((n) => n.klucz);
  let ziarno = 7; const los = () => (ziarno = (ziarno * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) {
    const sekcje = U.SEKCJE.map((s) => s[0]).filter(() => los() < 0.5);
    const meta = M({ portal_sections: los() < 0.2 ? undefined : sekcje, portal_wylaczone: klucze.filter(() => los() < 0.35) });
    const p = U.pierwszaStrona(meta);
    if (p) { assert.equal(U.mozeStrone(meta, p), true, p); assert.notEqual(p.split('?')[0], 'index.html'); }
    else for (const s of U.STRONY) if (!U.KLUCZE[s.klucz].tylkoAdmin) assert.equal(U.mozeStrone(meta, s.href), false, s.href);
  }
});

test('menu (portal-shell.js) i strażnik (auth-guard.js): każda strona ma klucz, sekcje zgadzają się z katalogiem', () => {
  const shell = czytaj('portal-shell.js'), guard = czytaj('auth-guard.js');
  const hrefy = [...shell.matchAll(/\{ href: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(hrefy.length >= 30);
  for (const h of hrefy) {
    if (h.startsWith('index.html')) continue;
    const q = h.split('?');
    assert.ok(U.kluczeStrony(q[0], q[1] ? '?' + q[1] : '').length === 1, 'brak klucza dla pozycji menu ' + h);
  }
  // pages opened from the start page's panels
  for (const p of ['rejestracja.html', 'wynagrodzenie.html', 'e-urzad.html', 'pelnomocnictwo.html', 'nip-8.html']) assert.equal(U.kluczeStrony(p, '').length, 1, p);
  // the guard's own table: the same section(s) as the catalogue, administrator pages marked as such
  const blok = /var PAGE_SECTION = \{([\s\S]*?)\n  \};/.exec(guard)[1];
  const wpisy = [...blok.matchAll(/'([a-z0-9-]+\.html)'\s*:\s*(\[[^\]]*\]|'[^']*')/g)];
  assert.ok(wpisy.length >= 25);
  for (const [, strona, sek] of wpisy) {
    const n = U.KLUCZE[U.kluczeStrony(strona, '')[0]];
    assert.ok(n, strona);
    const wart = sek.startsWith('[') ? [...sek.matchAll(/'([^']+)'/g)].map((m) => m[1]) : sek.slice(1, -1);
    if (wart === '@admin') assert.equal(n.tylkoAdmin, true, strona);
    else { assert.equal(n.tylkoAdmin, false, strona); assert.deepEqual(n.sekcja, wart, strona); }
  }
  // the guard fetches the catalogue only for a restricted account, and the start page is never denied
  assert.match(guard, /if \(!isRestricted\(session\.user\)\) \{ enter\(session, false, null\); return; \}/);
  assert.match(guard, /page === 'index\.html' \|\|/);
});

test('status blokady: „blokada na serwerze” tylko tam, gdzie funkcja albo baza odmawia już dziś', () => {
  const st = (k) => U.KLUCZE[k].status;
  assert.equal(st('kadry.akta.ai'), 'serwer');
  assert.equal(st('kadry.kontrola'), 'serwer_czesc');
  assert.equal(st('klienci.sms.historia'), 'serwer');
  assert.equal(st('kadry.rejestr'), 'strona');
  assert.equal(st('kadry.akta'), 'serwer');
  assert.equal(st('kadry.akta.usun'), 'serwer');
  assert.equal(st('wspolne.krs'), 'serwer');
  assert.equal(st('poczta.kadry.wyslij'), 'serwer');
  // all three phases are live: nothing waits any more, and every partial block says why
  assert.equal(U.FAZA, 3);
  for (const n of U.LISTA) {
    assert.ok(!['oczekuje', 'strona_oczekuje'].includes(n.status), n.klucz + ' nadal czeka na blokadę');
    assert.ok(n.egz.every((x) => x.faza <= U.FAZA), n.klucz);
    assert.equal(n.status === 'serwer_czesc', n.powod.length > 20, n.klucz + ': częściowa blokada ma opis, pełna — nie');
  }
  assert.deepEqual(U.LISTA.filter((n) => n.status === 'serwer_czesc').map((n) => n.klucz), ['kadry.kontrola', 'kadry.zgloszenia', 'klienci.baza', 'klienci.baza.kontakty']);
  assert.equal(st('ogolne.pulpit'), 'admin');
  assert.equal(st('kadry.dane'), 'grupa');
  for (const n of U.LISTA) assert.ok(typeof U.STATUSY[n.status] === 'string', n.klucz);
  assert.equal(U.etykieta('kadry.akta.ai'), 'Kadry › Akta osobowe › Rozpoznawanie skanu (AI)');
});
