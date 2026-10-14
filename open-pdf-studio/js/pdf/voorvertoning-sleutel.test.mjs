import assert from 'node:assert/strict';
import test from 'node:test';
import { voorvertoningSleutel, voorvertoningRotatie, maakVoorvertoningLus } from './voorvertoning-sleutel.js';

test('de sleutel hoort bij het gerenderde document, niet bij het actieve', () => {
  const a = { filePath: 'C:/a.pdf', pageRotations: { 2: 90 }, viewRotation: 0 };
  const b = { filePath: 'C:/b.pdf', pageRotations: {}, viewRotation: 180 };
  assert.equal(voorvertoningSleutel(a, 1), 'C:/a.pdf|1|0');
  assert.equal(voorvertoningSleutel(a, 2), 'C:/a.pdf|2|90');
  assert.equal(voorvertoningSleutel(b, 2), 'C:/b.pdf|2|180');
  assert.equal(voorvertoningSleutel({ filePath: null, pageRotations: { 1: 270 }, viewRotation: 180 }, 1), 'blank|1|90');
  assert.notEqual(voorvertoningSleutel(a, 3), voorvertoningSleutel(b, 3));
  assert.equal(voorvertoningRotatie(a, 2), 90);
  assert.equal(voorvertoningRotatie({ pageRotations: { 1: 180 }, viewRotation: 270 }, 1), 90);
});

test('de achtergrondlus stopt bij een documentwissel en bij een nieuwere lus', () => {
  const pdfA = { naam: 'a' }, pdfB = { naam: 'b' };
  let actief = { pdfDoc: pdfA };
  const start = maakVoorvertoningLus(() => actief);
  const lusA = start(pdfA);
  assert.equal(lusA(), true);
  actief = { pdfDoc: pdfB };                 // ander tabblad, of een nieuw geopend bestand
  assert.equal(lusA(), false, 'de lus van het vorige document stopt');
  const lusB = start(pdfB);
  assert.equal(lusB(), true);
  const lusB2 = start(pdfB);                 // opnieuw opgebouwd (zoom): de nieuwe lus neemt het over
  assert.equal(lusB(), false);
  assert.equal(lusB2(), true);
  actief = null;                             // document gesloten
  assert.equal(lusB2(), false);
});
