// Ruwe sleutels van een annotatie (#621): zie ruwe-sleutels.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { leesRuweSleutels, schrijfRuweSleutels, EIGEN_SLEUTELS } from './ruwe-sleutels.js';

async function context() {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  return doc;
}
const N = (n) => PDFName.of(n);

test('alleen sleutels die de app niet beheert, als gewone JSON', async () => {
  const doc = await context();
  const ctx = doc.context;
  const d = ctx.obj({
    Type: 'Annot', Subtype: 'Line', Rect: [0, 0, 10, 10], C: [1, 0, 0], Contents: PDFString.of('x'),
    OPS_Subtype: PDFString.of('wall'), LineStyleName: PDFString.of('Hek'), NumCounts: 3, Vlag: true,
    CountStyle: N('Circle'), Lijst: [1, N('A'), PDFString.of('b')],
  });
  const ruw = leesRuweSleutels(ctx, d);
  assert.equal(ruw.soort, '/Line');
  assert.deepEqual(Object.keys(ruw.sleutels).sort(), ['CountStyle', 'Lijst', 'LineStyleName', 'NumCounts', 'Vlag']);
  assert.deepEqual(JSON.parse(JSON.stringify(ruw)), ruw, 'overleeft een JSON-kloon');
  for (const k of ['Rect', 'C', 'Contents', 'AP', 'OC', 'Popup', 'Q', 'RC']) assert.ok(EIGEN_SLEUTELS.has(k), k);
});

test('een verwijzing naar een pagina, annotatie of laag valt weg; een kring ook', async () => {
  const doc = await context();
  const ctx = doc.context;
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('L') }));
  const kring = ctx.obj({ Naam: PDFString.of('k') });
  const kringRef = ctx.register(kring);
  kring.set(N('Zelf'), kringRef);
  const d = ctx.obj({
    Type: 'Annot', Subtype: 'Square', NaarPagina: doc.getPage(0).ref, NaarLaag: ocg, Kring: kringRef, Goed: 1,
  });
  assert.deepEqual(Object.keys(leesRuweSleutels(ctx, d).sleutels), ['Goed']);
});

test('terugschrijven maakt nieuwe objecten, ook voor een stroom achter een verwijzing', async () => {
  const bron = await context();
  const stroom = bron.context.register(bron.context.stream('1 0 0 RG', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }));
  const ruw = leesRuweSleutels(bron.context, bron.context.obj({ Type: 'Annot', Subtype: 'Line', Stijl: [bron.context.obj({ Merk: stroom })] }));
  const doel = await context();
  const d = doel.context.obj({ Type: 'Annot', Subtype: 'Line' });
  assert.deepEqual(schrijfRuweSleutels(doel.context, d, ruw), ['Stijl']);
  const merk = doel.context.lookup(doel.context.lookup(d.get(N('Stijl'))).get(0)).get(N('Merk'));
  assert.ok(merk instanceof PDFRef, 'de stroom is een indirect object in het doel');
  assert.equal(Buffer.from(decodePDFRawStream(doel.context.lookup(merk)).decode()).toString('latin1'), '1 0 0 RG');
});

test('wat de saver schreef wint; een andere soort krijgt niets', async () => {
  const doc = await context();
  const ctx = doc.context;
  const ruw = { soort: '/Square', sleutels: { Extra: 5, BSIColumnData: [{ s: '4142' }] } };
  const d = ctx.obj({ Type: 'Annot', Subtype: 'Square', Extra: 7 });
  assert.deepEqual(schrijfRuweSleutels(ctx, d, ruw), ['BSIColumnData']);
  assert.equal(d.get(N('Extra')).asNumber(), 7);
  assert.equal(d.get(N('BSIColumnData')).asArray()[0].decodeText(), 'AB');
  const stempel = ctx.obj({ Type: 'Annot', Subtype: 'Stamp' });
  assert.deepEqual(schrijfRuweSleutels(ctx, stempel, ruw), []);
});

test('/IT: de bedoeling van een meting blijft die van het bestand, die van tekst is van de app', async () => {
  const doc = await context();
  const ctx = doc.context;
  const ruw = (soort, it) => ({ soort, sleutels: { IT: { n: it } } });
  const meting = ctx.obj({ Type: 'Annot', Subtype: 'Polygon', IT: N('PolygonDimension'), OPS_Subtype: PDFString.of('measureArea') });
  schrijfRuweSleutels(ctx, meting, ruw('/Polygon', 'RectangleSketchToScale'));
  assert.equal(meting.get(N('IT')).toString(), '/RectangleSketchToScale');
  const telling = ctx.obj({ Type: 'Annot', Subtype: 'Polygon' });
  schrijfRuweSleutels(ctx, telling, ruw('/Polygon', 'PolygonCount'));
  assert.equal(telling.get(N('IT')).toString(), '/PolygonCount');
  const tekstvak = ctx.obj({ Type: 'Annot', Subtype: 'FreeText' });
  schrijfRuweSleutels(ctx, tekstvak, ruw('/FreeText', 'FreeTextTypewriter'));
  assert.equal(tekstvak.get(N('IT')), undefined, 'het model van het tekstvak bepaalt de bedoeling');
});

test('te groot: de sleutel valt weg, de rest blijft', async () => {
  const doc = await context();
  const ctx = doc.context;
  const groot = ctx.register(ctx.stream(new Uint8Array(600 * 1024), {}));
  const ruw = leesRuweSleutels(ctx, ctx.obj({ Type: 'Annot', Subtype: 'Line', Groot: groot, Klein: 1 }));
  assert.deepEqual(Object.keys(ruw.sleutels), ['Klein']);
  assert.ok(!(ruw instanceof PDFDict));
});
