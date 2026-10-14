// Zijdematen van een meetvlak (GitHub #536): de lengte van elke rechte zijde,
// midden op die zijde, rechtop leesbaar en aan de buitenkant van het vlak.
//
// Deze test legt de pure geometrie vast die het scherm
// (rendering/measurements.js) en de opgeslagen appearance
// (saver/appearance-vectors.js) allebei gebruiken, plus de eenheden-omrekening
// van het eigenschappenpaneel.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  vlakZijden,
  zijdeLabel,
  zijdeLabelKader,
  lengteEenheid,
  eenheidFactor,
  schaalInEenheid,
  vlakSchaalUitMeasure,
  ZIJDE_TEKST_GROOTTE,
} from './vlak-zijden.js';
import { leesbareHoek, STAAND_TOLERANTIE } from './maat-label.js';

// Rechthoek met de klok mee op het scherm (y omlaag): boven, rechts, onder, links.
const RECHTHOEK = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── zijden ──────────────────────────────────────────────────────────────────

test('elke rechte zijde van de buitenring, inclusief de sluitende zijde', () => {
  const z = vlakZijden(RECHTHOEK);
  assert.equal(z.length, 4);
  assert.deepEqual(z.map((s) => s.index), [0, 1, 2, 3]);
  assert.deepEqual(z.map((s) => s.lengte), [100, 50, 100, 50]);
  // De sluitende zijde loopt van het laatste punt terug naar het eerste.
  assert.deepEqual([z[3].x1, z[3].y1, z[3].x2, z[3].y2], [0, 50, 0, 0]);
});

test('de buitennormaal wijst naar buiten, welke kant het vlak ook op getekend is', () => {
  const verwacht = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  vlakZijden(RECHTHOEK).forEach((s, i) => {
    assert.ok(bijna(s.buiten.x, verwacht[i][0]) && bijna(s.buiten.y, verwacht[i][1]), `zijde ${i}`);
  });
  // Tegen de klok in: dezelfde zijden, de normaal blijft buiten.
  const omgekeerd = vlakZijden([...RECHTHOEK].reverse());
  for (const s of omgekeerd) {
    const mx = (s.x1 + s.x2) / 2 + s.buiten.x;
    const my = (s.y1 + s.y2) / 2 + s.buiten.y;
    const binnen = mx > 0 && mx < 100 && my > 0 && my < 50;
    assert.equal(binnen, false, `zijde ${s.index}: een stap langs de normaal ligt buiten het vlak`);
  }
});

test('boogsegmenten en zijden zonder lengte krijgen geen maat', () => {
  const metBoog = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50, arc: true, bulge: 0.3 }, { x: 0, y: 50 }];
  assert.deepEqual(vlakZijden(metBoog).map((s) => s.index), [0, 2, 3], 'de boog van punt 1 naar 2 valt weg');
  const sluitBoog = [{ x: 0, y: 0, arc: true, bulge: 0.3 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  assert.deepEqual(vlakZijden(sluitBoog).map((s) => s.index), [0, 1, 2], 'een boog op punt 0 is de sluitende zijde');
  const dubbel = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  assert.deepEqual(vlakZijden(dubbel).map((s) => s.index), [0, 2, 3]);
  assert.deepEqual(vlakZijden([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
  assert.deepEqual(vlakZijden(undefined), []);
});

// ── plaats van de maat ─────────────────────────────────────────────────────

test('de maat staat midden op de zijde, aan de buitenkant', () => {
  const fs = ZIJDE_TEKST_GROOTTE;
  const [boven, rechts, onder, links] = vlakZijden(RECHTHOEK).map((s) => zijdeLabel(s));
  // Bovenzijde: tekst erboven (y < 0), horizontaal.
  assert.ok(bijna(boven.x, 50));
  assert.ok(boven.y < 0, 'boven de bovenzijde');
  assert.ok(bijna(boven.hoek, 0));
  // Onderzijde (getekend van rechts naar links): rechtop, en eronder.
  assert.ok(bijna(onder.hoek, 0), 'niet op zijn kop');
  assert.ok(onder.y > 50 + fs * 0.5, 'de hele tekst onder de onderzijde');
  // Staande zijden lezen van rechts (van onder naar boven) en staan buiten.
  assert.ok(bijna(rechts.hoek, -Math.PI / 2));
  assert.ok(rechts.x > 100 + fs * 0.5, 'rechts van de rechterzijde');
  assert.ok(bijna(links.hoek, -Math.PI / 2));
  assert.ok(links.x < 0, 'links van de linkerzijde');
  for (const l of [boven, rechts, onder, links]) {
    assert.ok(Math.abs(l.hoek) <= Math.PI / 2 + STAAND_TOLERANTIE, 'rechtop leesbaar');
  }
});

test('het tekstkader blijft vrij van de zijde en ligt buiten het vlak', () => {
  const zijden = vlakZijden(RECHTHOEK);
  const kaders = zijden.map((s) => zijdeLabelKader(zijdeLabel(s), '100 mm'));
  for (const p of kaders[0]) assert.ok(p.y < 0, 'bovenzijde: kader boven y = 0');
  for (const p of kaders[1]) assert.ok(p.x > 100, 'rechterzijde: kader rechts van x = 100');
  for (const p of kaders[2]) assert.ok(p.y > 50, 'onderzijde: kader onder y = 50');
  for (const p of kaders[3]) assert.ok(p.x < 0, 'linkerzijde: kader links van x = 0');
  // Het kader omvat het ankerpunt van de tekst.
  const l = zijdeLabel(zijden[0]);
  const xs = kaders[0].map((p) => p.x);
  assert.ok(Math.min(...xs) < l.x && l.x < Math.max(...xs));
});

test('een schuine zijde: de maat staat aan de buitenkant, langs de zijde', () => {
  const driehoek = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const schuin = vlakZijden(driehoek)[0];
  const l = zijdeLabel(schuin);
  assert.ok(bijna(l.hoek, Math.PI / 4), 'langs de zijde');
  // Buiten = rechtsboven van de diagonaal (x > y).
  assert.ok(l.x > l.y, 'aan de buitenkant van de diagonaal');
});

test('met een gedraaide pagina leest de maat rechtop in de weergave', () => {
  const draaiing = Math.PI / 2;
  for (const s of vlakZijden(RECHTHOEK)) {
    const l = zijdeLabel(s, { draaiing });
    const inWeergave = l.hoek + draaiing;
    assert.ok(bijna(leesbareHoek(inWeergave), inWeergave), `zijde ${s.index} rechtop in de weergave`);
    // Nog steeds aan de buitenkant.
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    assert.ok((l.x - mx) * s.buiten.x + (l.y - my) * s.buiten.y > 0, `zijde ${s.index} buiten`);
  }
});

// ── eenheden ────────────────────────────────────────────────────────────────

test('de lengte-eenheid achter een oppervlakte-eenheid', () => {
  assert.equal(lengteEenheid('mm²'), 'mm');
  assert.equal(lengteEenheid('m²'), 'm');
  assert.equal(lengteEenheid('cm'), 'cm');
  assert.equal(lengteEenheid('sq ft'), 'ft');
  assert.equal(lengteEenheid(''), null);
  assert.equal(lengteEenheid(undefined), null);
});

test('omrekenen tussen lengte-eenheden; pixels zijn niet om te rekenen', () => {
  assert.equal(eenheidFactor('m', 'mm'), 1000);
  assert.ok(bijna(eenheidFactor('mm', 'cm'), 0.1));
  assert.ok(bijna(eenheidFactor('ft', 'in'), 12));
  assert.ok(bijna(eenheidFactor('pt', 'in'), 1 / 72));
  assert.equal(eenheidFactor('px', 'mm'), null);
  assert.equal(eenheidFactor('mm', 'onbekend'), null);
  // Een schaal (eenheden per punt) in een andere eenheid: dezelfde echte maat.
  assert.ok(bijna(schaalInEenheid(35.2778, 'mm', 'm'), 0.0352778));
  assert.equal(schaalInEenheid(2, 'mm', 'px'), 2, 'niet om te rekenen: het getal blijft');
});

// ── schaal uit een /Measure van een ander programma ─────────────────────────
//
// De lader leest de schaal uit /X (de factoren van de hele reeks
// vermenigvuldigd, in de eenheid van het LAATSTE element) en de eenheid uit
// /A. Het meetvlak rekent zijn schaal in de lengte-eenheid van measureUnit:
// die twee moeten dus kloppen, anders is een herberekende oppervlakte 10⁶ of
// 144 keer te groot.

test('een /Measure met lengte in mm en oppervlakte in m²: de schaal in meters', () => {
  const MM_PER_PT = 25.4 / 72 * 100;
  const uit = vlakSchaalUitMeasure(MM_PER_PT, 'mm', 'm²');
  assert.ok(bijna(uit.measureScale, MM_PER_PT / 1000), `schaal ${uit.measureScale}`);
  assert.equal(uit.measureUnit, 'm²');
  assert.equal(lengteEenheid(uit.measureUnit), 'm');
});

test('een samengestelde /X (ft, dan in) met /A in sq ft: de schaal in voeten', () => {
  // De lader vermenigvuldigt de reeks: punten → voet → inch, eenheid 'in'.
  const FT_PER_PT = 25.4 / 72 * 100 / 304.8;
  const uit = vlakSchaalUitMeasure(FT_PER_PT * 12, 'in', 'sq ft');
  assert.ok(bijna(uit.measureScale, FT_PER_PT), `schaal ${uit.measureScale}`);
  assert.equal(lengteEenheid(uit.measureUnit), 'ft');
});

test('dezelfde eenheid in /X en /A: de schaal blijft staan', () => {
  assert.deepEqual(vlakSchaalUitMeasure(0.5, 'cm', 'cm²'), { measureScale: 0.5, measureUnit: 'cm²' });
  // Ook als de eenheid niet om te rekenen is.
  assert.deepEqual(vlakSchaalUitMeasure(3, 'px', 'px²'), { measureScale: 3, measureUnit: 'px²' });
});

test('niet om te rekenen naar de eenheid van /A: de eenheid volgt de schaal (/X)', () => {
  const uit = vlakSchaalUitMeasure(35, 'mm', 'm2');
  assert.equal(uit.measureScale, 35);
  assert.equal(lengteEenheid(uit.measureUnit), 'mm');
  const zonderA = vlakSchaalUitMeasure(2, 'ft', undefined);
  assert.equal(zonderA.measureScale, 2);
  assert.equal(lengteEenheid(zonderA.measureUnit), 'ft');
});

test('zonder eenheid in /X: de eenheid van /A, zoals voorheen', () => {
  assert.deepEqual(vlakSchaalUitMeasure(2, undefined, 'm²'), { measureScale: 2, measureUnit: 'm²' });
  assert.equal(lengteEenheid(vlakSchaalUitMeasure(2, undefined, undefined).measureUnit), 'mm');
});
