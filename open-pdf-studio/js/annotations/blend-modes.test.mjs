// Mengmodi (#614): één tabel voor model, PDF (/BM) en canvas.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BLEND_MODES, isBlendMode, isGemengd, blendPdfNaam, blendUitPdf, blendCanvasWaarde,
} from './blend-modes.js';

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'locales');

test('zestien modi, in menuvolgorde', () => {
  assert.deepEqual(BLEND_MODES, [
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorDodge',
    'colorBurn', 'hardLight', 'softLight', 'difference', 'exclusion', 'hue', 'saturation',
    'color', 'luminosity',
  ]);
  assert.ok(Object.isFrozen(BLEND_MODES));
});

test('elke modus heeft de canvas-waarde die de browser kent (streepjes bij de vier samengestelde)', () => {
  assert.deepEqual(BLEND_MODES.map(blendCanvasWaarde), [
    'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
    'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
    'color', 'luminosity',
  ]);
  assert.equal(blendCanvasWaarde(undefined), 'source-over');
  assert.equal(blendCanvasWaarde('plasma'), 'source-over', 'onbekend tekent gewoon');
  assert.equal(blendCanvasWaarde('constructor'), 'source-over', 'geen prototype-namen');
});

test('PDF-namen: normaal schrijft niets, de rest de naam uit de PDF-specificatie', () => {
  assert.equal(blendPdfNaam('normal'), null);
  assert.equal(blendPdfNaam(undefined), null);
  assert.equal(blendPdfNaam('plasma'), null);
  assert.deepEqual(BLEND_MODES.slice(1).map(blendPdfNaam), [
    'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'ColorDodge', 'ColorBurn',
    'HardLight', 'SoftLight', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity',
  ]);
});

test('uit een PDF: met of zonder slash, hoofdletterongevoelig, Normal/Compatible = geen modus', () => {
  assert.equal(blendUitPdf('/Multiply'), 'multiply');
  assert.equal(blendUitPdf('ColorDodge'), 'colorDodge');
  assert.equal(blendUitPdf('/LUMINOSITY'), 'luminosity');
  assert.equal(blendUitPdf('/Normal'), null);
  assert.equal(blendUitPdf('/Compatible'), null);
  assert.equal(blendUitPdf('/Plasma'), null);
  assert.equal(blendUitPdf(null), null);
  assert.equal(blendUitPdf(['/Plasma', '/Screen']), 'screen', 'eerste bekende uit een /BM-array');
  assert.equal(blendUitPdf(['/Normal', '/Screen']), null);
  for (const m of BLEND_MODES.slice(1)) assert.equal(blendUitPdf(`/${blendPdfNaam(m)}`), m, m);
});

test('isBlendMode / isGemengd', () => {
  assert.ok(isBlendMode('normal'));
  assert.ok(isBlendMode('hardLight'));
  assert.ok(!isBlendMode('hard-light'));
  assert.ok(!isBlendMode('toString'));
  assert.ok(!isGemengd('normal'));
  assert.ok(isGemengd('screen'));
  assert.ok(!isGemengd(undefined));
});

test('elke modus heeft een label en er is een uitleg, in alle talen', () => {
  const talen = readdirSync(LOCALES);
  assert.ok(talen.length >= 40, `${talen.length} talen`);
  for (const taal of talen) {
    const ribbon = JSON.parse(readFileSync(join(LOCALES, taal, 'ribbon.json'), 'utf8'));
    const blend = ribbon.format?.blend;
    assert.ok(blend && typeof blend === 'object', `${taal}: format.blend`);
    for (const m of BLEND_MODES) {
      assert.equal(typeof blend[m], 'string', `${taal}: format.blend.${m}`);
      assert.ok(blend[m].trim().length > 0, `${taal}: format.blend.${m} leeg`);
    }
    assert.equal(typeof ribbon.format.blendHint, 'string', `${taal}: format.blendHint`);
    assert.ok(ribbon.format.blendHint.length > 20, `${taal}: format.blendHint te kort`);
  }
});
