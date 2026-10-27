import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPIER_EENHEDEN, STANDAARD_PAPIER_EENHEID, normaliseerPapierEenheid,
  ptPerEenheid, ptNaarEenheid, eenheidNaarPt, decimalenVoor, toonInEenheid,
  leesInvoerInEenheid, nieuweAfbeeldingsMaat,
} from './papiermaat-eenheid.js';
import { MIN_VORM_MAAT_PT } from './minimummaat.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('eenheden: mm, cm, in en pt in die volgorde; standaard pt', () => {
  assert.deepEqual(PAPIER_EENHEDEN, ['mm', 'cm', 'in', 'pt']);
  assert.equal(STANDAARD_PAPIER_EENHEID, 'pt');
});

test('normaliseerPapierEenheid: onbekend of leeg wordt de standaard', () => {
  for (const u of PAPIER_EENHEDEN) assert.equal(normaliseerPapierEenheid(u), u);
  assert.equal(normaliseerPapierEenheid('MM'), 'mm');
  assert.equal(normaliseerPapierEenheid(' in '), 'in');
  assert.equal(normaliseerPapierEenheid('m'), 'pt');
  assert.equal(normaliseerPapierEenheid('px'), 'pt');
  assert.equal(normaliseerPapierEenheid(''), 'pt');
  assert.equal(normaliseerPapierEenheid(undefined), 'pt');
  assert.equal(normaliseerPapierEenheid(null), 'pt');
  assert.equal(normaliseerPapierEenheid(42), 'pt');
});

test('ptPerEenheid: 1 in = 72 pt, 1 in = 25,4 mm = 2,54 cm', () => {
  assert.equal(ptPerEenheid('pt'), 1);
  assert.equal(ptPerEenheid('in'), 72);
  assert.ok(near(ptPerEenheid('mm') * 25.4, 72));
  assert.ok(near(ptPerEenheid('cm') * 2.54, 72));
  assert.equal(ptPerEenheid('onzin'), 1);
});

test('voorbeeld uit het issue: 216 pt = 76,2 mm = 7,62 cm = 3 in', () => {
  assert.ok(near(ptNaarEenheid(216, 'mm'), 76.2));
  assert.ok(near(ptNaarEenheid(216, 'cm'), 7.62));
  assert.ok(near(ptNaarEenheid(216, 'in'), 3));
  assert.equal(ptNaarEenheid(216, 'pt'), 216);
  assert.equal(toonInEenheid(216, 'mm'), 76.2);
  assert.equal(toonInEenheid(216, 'cm'), 7.62);
  assert.equal(toonInEenheid(216, 'in'), 3);
  assert.equal(toonInEenheid(216, 'pt'), 216);
});

test('heen en terug is verliesvrij (binnen float-ruis) in elke eenheid', () => {
  for (const u of PAPIER_EENHEDEN) {
    for (const pt of [0.01, 0.4, 1, 72, 216, 595.28, 2383.94]) {
      assert.ok(near(eenheidNaarPt(ptNaarEenheid(pt, u), u), pt, 1e-9), `${pt} pt via ${u}`);
    }
  }
});

test('ptNaarEenheid/eenheidNaarPt: niet-eindig geeft NaN, niet een getal dat in het model belandt', () => {
  assert.ok(Number.isNaN(ptNaarEenheid(NaN, 'mm')));
  assert.ok(Number.isNaN(ptNaarEenheid('12', 'mm')));
  assert.ok(Number.isNaN(eenheidNaarPt(Infinity, 'in')));
});

test('decimalenVoor: basisprecisie per eenheid', () => {
  assert.equal(decimalenVoor(100, 'pt'), 2);
  assert.equal(decimalenVoor(100, 'mm'), 2);
  assert.equal(decimalenVoor(10, 'cm'), 3);
  assert.equal(decimalenVoor(3, 'in'), 3);
});

test('decimalenVoor: kleine waarden houden minstens drie significante cijfers', () => {
  assert.equal(decimalenVoor(0.5, 'pt'), 3);           // als toonMaat: onder 1 pt drie decimalen
  assert.equal(decimalenVoor(0.0001389, 'in'), 6);
  assert.ok(decimalenVoor(1e-12, 'in') <= 8);          // begrensd
  assert.equal(decimalenVoor(0, 'mm'), 2);
  assert.equal(decimalenVoor(NaN, 'mm'), 2);
});

test('toonInEenheid: een heel kleine maat rondt in een grote eenheid NIET af naar 0', () => {
  for (const u of PAPIER_EENHEDEN) {
    const v = toonInEenheid(MIN_VORM_MAAT_PT, u);
    assert.ok(v > 0, `${u}: ${v}`);
    // En het getoonde getal is binnen 1 % van de werkelijke maat.
    assert.ok(Math.abs(eenheidNaarPt(v, u) - MIN_VORM_MAAT_PT) / MIN_VORM_MAAT_PT < 0.01, `${u}: ${v}`);
  }
  assert.equal(toonInEenheid(0.4, 'in'), 0.00556);
  assert.equal(toonInEenheid(1, 'in'), 0.0139);
});

test('toonInEenheid: geen exponentnotatie voor de kleinst toegestane maat', () => {
  for (const u of PAPIER_EENHEDEN) {
    assert.doesNotMatch(String(toonInEenheid(MIN_VORM_MAAT_PT, u)), /e/i);
  }
});

test('toonInEenheid: afronding per eenheid', () => {
  assert.equal(toonInEenheid(100, 'mm'), 35.28);       // 35,2777…
  assert.equal(toonInEenheid(100, 'cm'), 3.528);
  assert.equal(toonInEenheid(100, 'in'), 1.389);
  assert.equal(toonInEenheid(100.004, 'pt'), 100);
  assert.equal(toonInEenheid(0.4, 'pt'), 0.4);
});

test('toonInEenheid: geen getal wordt 0 (zoals toonMaat)', () => {
  assert.equal(toonInEenheid(NaN, 'mm'), 0);
  assert.equal(toonInEenheid(undefined, 'mm'), 0);
  assert.equal(toonInEenheid('abc', 'mm'), 0);
});

test('leesInvoerInEenheid: waarde in de gekozen eenheid wordt paginapunten', () => {
  assert.ok(near(leesInvoerInEenheid('76.2', 'mm'), 216));
  assert.ok(near(leesInvoerInEenheid('7.62', 'cm'), 216));
  assert.ok(near(leesInvoerInEenheid('3', 'in'), 216));
  assert.equal(leesInvoerInEenheid('216', 'pt'), 216);
  assert.ok(near(leesInvoerInEenheid(25.4, 'mm'), 72));
});

test('leesInvoerInEenheid: decimalen met punt of komma', () => {
  assert.ok(near(leesInvoerInEenheid('2,5', 'cm'), 2.5 * 72 / 2.54));
  assert.ok(near(leesInvoerInEenheid('0.25', 'in'), 18));
  assert.ok(near(leesInvoerInEenheid(' 12.5 ', 'pt'), 12.5));
});

test('leesInvoerInEenheid: tussenstanden tijdens het typen laten het model met rust', () => {
  for (const u of PAPIER_EENHEDEN) {
    for (const tussen of ['', ' ', '0', '0.', '0,', '.', ',', '-', '-1', 'abc', '0.0']) {
      assert.equal(leesInvoerInEenheid(tussen, u), null, `${JSON.stringify(tussen)} in ${u}`);
    }
    assert.equal(leesInvoerInEenheid(NaN, u), null);
    assert.equal(leesInvoerInEenheid(Infinity, u), null);
    assert.equal(leesInvoerInEenheid(null, u), null);
    assert.equal(leesInvoerInEenheid(undefined, u), null);
  }
});

test('leesInvoerInEenheid: onder de technische ondergrens wordt geklemd (in pt na omrekenen)', () => {
  assert.equal(leesInvoerInEenheid('0.001', 'pt'), MIN_VORM_MAAT_PT);
  assert.equal(leesInvoerInEenheid('0.000001', 'in'), MIN_VORM_MAAT_PT);
  // 0,001 mm = 0,0028 pt -> ondergrens; 0,01 mm = 0,028 pt blijft staan.
  assert.equal(leesInvoerInEenheid('0.001', 'mm'), MIN_VORM_MAAT_PT);
  assert.ok(near(leesInvoerInEenheid('0.01', 'mm'), 0.01 * 72 / 25.4));
});

test('leesInvoerInEenheid: eigen grenzen (schaalbalk-hoogte 4-100 pt)', () => {
  assert.equal(leesInvoerInEenheid('1', 'mm', { min: 4, max: 100 }), 4);
  assert.equal(leesInvoerInEenheid('10', 'in', { min: 4, max: 100 }), 100);
  assert.ok(near(leesInvoerInEenheid('5', 'mm', { min: 4, max: 100 }), 5 * 72 / 25.4));
  assert.equal(leesInvoerInEenheid('0', 'mm', { min: 4, max: 100 }), null);
});

const AFB = { width: 200, height: 100, originalWidth: 400, originalHeight: 200, lockAspectRatio: false };

test('nieuweAfbeeldingsMaat: zonder vaste verhouding verandert alleen de getypte as', () => {
  for (const u of PAPIER_EENHEDEN) {
    const r = nieuweAfbeeldingsMaat('width', String(ptNaarEenheid(144, u)), u, AFB);
    assert.ok(near(r.width, 144, 1e-9), u);
    assert.equal(r.height, 100);
    const h = nieuweAfbeeldingsMaat('height', String(ptNaarEenheid(36, u)), u, AFB);
    assert.equal(h.width, 200);
    assert.ok(near(h.height, 36, 1e-9), u);
  }
});

test('nieuweAfbeeldingsMaat: met vaste verhouding volgt de partner-as in elke eenheid', () => {
  const vast = { ...AFB, lockAspectRatio: true };
  // breedte 3 in = 216 pt -> hoogte 108 pt (verhouding 2:1)
  for (const [u, invoer] of [['in', '3'], ['mm', '76.2'], ['cm', '7.62'], ['pt', '216']]) {
    const r = nieuweAfbeeldingsMaat('width', invoer, u, vast);
    assert.ok(near(r.width, 216, 1e-9), u);
    assert.ok(near(r.height, 108, 1e-9), u);
    assert.ok(near(toonInEenheid(r.height, u), Number(invoer) / 2, 1e-9), u);
  }
  // hoogte 1 in = 72 pt -> breedte 144 pt
  for (const [u, invoer] of [['in', '1'], ['mm', '25.4'], ['cm', '2.54'], ['pt', '72']]) {
    const r = nieuweAfbeeldingsMaat('height', invoer, u, vast);
    assert.ok(near(r.height, 72, 1e-9), u);
    assert.ok(near(r.width, 144, 1e-9), u);
  }
});

test('nieuweAfbeeldingsMaat: verhouding uit de originele maat, niet uit de huidige', () => {
  const vervormd = { width: 300, height: 50, originalWidth: 400, originalHeight: 200, lockAspectRatio: true };
  const r = nieuweAfbeeldingsMaat('width', '100', 'pt', vervormd);
  assert.equal(r.width, 100);
  assert.equal(r.height, 50);
});

test('nieuweAfbeeldingsMaat: onbruikbare originele maat valt terug op vrij schalen', () => {
  const kapot = { width: 200, height: 100, originalWidth: 0, originalHeight: undefined, lockAspectRatio: true };
  const r = nieuweAfbeeldingsMaat('width', '50', 'pt', kapot);
  assert.equal(r.width, 50);
  assert.equal(r.height, 100);
});

test('nieuweAfbeeldingsMaat: partner-as zakt nooit onder de ondergrens', () => {
  const smal = { width: 200, height: 1, originalWidth: 1000, originalHeight: 1, lockAspectRatio: true };
  const r = nieuweAfbeeldingsMaat('width', '0.5', 'pt', smal);
  assert.equal(r.width, 0.5);
  assert.equal(r.height, MIN_VORM_MAAT_PT);
});

test('nieuweAfbeeldingsMaat: tussenstand of onbekende as geeft null', () => {
  const vast = { ...AFB, lockAspectRatio: true };
  for (const tussen of ['', '0', '0.', '0,']) {
    assert.equal(nieuweAfbeeldingsMaat('width', tussen, 'mm', vast), null);
    assert.equal(nieuweAfbeeldingsMaat('height', tussen, 'in', vast), null);
  }
  assert.equal(nieuweAfbeeldingsMaat('diepte', '10', 'mm', vast), null);
  assert.equal(nieuweAfbeeldingsMaat('width', '10', 'mm', null), null);
});

test('nieuweAfbeeldingsMaat: muteert de annotatie niet', () => {
  const ann = { ...AFB, lockAspectRatio: true };
  const kopie = { ...ann };
  nieuweAfbeeldingsMaat('width', '50', 'mm', ann);
  assert.deepEqual(ann, kopie);
});
