// Bladwijzerpaneel (#578): de bladwijzer van de pagina in beeld blijft
// gemarkeerd, en het zoekveld springt naar een bladwijzer zonder de lijst te
// filteren.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inBoomvolgorde, huidigeBladwijzer, bladwijzerTreffers, volgendeTreffer,
  ingeklapteVoorouders, scrollVoorItem,
} from './bladwijzer-zoeken.js';

const hier = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(hier, '../../i18n/locales');

// Tekeningenset zoals de componentboom van bookmarks.js hem levert.
const knoop = (id, title, page, children = []) => ({ id, title, page, children });
const SET = [
  knoop('arch', 'Architectural', 1, [
    knoop('a101', 'A-101 Ground floor plan', 1),
    knoop('a102', 'A-102 First floor plan', 2),
    knoop('a201', 'A-201 Elevations', 3),
  ]),
  knoop('struct', 'Structural', 4, [
    knoop('s401', 'S-401 Details', 4),
    knoop('s402', 'S-402 Floor framing', 5),
  ]),
  knoop('notes', 'General notes', 7),
];

test('boomvolgorde: ouder voor zijn kinderen, met diepte', () => {
  const lijst = inBoomvolgorde(SET);
  assert.deepEqual(lijst.map(b => b.id), ['arch', 'a101', 'a102', 'a201', 'struct', 's401', 's402', 'notes']);
  assert.equal(lijst.find(b => b.id === 's401').diepte, 1);
  assert.deepEqual(inBoomvolgorde(null), []);
});

test('huidige bladwijzer volgt de pagina; bij een groep en een blad op dezelfde pagina wint het blad', () => {
  assert.equal(huidigeBladwijzer(SET, 1), 'a101');
  assert.equal(huidigeBladwijzer(SET, 2), 'a102');
  assert.equal(huidigeBladwijzer(SET, 4), 's401');
  assert.equal(huidigeBladwijzer(SET, 5), 's402');
  assert.equal(huidigeBladwijzer(SET, 7), 'notes');
  assert.equal(huidigeBladwijzer(SET, 6), null, 'geen bladwijzer voor deze pagina');
  assert.equal(huidigeBladwijzer(SET, undefined), null);
  assert.equal(huidigeBladwijzer([], 1), null);
});

test('huidige bladwijzer: bij gelijke diepte de eerste in de boom', () => {
  const dubbel = [knoop('x', 'Eerste', 3), knoop('y', 'Tweede', 3)];
  assert.equal(huidigeBladwijzer(dubbel, 3), 'x');
});

test('zoeken: "S-4" springt naar S-401 Details; hoofdletters tellen niet', () => {
  assert.equal(volgendeTreffer(SET, 'S-4'), 's401');
  assert.equal(volgendeTreffer(SET, 's-4'), 's401');
  assert.equal(volgendeTreffer(SET, '  s-40  '), 's401');
});

test('zoeken: begint-met gaat voor bevat', () => {
  // "Floor" begint S-402's titel niet, maar "floor" staat in drie titels.
  assert.deepEqual(bladwijzerTreffers(SET, 'floor'), ['a101', 'a102', 's402']);
  const lijst = [knoop('b', 'Ground floor', 1), knoop('c', 'Floor finishes', 2)];
  assert.deepEqual(bladwijzerTreffers(lijst, 'floor'), ['c', 'b']);
});

test('zoeken: Enter na Enter loopt alle treffers af en begint dan opnieuw', () => {
  const eerste = volgendeTreffer(SET, 'floor');
  assert.equal(eerste, 'a101');
  const tweede = volgendeTreffer(SET, 'floor', eerste);
  assert.equal(tweede, 'a102');
  const derde = volgendeTreffer(SET, 'floor', tweede);
  assert.equal(derde, 's402');
  assert.equal(volgendeTreffer(SET, 'floor', derde), 'a101', 'rondgaand');
  assert.equal(volgendeTreffer(SET, 'floor', 'notes'), 'a101', 'vorige was geen treffer: de eerste');
});

test('zoeken: lege tekst of geen treffer geeft niets', () => {
  assert.equal(volgendeTreffer(SET, ''), null);
  assert.equal(volgendeTreffer(SET, '   '), null);
  assert.equal(volgendeTreffer(SET, 'xyz'), null);
  assert.deepEqual(bladwijzerTreffers(SET, null), []);
});

test('ingeklapte voorouders gaan open om de treffer te tonen', () => {
  const plat = [
    { id: 'a', parentId: null, expanded: false },
    { id: 'b', parentId: 'a', expanded: true },
    { id: 'c', parentId: 'b', expanded: false },
    { id: 'd', parentId: 'c', expanded: true },
  ];
  assert.deepEqual(ingeklapteVoorouders(plat, 'd'), ['c', 'a']);
  assert.deepEqual(ingeklapteVoorouders(plat, 'a'), []);
  assert.deepEqual(ingeklapteVoorouders(plat, 'onbekend'), []);
  const kring = [{ id: 'p', parentId: 'q', expanded: false }, { id: 'q', parentId: 'p', expanded: false }];
  assert.deepEqual(ingeklapteVoorouders(kring, 'p'), ['q', 'p'], 'stopt bij een kringverwijzing');
});

test('in beeld schuiven: alleen als het item buiten beeld staat', () => {
  const lijst = { top: 100, bottom: 400 };
  assert.equal(scrollVoorItem(lijst, { top: 150, bottom: 172 }, 50), null, 'staat al in beeld');
  assert.equal(scrollVoorItem(lijst, { top: 60, bottom: 82 }, 50), 10, 'erboven: bovenkant gelijk');
  assert.equal(scrollVoorItem(lijst, { top: 420, bottom: 442 }, 50), 92, 'eronder: onderkant gelijk');
  assert.equal(scrollVoorItem(lijst, { top: 400, bottom: 422 }, 0, 'center'), 161, 'midden');
  assert.equal(scrollVoorItem(lijst, { top: 105, bottom: 127 }, 0, 'center'), 0, 'nooit negatief');
  assert.equal(scrollVoorItem(null, { top: 0, bottom: 1 }, 0), null);
});

test('alle 40 talen hebben het zoekveld vertaald', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const lees = (taal) => JSON.parse(readFileSync(join(LOCALES, taal, 'properties.json'), 'utf8')).leftPanel || {};
  const en = lees('en');
  for (const taal of talen) {
    const lp = lees(taal);
    for (const sleutel of ['findBookmark', 'findBookmarkTip']) {
      assert.equal(typeof lp[sleutel], 'string', `${taal} leftPanel.${sleutel} ontbreekt`);
      assert.ok(lp[sleutel].trim(), `${taal} leftPanel.${sleutel} is leeg`);
    }
    if (taal !== 'en') {
      assert.notEqual(lp.findBookmark, en.findBookmark, `${taal}: findBookmark is Engels`);
      assert.notEqual(lp.findBookmarkTip, en.findBookmarkTip, `${taal}: findBookmarkTip is Engels`);
    }
  }
});

test('het paneel gebruikt de markering, het zoekveld en filtert de lijst niet', () => {
  const paneel = readFileSync(join(hier, '../../solid/components/left-panel/panels/BookmarksPanel.jsx'), 'utf8');
  assert.match(paneel, /huidigeBladwijzer\(tree\(\), activePage\(\)\)/);
  assert.match(paneel, /t\('leftPanel\.findBookmark'\)/);
  assert.match(paneel, /t\('leftPanel\.findBookmarkTip'\)/);
  assert.match(paneel, /revealBookmark\(id\)/);
  assert.match(paneel, /<For each=\{tree\(\)\}>/, 'de volledige boom blijft staan');
  const module = readFileSync(join(hier, 'bookmarks.js'), 'utf8');
  assert.match(module, /export function revealBookmark\(id\)/);
});
