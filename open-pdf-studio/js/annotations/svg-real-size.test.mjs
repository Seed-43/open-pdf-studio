import assert from 'node:assert/strict';
import test from 'node:test';

import { svgRealSizeMm, stampPlacementSize, overrideStampMaat } from './svg-real-size.js';
import { OVERRIDE_STAMP_DEFAULT_HEIGHT, SYMBOL_STAMP_DEFAULT_SIZE } from './stamp-defaults.js';

test('leest een werkelijke maat in mm van de SVG-root', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="65.0mm" height="14.0mm" viewBox="0 0 65 14">';
  assert.deepEqual(svgRealSizeMm(svg), { width: 65, height: 14 });
});

test('rekent cm, in en pt om naar mm', () => {
  assert.deepEqual(svgRealSizeMm('<svg width="6.5cm" height="1.4cm">'), { width: 65, height: 14 });
  assert.deepEqual(svgRealSizeMm('<svg width="1in" height="2in">'), { width: 25.4, height: 50.8 });
  assert.deepEqual(svgRealSizeMm('<svg width="72pt" height="144pt">'), { width: 25.4, height: 50.8 });
});

test('geeft null voor de meegeleverde symbolen (alleen viewBox, geen eenheid)', () => {
  assert.equal(svgRealSizeMm('<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">'), null);
});

test('geeft null voor eenheidloze (px-)maten — dat is geen werkelijke maat', () => {
  assert.equal(svgRealSizeMm('<svg width="64" height="64" viewBox="0 0 64 64">'), null);
});

test('geeft null voor procenten en voor rommel', () => {
  assert.equal(svgRealSizeMm('<svg width="100%" height="100%">'), null);
  assert.equal(svgRealSizeMm(''), null);
  assert.equal(svgRealSizeMm(null), null);
});

test('kijkt alleen naar de root, niet naar geneste elementen', () => {
  const svg = '<svg viewBox="0 0 64 64"><rect width="10mm" height="10mm"/></svg>';
  assert.equal(svgRealSizeMm(svg), null);
});

// --- plaatsingsmaat ---

test('werkelijke maat: mm x px-per-mm, ongeacht de standaardgrootte', () => {
  // 65 x 14 mm op een tekening waar 1 mm = 2 paginapixels
  const r = stampPlacementSize({ mm: { width: 65, height: 14 }, pxPerMm: 2, aspect: 65 / 14 });
  assert.deepEqual(r, { width: 130, height: 28 });
});

test('geen werkelijke maat: hoogte uit de standaard, breedte uit de aspect', () => {
  // FIX A: een niet-vierkante SVG mag niet in een vierkant geduwd worden
  const r = stampPlacementSize({ mm: null, pxPerMm: 2, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(r.height, 400);
  assert.equal(r.width, 1857); // 400 * 4.642...
});

test('geen werkelijke maat en aspect 1: blijft 400 x 400 (bestaande symbolen)', () => {
  const r = stampPlacementSize({ mm: null, pxPerMm: 2, aspect: 1, defaultHeight: 400 });
  assert.deepEqual(r, { width: 400, height: 400 });
});

test('valt terug op de standaardhoogte als px-per-mm onbekend is', () => {
  const r = stampPlacementSize({ mm: { width: 65, height: 14 }, pxPerMm: 0, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(r.height, 400);
  assert.equal(r.width, 1857);
});

test('negeert een onzinnige aspect', () => {
  const r = stampPlacementSize({ mm: null, pxPerMm: 0, aspect: NaN, defaultHeight: 400 });
  assert.deepEqual(r, { width: 400, height: 400 });
});

// --- regressie: de meegeleverde symbolen mogen NIET van gedrag veranderen ---

test('geen enkel meegeleverd NL-symbool declareert een werkelijke maat', async () => {
  const { NL_CATEGORIES } = await import('../solid/data/nlSymbolLibrary.js');
  const metMaat = [];
  for (const cat of NL_CATEGORIES) {
    for (const sym of cat.symbols) {
      if (sym.svg && svgRealSizeMm(sym.svg)) metMaat.push(`${cat.id}/${sym.id}`);
    }
  }
  // Zolang dit leeg is, raakt de werkelijke-maat-tak geen bestaand symbool.
  assert.deepEqual(metMaat, []);
});

test('een vierkant meegeleverd symbool komt nog steeds op 400 x 400', () => {
  const svg = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30"/></svg>';
  const r = stampPlacementSize({
    mm: svgRealSizeMm(svg),
    pxPerMm: 3.7795,            // gekalibreerde tekening: schaal is bekend
    aspect: 1,
    defaultHeight: 400,
  });
  assert.deepEqual(r, { width: 400, height: 400 });
});

test('de gemelde CAD-SVG (65 x 14 mm) komt op ware maat binnen', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="65.0mm" height="14.0mm" viewBox="0 0 65 14">';
  const mm = svgRealSizeMm(svg);
  assert.deepEqual(mm, { width: 65, height: 14 });
  // 1:1-tekening, 1 mm = 3.7795 paginapixels (96 dpi)
  const r = stampPlacementSize({ mm, pxPerMm: 3.7795, aspect: 65 / 14, defaultHeight: 400 });
  assert.equal(Math.round(r.width), 246);
  assert.equal(Math.round(r.height), 53);
  // en de verhouding blijft kloppen
  assert.ok(Math.abs(r.width / r.height - 65 / 14) < 1e-9);
});

// Issue #357: de spookafbeelding onder de cursor (tools/text-tool.js) en de
// echte plaatsing (stamps.js) delen overrideStampMaat. Deze tests leggen vast
// dat die ene berekening de gekozen schaal meeneemt.
const PALET_SYMBOOL = {
  stampSvg: '<svg viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="32"/></svg>',
  stampHeight: SYMBOL_STAMP_DEFAULT_SIZE,
};

test('overrideStampMaat: zonder schaal de bekende paletmaat', () => {
  assert.deepEqual(overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2 }), { width: 800, height: 400 });
  assert.deepEqual(overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2, schaal: 1 }), { width: 800, height: 400 });
});

test('overrideStampMaat: de gekozen schaal werkt op voorbeeld en plaatsing gelijk', () => {
  for (const schaal of [0.25, 0.5, 2, 3]) {
    const r = overrideStampMaat(PALET_SYMBOOL, { pxPerMm: 0, aspect: 2, schaal });
    assert.deepEqual(r, { width: 800 * schaal, height: 400 * schaal }, `schaal ${schaal}`);
  }
});

test('overrideStampMaat: ook een symbool met een werkelijke maat schaalt mee', () => {
  const ov = { stampSvg: '<svg width="65mm" height="14mm" viewBox="0 0 65 14">' };
  const eenmaal = overrideStampMaat(ov, { pxPerMm: 2, aspect: 65 / 14, schaal: 1 });
  const tweemaal = overrideStampMaat(ov, { pxPerMm: 2, aspect: 65 / 14, schaal: 2 });
  assert.deepEqual(eenmaal, { width: 130, height: 28 });
  assert.deepEqual(tweemaal, { width: 260, height: 56 });
});

test('overrideStampMaat: zonder hoogte valt hij terug op de stempelstandaard', () => {
  // Het voorbeeld viel hier eerder terug op de paletmaat (400) terwijl de
  // plaatsing 800 gebruikte: twee verschillende maten voor hetzelfde stempel.
  const r = overrideStampMaat({ stampImage: 'data:image/png;base64,' }, { pxPerMm: 0, aspect: 1 });
  assert.deepEqual(r, { width: OVERRIDE_STAMP_DEFAULT_HEIGHT, height: OVERRIDE_STAMP_DEFAULT_HEIGHT });
});

test('voorbeeld en plaatsing gebruiken dezelfde maatbron', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  for (const pad of ['./stamps.js', '../tools/tools/text-tool.js']) {
    const code = bron(pad);
    assert.match(code, /overrideStampMaat\(/, `${pad} rekent niet via overrideStampMaat`);
    assert.match(code, /schaal:\s*huidigeSymboolSchaal\(\)/, `${pad} geeft de symboolschaal niet mee`);
  }
});
