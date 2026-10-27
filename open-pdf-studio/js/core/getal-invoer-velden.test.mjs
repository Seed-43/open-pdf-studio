// Per veldsoort: elke invoerhelper die op de gedeelde getalparser overging,
// leest "0,1" en "0.1" als hetzelfde getal en houdt zijn eigen grenzen.
import assert from 'node:assert/strict';
import test from 'node:test';

import { leesSchaalInvoer, normaliseerSchaal } from '../symbols/symbol-scale.js';
import { leesZoomInvoer } from './zoom-display.js';
import { leesMaatInvoer } from '../annotations/minimummaat.js';
import { leesInvoerInEenheid } from '../annotations/papiermaat-eenheid.js';
import { sanitizeCountInput, sanitizeFontSizeInput } from '../annotations/stavenreeks.js';
import { geldigePosterSchaal, geldigeOverlap } from '../pdf/print-poster.js';
import { geldigePxPerInch, pxPerInchUitLengte } from '../pdf/schermkalibratie.js';
import { parseShiftInput } from '../pdf/shift-page-geometry.js';
import { geldigAantal, geldigeMb } from '../pdf/splits-logica.js';
import { pendikte } from '../pdf/cad-import-logica.js';
import { schaalNoemer } from '../drafting/constructie/raster.js';
import { scaleKeyFromScaleString } from '../drafting/tekeningtype.js';

const bijna = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('symboolschaal in het palet: 0,1 en 0.1, met en zonder x', () => {
  for (const s of ['0,1', '0.1', '0,1x', '0.1x', ' 0,1 × ']) assert.equal(leesSchaalInvoer(s), 0.1, s);
  for (const s of ['1,5', '1.5', '1,5x', '150%']) assert.equal(leesSchaalInvoer(s), 1.5, s);
  assert.equal(leesSchaalInvoer('onzin'), null);
  assert.equal(leesSchaalInvoer('-1'), null);
  assert.equal(normaliseerSchaal('0,5'), 0.5);
  assert.equal(normaliseerSchaal('0.5'), 0.5);
});

test('zoomveld in de statusbalk', () => {
  for (const s of ['62,5', '62.5', '62,5 %', '62.5%']) assert.equal(leesZoomInvoer(s), 62.5, s);
  assert.equal(leesZoomInvoer('150%'), 150);
  assert.equal(leesZoomInvoer('0,1'), null, 'onder 10%');
  assert.equal(leesZoomInvoer('0.1'), null);
  assert.equal(leesZoomInvoer('abc'), null);
  assert.equal(leesZoomInvoer('١٥٠%'), 150, 'Arabische cijfers zoals de statusbalk ze toont');
});

test('maatvelden van vormen (BoxSizeOverlay, papiermaat)', () => {
  assert.equal(leesMaatInvoer('0,1'), 0.1);
  assert.equal(leesMaatInvoer('0.1'), 0.1);
  assert.equal(leesMaatInvoer('1.234,5'), 1234.5);
  assert.equal(leesMaatInvoer('0'), null);
  bijna(leesInvoerInEenheid('2,5', 'pt'), 2.5);
  bijna(leesInvoerInEenheid('2.5', 'pt'), 2.5);
  bijna(leesInvoerInEenheid('25,4', 'mm'), 72);
});

test('stavenreeks: aantal en tekstgrootte', () => {
  assert.equal(sanitizeCountInput('12,4'), 12);
  assert.equal(sanitizeCountInput('12.4'), 12);
  assert.equal(sanitizeFontSizeInput('10,6'), 11);
  assert.equal(sanitizeFontSizeInput('10.6'), 11);
  assert.equal(sanitizeFontSizeInput('abc', 9), 9);
});

test('posterafdruk: schaal en overlap', () => {
  assert.equal(geldigeOverlap('2,5'), 2.5);
  assert.equal(geldigeOverlap('2.5'), 2.5);
  assert.equal(geldigePosterSchaal('150,4'), 150);
  assert.equal(geldigePosterSchaal('150.4'), 150);
});

test('schermkalibratie', () => {
  assert.equal(geldigePxPerInch('96,5'), 96.5);
  assert.equal(geldigePxPerInch('96.5'), 96.5);
  assert.equal(pxPerInchUitLengte(96, '25,4'), 96);
  assert.equal(pxPerInchUitLengte(96, '25.4'), 96);
});

test('pagina verschuiven, document splitsen, CAD-pendikte', () => {
  assert.equal(parseShiftInput('-0,1'), -0.1);
  assert.equal(parseShiftInput('-0.1'), -0.1);
  assert.equal(parseShiftInput('-'), 0);
  assert.equal(geldigAantal('3,0'), 3);
  assert.equal(geldigeMb('0,5'), 0.5);
  assert.equal(geldigeMb('0.5'), 0.5);
  assert.equal(geldigeMb('', 7), 7);
  assert.equal(pendikte('0,1'), 0.1);
  assert.equal(pendikte('0.1'), 0.1);
  assert.equal(pendikte('abc'), null);
});

test('tekeningschalen als verhouding', () => {
  assert.equal(schaalNoemer('1:100'), 100);
  assert.equal(schaalNoemer('1:2,5'), 2.5);
  assert.equal(schaalNoemer('1:2.5'), 2.5);
  assert.equal(schaalNoemer('0,1'), 0.1);
  assert.equal(scaleKeyFromScaleString('1:100'), '0.01');
  assert.equal(scaleKeyFromScaleString('1:12,5'), scaleKeyFromScaleString('1:12.5'));
});
