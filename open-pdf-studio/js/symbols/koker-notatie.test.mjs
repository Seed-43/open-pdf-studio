// Kokerprofielen: vierkant heet "K<breedte>/<wanddikte>" (K100/5), rechthoekig
// houdt "Koker 100x50x5". Oude namen ("Koker 100x100x5", "SHS 100x100x5",
// "K100x100x5") blijven herkend en komen onder de nieuwe naam terug.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  kokerNaam, ontleedKokerNaam, normaliseerKokerNaam, oudeKokerNaam, migreerProfielParams,
} from './koker-notatie.js';
import { KOKER_TABEL, kokerTemplate } from './templates/staalprofiel.js';
import { getTemplate, normalizeParams, migrateParams, searchTermsFor, defaultParams } from './registry.js';
import { ifcEntityFor } from '../pdf/ifc-entity.js';
import { ifcCategoryForSymbol } from '../solid/data/ifcCategoryMap.js';
import { symboolPastBijZoekterm } from '../solid/data/symbool-zoeken.js';
import { NL_CATEGORIES } from '../solid/data/nlSymbolLibrary.js';

const BBOX = { x: 10, y: 20, width: 100, height: 100 };
const labelVan = (cmds) => cmds.find(c => c.kind === 'text')?.text;

// --- Naamgeving -------------------------------------------------------------

test('een vierkante koker heet K<breedte>/<wanddikte>', () => {
  assert.equal(kokerNaam(100, 100, 5), 'K100/5');
  assert.equal(kokerNaam(40, 40, 3), 'K40/3');
  assert.equal(kokerNaam(120, 120, 6), 'K120/6');
});

test('een gebroken wanddikte krijgt een punt, net als de rest van de catalogus', () => {
  assert.equal(kokerNaam(300, 300, 12.5), 'K300/12.5');
  assert.equal(kokerNaam(100, 100, 6.3), 'K100/6.3');
});

test('een rechthoekige koker houdt zijn naam', () => {
  assert.equal(kokerNaam(100, 50, 5), 'Koker 100x50x5');
  assert.equal(kokerNaam(300, 200, 12.5), 'Koker 300x200x12.5');
});

// --- Ontleden ---------------------------------------------------------------

test('de nieuwe schrijfwijze wordt ontleed', () => {
  assert.deepEqual(ontleedKokerNaam('K100/5'), { b: 100, h: 100, t: 5 });
  assert.deepEqual(ontleedKokerNaam('k 100 / 5'), { b: 100, h: 100, t: 5 });
  assert.deepEqual(ontleedKokerNaam('K300/12.5'), { b: 300, h: 300, t: 12.5 });
  assert.deepEqual(ontleedKokerNaam('K300/12,5'), { b: 300, h: 300, t: 12.5 });
});

test('de oude schrijfwijzen worden herkend als hetzelfde profiel', () => {
  for (const oud of ['Koker 100x100x5', 'koker 100x100x5', 'KOKER 100 x 100 x 5',
    'SHS 100x100x5', 'K100x100x5', 'buis 100x100x5', 'Koker 100×100×5']) {
    assert.equal(normaliseerKokerNaam(oud), 'K100/5', oud);
  }
  assert.equal(normaliseerKokerNaam('Koker 300x300x12,5'), 'K300/12.5');
  assert.equal(normaliseerKokerNaam('K100/5'), 'K100/5');
});

test('rechthoekig blijft rechthoekig, ook vanuit RHS', () => {
  assert.equal(normaliseerKokerNaam('Koker 100x50x5'), 'Koker 100x50x5');
  assert.equal(normaliseerKokerNaam('RHS 100x50x5'), 'Koker 100x50x5');
  assert.equal(normaliseerKokerNaam('koker 300x200x12.5'), 'Koker 300x200x12.5');
});

test('wat geen koker is, wordt niet ontleed', () => {
  for (const tekst of ['', null, 'HEA 200', 'IPE 300', 'L 100x100x10', '300x500', 'K1', 'K100', 'K0/5', 'Koker']) {
    assert.equal(ontleedKokerNaam(tekst), null, String(tekst));
  }
});

test('oude naam voor het zoeken', () => {
  assert.equal(oudeKokerNaam('K100/5'), 'Koker 100x100x5');
  assert.equal(oudeKokerNaam('Koker 100x50x5'), 'Koker 100x50x5');
});

// --- Catalogus ---------------------------------------------------------------

test('elke vierkante koker in de tabel heeft de korte naam, rechthoekig de oude', () => {
  for (const [maat, h, b, t] of KOKER_TABEL) {
    assert.equal(maat, kokerNaam(b, h, t), `rij ${maat}`);
    if (b === h) assert.match(maat, /^K\d+\/\d+(\.\d+)?$/);
    else assert.match(maat, /^Koker \d+x\d+x\d+(\.\d+)?$/);
  }
  const namen = KOKER_TABEL.map(r => r[0]);
  for (const nieuw of ['K40/3', 'K100/5', 'K120/6', 'K300/12.5', 'Koker 100x50x5', 'Koker 300x200x12.5']) {
    assert.ok(namen.includes(nieuw), nieuw);
  }
  assert.ok(!namen.some(n => /^Koker (\d+)x\1x/.test(n)), 'geen vierkante koker meer in de oude schrijfwijze');
});

test('het kokersymbool houdt zijn id en begint bij K100/5', () => {
  assert.equal(kokerTemplate.id, 'staal-koker');
  assert.equal(getTemplate('staal-koker'), kokerTemplate);
  const maat = kokerTemplate.params.find(p => p.key === 'maat');
  assert.equal(maat.default, 'K100/5');
  assert.ok(maat.options.includes('K100/5'));
  assert.equal(defaultParams(kokerTemplate).maat, 'K100/5');
});

test('een opgeslagen oude maat zoekt de juiste catalogusrij op', () => {
  const tpl = getTemplate('staal-koker');
  for (const [oud, nieuw] of [['Koker 100x100x5', 'K100/5'], ['Koker 40x40x3', 'K40/3'],
    ['SHS 300x300x12.5', 'K300/12.5'], ['koker 120x120x6', 'K120/6']]) {
    assert.deepEqual(tpl.realSizeMm({ maat: oud }), tpl.realSizeMm({ maat: nieuw }), oud);
    const label = labelVan(tpl.render({ maat: oud, toonLabel: true }, BBOX));
    assert.equal(label, nieuw, `label van ${oud}`);
  }
  // Niet de standaardmaat: K40/3 is echt 40 mm.
  assert.deepEqual(tpl.realSizeMm({ maat: 'Koker 40x40x3' }), { width: 40, height: 40 });
  assert.equal(labelVan(tpl.render({ maat: 'Koker 100x50x5', toonLabel: true }, BBOX)), 'Koker 100x50x5');
  for (const aanzicht of ['boven', 'zij']) {
    assert.equal(labelVan(tpl.render({ maat: 'Koker 100x100x5', aanzicht, toonLabel: true }, BBOX)), 'K100/5');
  }
});

test('opgeslagen parameters worden bijgewerkt, het symbool-id blijft', () => {
  const oud = { maat: 'Koker 100x100x5', aanzicht: 'zij', schaal: 2 };
  const nieuw = migreerProfielParams('staal-koker', oud);
  assert.deepEqual(nieuw, { maat: 'K100/5', aanzicht: 'zij', schaal: 2 });
  assert.equal(oud.maat, 'Koker 100x100x5', 'het origineel blijft onaangeroerd');
  // Niets te doen: hetzelfde object terug.
  const rh = { maat: 'Koker 100x50x5' };
  assert.equal(migreerProfielParams('staal-koker', rh), rh);
  const hea = { maat: 'HEA 200' };
  assert.equal(migreerProfielParams('staal-hea', hea), hea);
  assert.equal(migreerProfielParams('staal-koker', null), null);
  // Via het template en de MCP-normalisatie.
  assert.equal(migrateParams(kokerTemplate, oud).maat, 'K100/5');
  assert.equal(normalizeParams(kokerTemplate, { maat: 'SHS 100x100x5' }).maat, 'K100/5');
});

// --- IFC-export ---------------------------------------------------------------

test('de IFC-export noemt een vierkante koker K100/5', () => {
  for (const maat of ['K100/5', 'Koker 100x100x5']) {
    const e = ifcEntityFor({
      id: 'a1', type: 'parametricSymbol', symbolId: 'staal-koker', page: 1,
      x: 0, y: 0, width: 10, height: 10, params: { maat, aanzicht: 'doorsnede' },
    });
    assert.equal(e.class, 'IfcMember');
    assert.equal(e.name, 'K100/5', maat);
    assert.equal(e.properties.profileName, 'K100/5');
    assert.equal(e.properties.params.maat, 'K100/5');
    assert.equal(e.properties.template, 'staal-koker');
  }
  const rh = ifcEntityFor({ id: 'a2', type: 'parametricSymbol', symbolId: 'staal-koker', params: { maat: 'Koker 100x50x5' } });
  assert.equal(rh.name, 'Koker 100x50x5');
});

test('een eigen symbool met de korte kokernaam valt onder IfcMember', () => {
  assert.equal(ifcCategoryForSymbol({ id: 'eigen-1', name: 'K100/5' }), 'IfcMember');
});

// --- Zoeken ---------------------------------------------------------------------

test('zoeken op "koker 100" en op "K100" vindt het kokerprofiel', () => {
  const groep = NL_CATEGORIES.flatMap(c => c.symbols).find(s => s.parametricId === 'staal-koker');
  assert.ok(groep, 'het kokersymbool staat in het palet');
  for (const q of ['koker 100', 'K100', 'k100/5', 'Koker 100x100x5', 'K300/12.5', 'koker']) {
    assert.ok(symboolPastBijZoekterm(groep, q, searchTermsFor), q);
  }
  assert.ok(!symboolPastBijZoekterm(groep, 'HEA 200', searchTermsFor));
  assert.ok(!symboolPastBijZoekterm(groep, 'K999', searchTermsFor));
  // Een symbool zonder template-zoektermen werkt als voorheen.
  assert.ok(symboolPastBijZoekterm({ id: 'x', name: 'Stopcontact' }, 'stop', searchTermsFor));
  assert.ok(!symboolPastBijZoekterm({ id: 'x', name: 'Stopcontact' }, 'K100', searchTermsFor));
});
