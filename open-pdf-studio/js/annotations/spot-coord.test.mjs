// Spot Coord: een maatlijn-leidraad met coördinaten als label. Het merk
// (dimKind 'spotCoord') moet een opslag-rondgang overleven, anders schrijft
// de eerstvolgende herberekening na heropenen er toch weer een lengte in.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';

import { SPOT_COORD, isSpotCoord, spotCoordTekst } from './spot-coord.js';
import { maatlijnAnnotatie } from '../pdf/saver/maatlijn-opslaan.js';
import { extractAnnotationColors } from '../pdf/loader/color-extraction.js';
import { extraVoorAnnotatie } from '../pdf/loader/extra-sleutel.js';
import { maatlijnUitBestand } from '../pdf/loader/maatlijn-uit-bestand.js';

test('spotCoordTekst: coördinaten in meeteenheden, zes significante cijfers', () => {
  assert.equal(spotCoordTekst(100, 50, { pixelsPerUnit: 2, unit: 'mm' }), 'X 50, Y 25 mm');
  assert.equal(spotCoordTekst(10, 10, { pixelsPerUnit: 3, unit: 'm' }), 'X 3.33333, Y 3.33333 m');
  assert.equal(spotCoordTekst(7, 8, {}), 'X 7, Y 8 mm');
  assert.equal(spotCoordTekst(NaN, 8, { pixelsPerUnit: 1, unit: 'mm' }), 'X 0, Y 8 mm');
});

test('isSpotCoord: alleen een measureDistance met het merk', () => {
  assert.equal(isSpotCoord({ type: 'measureDistance', dimKind: SPOT_COORD }), true);
  assert.equal(isSpotCoord({ type: 'measureDistance' }), false);
  assert.equal(isSpotCoord({ type: 'line', dimKind: SPOT_COORD }), false);
  assert.equal(isSpotCoord(null), false);
});

const SPOT = {
  type: 'measureDistance', dimKind: SPOT_COORD, startX: 100, startY: 200, endX: 160, endY: 170,
  startHead: 'closed', endHead: 'none', strokeColor: '#ff0000', lineWidth: 1, headSize: 12,
  dimExtension: false, measureText: 'X 100, Y 200 mm', measureUnit: 'mm', author: 'User', opacity: 1,
};

async function opgeslagenPdf(ann) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const context = doc.context;
  const annotDict = maatlijnAnnotatie({
    ann, context, convertX: (x) => x, convertY: (y) => 792 - y, opacity: 1, borderWidth: 1,
  });
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  return { annotDict, bytes: await doc.save() };
}

/** Lezen zoals js/pdf/loader.js: pdf.js-annotaties met viewport, plus de extra sleutels. */
async function gelezen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const annots = await pagina.getAnnotations();
  await doc.loadingTask.destroy();
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
  return annots.map((annot) => maatlijnUitBestand({ annot, extra: extraVoorAnnotatie(kaart, annot) || {}, convertPoint }));
}

test('opslaan en heropenen: het Spot Coord-merk blijft staan', async () => {
  const { annotDict, bytes } = await opgeslagenPdf(SPOT);
  assert.equal(annotDict.get(PDFName.of('OPS_DimKind'))?.toString(), '/SpotCoord');
  const [terug] = await gelezen(bytes);
  assert.equal(terug.type, 'measureDistance');
  assert.equal(terug.dimKind, SPOT_COORD);
});

test('een gewone maat krijgt geen merk', async () => {
  const { dimKind, ...gewoon } = SPOT;
  assert.equal(dimKind, SPOT_COORD);
  const { annotDict, bytes } = await opgeslagenPdf({ ...gewoon, measureText: '67 mm' });
  assert.equal(annotDict.get(PDFName.of('OPS_DimKind')), undefined);
  const [terug] = await gelezen(bytes);
  assert.equal(terug.dimKind, undefined);
});

test('herberekening en greepbewerking slaan het merk niet over', () => {
  const meting = readFileSync(new URL('./measurement.js', import.meta.url), 'utf8');
  const lus = meting.slice(meting.indexOf('function recalculateMeasurementsIn'));
  assert.match(lus, /if \(isSpotCoord\(ann\)\) \{ syncSpotCoord\(ann\); continue; \}/);
  const transforms = readFileSync(new URL('./transforms.js', import.meta.url), 'utf8');
  const sync = transforms.slice(transforms.indexOf('function syncDimensionMeasurement'));
  assert.match(sync.slice(0, 300), /if \(isSpotCoord\(ann\)\) \{ syncSpotCoord\(ann\); return; \}/);
  const gereedschap = readFileSync(new URL('../tools/tools/spot-coord-tool.js', import.meta.url), 'utf8');
  assert.ok(gereedschap.includes('dimKind: SPOT_COORD'));
});
