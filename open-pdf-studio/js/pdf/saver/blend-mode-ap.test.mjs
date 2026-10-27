// Mengmodus in de appearance stream (#614): /BM in dezelfde graphics-state
// als de alfa (#512), ook bij volledige dekking, en terug bij heropenen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { zetDoorzichtigheidInAp } from './utils.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { BLEND_MODES, blendPdfNaam } from '../../annotations/blend-modes.js';

const RECT = [100, 100, 200, 200];

function annotatieMetAp(doc, inhoud, { resources = {}, subtype = 'Square', extra = {} } = {}) {
  const ap = doc.context.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Resources: doc.context.obj(resources),
  });
  return doc.context.obj({
    Type: 'Annot', Subtype: subtype, Rect: RECT,
    AP: doc.context.obj({ N: doc.context.register(ap) }), ...extra,
  });
}

const nVan = (doc, annot) => doc.context.lookup(doc.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
const tekst = (stream) => Buffer.from(stream instanceof PDFRawStream
  ? decodePDFRawStream(stream).decode() : stream.getContents()).toString('latin1');
const gsoVan = (doc, n) => doc.context.lookup(doc.context.lookup(
  doc.context.lookup(n.dict.get(PDFName.of('Resources'))).get(PDFName.of('ExtGState'))).get(PDFName.of('GSo')));

async function heropend(doc, annot) {
  const pagina = doc.addPage([612, 792]);
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  const terug = await PDFDocument.load(await doc.save());
  return (await extractAnnotationColors(1, terug)).get(RECT.join(','));
}

test('een mengmodus belandt als /BM in de appearance, ook bij volledige dekking', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '1 0 0 rg 0 0 10 10 re f');
  zetDoorzichtigheidInAp(doc.context, annot, 1, { blendMode: 'multiply' });
  const n = nVan(doc, annot);
  assert.match(tekst(n), /^\/GSo gs\b/, 'vóór al het tekenwerk');
  assert.match(tekst(n), /1 0 0 rg 0 0 10 10 re f/, 'de inhoud blijft');
  const gs = gsoVan(doc, n);
  assert.equal(gs.get(PDFName.of('BM')).toString(), '/Multiply');
  assert.equal(gs.get(PDFName.of('ca')), undefined, 'geen alfa bij volledige dekking');
  assert.equal(gs.get(PDFName.of('CA')), undefined);
});

test('alfa en mengmodus in dezelfde graphics-state', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 m 10 10 l S');
  zetDoorzichtigheidInAp(doc.context, annot, 0.5, { blendMode: 'screen' });
  const gs = gsoVan(doc, nVan(doc, annot));
  assert.equal(gs.get(PDFName.of('BM')).toString(), '/Screen');
  assert.equal(doc.context.lookup(gs.get(PDFName.of('CA'))).asNumber(), 0.5);
  assert.equal(doc.context.lookup(gs.get(PDFName.of('ca'))).asNumber(), 0.5);
});

test('als groep mengt de hele appearance in één keer', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 1 RG 0 0 m 10 10 l S');
  zetDoorzichtigheidInAp(doc.context, annot, 1, { alsGroep: true, blendMode: 'darken' });
  const n = nVan(doc, annot);
  assert.match(tekst(n), /^\/GSo gs\s+\/OPSg Do\s*$/);
  assert.equal(gsoVan(doc, n).get(PDFName.of('BM')).toString(), '/Darken');
});

test('normaal, onbekend of zonder modus: de appearance blijft ongemoeid', async () => {
  for (const blendMode of [undefined, null, 'normal', 'plasma']) {
    const doc = await PDFDocument.create();
    const annot = annotatieMetAp(doc, '0 0 m 1 1 l S');
    const voor = nVan(doc, annot);
    zetDoorzichtigheidInAp(doc.context, annot, 1, { blendMode });
    assert.equal(nVan(doc, annot), voor, String(blendMode));
  }
});

test('niet-scheidbare modi: alleen /BM, geen overdruk-sleutels', async () => {
  // /OPM hoort bij overdrukken (CMYK), niet bij Hue/Saturation/Color/Luminosity.
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 m 1 1 l S');
  zetDoorzichtigheidInAp(doc.context, annot, 1, { blendMode: 'luminosity' });
  const gs = gsoVan(doc, nVan(doc, annot));
  assert.equal(gs.get(PDFName.of('BM')).toString(), '/Luminosity');
  assert.equal(gs.get(PDFName.of('OPM')), undefined);
  assert.equal(gs.get(PDFName.of('OP')), undefined);
});

test('elke modus komt na heropenen terug', async () => {
  for (const mode of BLEND_MODES.slice(1)) {
    const doc = await PDFDocument.create();
    const annot = annotatieMetAp(doc, '1 0 0 rg 0 0 10 10 re f');
    zetDoorzichtigheidInAp(doc.context, annot, 0.6, { blendMode: mode });
    const extra = await heropend(doc, annot);
    assert.equal(extra.blendMode, mode, mode);
    assert.equal(extra.opacity, 0.6, 'de alfa uit dezelfde graphics-state blijft');
  }
});

test('lezen: alleen de graphics-states die de stream echt activeert', async () => {
  const doc = await PDFDocument.create();
  const ongebruikt = doc.context.obj({ Type: 'ExtGState', BM: PDFName.of('Screen') });
  const annot = annotatieMetAp(doc, '1 0 0 rg 0 0 10 10 re f',
    { resources: { ExtGState: doc.context.obj({ GSx: ongebruikt }) } });
  assert.equal((await heropend(doc, annot)).blendMode, undefined);
});

test('lezen: een /BM-array en een eigen graphics-state van een ander programma', async () => {
  const doc = await PDFDocument.create();
  const gs = doc.context.obj({ Type: 'ExtGState', BM: doc.context.obj([PDFName.of('Overlay'), PDFName.of('Normal')]) });
  const annot = annotatieMetAp(doc, '/GS7 gs 1 0 0 rg 0 0 10 10 re f',
    { resources: { ExtGState: doc.context.obj({ GS7: gs }) } });
  assert.equal((await heropend(doc, annot)).blendMode, 'overlay');
});

test('lezen: /BM op de annotatie zelf (PDF 2.0) als de appearance er geen heeft', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '1 0 0 rg 0 0 10 10 re f', { extra: { BM: PDFName.of('HardLight') } });
  assert.equal((await heropend(doc, annot)).blendMode, 'hardLight');
});

test('lezen: Normal en Compatible zijn geen mengmodus', async () => {
  for (const naam of ['Normal', 'Compatible']) {
    const doc = await PDFDocument.create();
    const gs = doc.context.obj({ Type: 'ExtGState', BM: PDFName.of(naam) });
    const annot = annotatieMetAp(doc, '/G gs 0 0 m 1 1 l S', { resources: { ExtGState: doc.context.obj({ G: gs }) } });
    assert.equal((await heropend(doc, annot)).blendMode, undefined, naam);
  }
});

test('lezen: de vermenigvuldiging van een tekstmarkering is haar gewone uiterlijk, geen keuze', async () => {
  const doc = await PDFDocument.create();
  const gs = doc.context.obj({ Type: 'ExtGState', BM: PDFName.of('Multiply') });
  const annot = annotatieMetAp(doc, '/GSm gs 1 1 0 rg 0 0 10 10 re f', {
    subtype: 'Highlight', resources: { ExtGState: doc.context.obj({ GSm: gs }) },
    extra: { QuadPoints: [100, 200, 200, 200, 100, 100, 200, 100] },
  });
  assert.equal((await heropend(doc, annot)).blendMode, undefined);
});

test('PDF-namen kloppen met de specificatie (geen streepjes, CamelCase)', () => {
  for (const m of BLEND_MODES.slice(1)) assert.match(blendPdfNaam(m), /^[A-Z][A-Za-z]+$/, m);
});
