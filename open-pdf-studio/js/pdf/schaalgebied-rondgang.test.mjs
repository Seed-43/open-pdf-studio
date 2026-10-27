// Schaalgebied (#611): de vulling en de rand volgen de eigenschappen in de
// appearance van het bestand en na opslaan en heropenen, met de echte saver en
// de echte lader. (Het scherm: scale-region-style.test.mjs.) Een bestaand
// schaalgebied (zonder eigen vulling) ziet er hetzelfde uit als voorheen, en
// vlakken laat een schaalgebied een meethulp.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF, bouwAnnotatieDocument } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { schaalgebiedStijl } = await import('../annotations/scale-region-style.js');
const { vlakDocument } = await import('./flatten-bytes.js');
const { teVlakkenNa } = await import('./flatten-all.js');

const N = (s) => PDFName.of(s);

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

function zetDocument(modellen, bronBytes) {
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { globalThis.__saverTest.uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { globalThis.__saverTest.uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'sg', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
  }];
  state.activeDocumentIndex = 0;
}

async function opslaan(bronBytes, modellen) {
  zetDocument(modellen, bronBytes);
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return globalThis.__saverTest.uit;
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

/** De schaalgebieden in het bestand: sleutels en de appearance. */
async function inBestand(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const tekst = (s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString('latin1');
  return doc.getPage(0).node.Annots().asArray().map((ref) => {
    const d = ctx.lookup(ref);
    const ap = d.get(N('AP')) && ctx.lookup(d.get(N('AP')));
    const n = ap && ctx.lookup(ap.get(N('N')));
    const gs = {};
    const res = n && ctx.lookup(n.dict.get(N('Resources')));
    const egs = res && ctx.lookup(res.get(N('ExtGState')));
    for (const [k, v] of egs ? egs.entries() : []) {
      const g = ctx.lookup(v);
      gs[k.asString().slice(1)] = {
        ca: g.get(N('ca'))?.asNumber?.(), CA: g.get(N('CA'))?.asNumber?.(),
      };
    }
    const num = (k) => (d.get(N(k)) ? ctx.lookup(d.get(N(k))).asNumber() : undefined);
    return {
      subtype: String(d.get(N('Subtype'))),
      opsSubtype: d.get(N('OPS_Subtype'))?.decodeText?.(),
      CA: num('CA'),
      opsFillOpacity: num('OPS_FillOpacity'),
      ic: d.get(N('IC')) ? ctx.lookup(d.get(N('IC'))).asArray().map((x) => x.asNumber()) : null,
      ap: n ? tekst(n) : null,
      gs,
    };
  });
}

const basis = {
  page: 1, type: 'scaleRegion', x: 120, y: 200, width: 200, height: 150,
  scaleString: '1:100', units: 'mm', label: '', color: '#ff9800', lineWidth: 1.5,
  borderStyle: 'dashed', opacity: 1, author: 'Tester',
  createdAt: '2026-10-19T10:00:00.000Z', modifiedAt: '2026-10-19T10:00:00.000Z',
};

test('opslaan en heropenen: zonder eigen vulling blijft het het oude uiterlijk, zonder nieuwe sleutels', async () => {
  const eerste = await opslaan(await leegBlad(), [{ ...basis, id: 'oud' }]);
  const [a] = await inBestand(eerste);
  assert.equal(a.subtype, '/Square');
  assert.equal(a.opsSubtype, 'scaleRegion');
  assert.equal(a.opsFillOpacity, undefined, 'geen OPS_FillOpacity zonder eigen waarde');
  assert.equal(a.ic, null, 'geen /IC zonder eigen vulkleur');
  // De appearance draagt de tint (10 %) en de volle rand, gestreept.
  assert.deepEqual(a.gs.GSv, { ca: 0.1, CA: undefined });
  assert.deepEqual(a.gs.GSr, { ca: undefined, CA: 1 });
  assert.match(a.ap, /\[6 3\] 0 d/);
  assert.match(a.ap, / re f/);
  assert.match(a.ap, / re S/);

  const terug = await laad(eerste);
  assert.equal(terug.length, 1);
  const m = terug[0];
  assert.equal(m.type, 'scaleRegion');
  assert.equal(m.fillOpacity, undefined, 'de alfa uit de appearance wordt geen eigen waarde');
  assert.equal(m.fillColor, undefined);
  assert.equal(m.opacity, 1);
  assert.equal(m.color, '#ff9800');
  assert.ok(Math.abs(schaalgebiedStijl(m).vulAlfa - 0.1) < 1e-9, 'na heropenen hetzelfde uiterlijk');

  // Nogmaals opslaan: één annotatie, één appearance zonder stapeling.
  const tweede = await opslaan(eerste, terug);
  const b = await inBestand(tweede);
  assert.equal(b.length, 1, 'geen dubbele annotaties');
  assert.equal(b[0].opsFillOpacity, undefined);
  assert.equal((b[0].ap.match(/\/GSv gs/g) || []).length, 1);
});

test('eigen vulkleur, vul-doorzichtigheid en doorzichtigheid komen terug, ook bij gelijke waarden', async () => {
  const modellen = [
    { ...basis, id: 'groen', fillColor: '#00aa00', fillOpacity: 0.5, opacity: 0.5 },
    { ...basis, id: 'vol', x: 340, fillOpacity: 1 },
    { ...basis, id: 'leeg', y: 400, fillOpacity: 0 },
  ];
  const eerste = await opslaan(await leegBlad(), modellen.map((m) => ({ ...m })));
  const bestand = await inBestand(eerste);
  assert.equal(bestand.length, 3);
  const perVul = Object.fromEntries(bestand.map((a) => [a.opsFillOpacity, a]));
  // Gelijk aan /CA (0,5 en 0,5) komt de sleutel er toch in.
  assert.equal(perVul[0.5].CA, 0.5);
  assert.deepEqual(perVul[0.5].ic.map((x) => Math.round(x * 255)), [0, 170, 0]);
  assert.equal(perVul[0.5].gs.GSv.ca, 0.5);
  assert.equal(perVul[1].gs.GSv.ca, 1);
  assert.ok(!perVul[0].gs.GSv, 'vul-doorzichtigheid 0: geen vulling in de appearance');
  assert.ok(!/ re f/.test(perVul[0].ap));

  const sleutel = (m) => [m.fillOpacity, m.fillColor ?? null, m.opacity, m.color];
  const verwacht = modellen.map(sleutel).sort();
  const terug = await laad(eerste);
  assert.deepEqual(terug.map((m) => sleutel({ ...m, fillColor: m.fillColor?.toLowerCase() })).sort(), verwacht);

  const tweede = await opslaan(eerste, terug);
  const terug2 = await laad(tweede);
  assert.equal(terug2.length, 3, 'geen dubbele annotaties');
  assert.deepEqual(terug2.map((m) => sleutel({ ...m, fillColor: m.fillColor?.toLowerCase() })).sort(), verwacht);
  for (const a of await inBestand(tweede)) {
    assert.ok((a.ap.match(/\/GSo gs/g) || []).length <= 1, 'geen stapeling van de doorzichtigheid');
  }
});

test('een bestand van vóór deze wijziging (zonder appearance) opent met het oude uiterlijk', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const dict = ctx.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [120, 492, 320, 642], C: [1, 152 / 255, 0], CA: 1,
    T: PDFString.of('Tester'), Contents: PDFString.of(''), F: 4,
    OPS_Subtype: PDFString.of('scaleRegion'), OPS_ScaleString: PDFString.of('1:100'), OPS_Units: PDFString.of('mm'),
    OPS_LineWidth: 1.5,
  });
  pagina.node.set(N('Annots'), ctx.obj([ctx.register(dict)]));
  const [m] = await laad(await doc.save());
  assert.equal(m.type, 'scaleRegion');
  assert.equal(m.fillOpacity, undefined);
  assert.equal(m.fillColor, undefined);
  const r = schaalgebiedStijl(m);
  assert.ok(Math.abs(r.vulAlfa - 0.1) < 1e-9);
  assert.equal(r.randAlfa, 1);
});

test('alles vlakken laat een schaalgebied een markering (meethulp), en bakt de rest', async () => {
  const bron = await leegBlad();
  const modellen = [
    { ...basis, id: 'gebied', fillOpacity: 0.4 },
    { ...basis, id: 'kader', type: 'box', x: 60, y: 600, width: 80, height: 60, strokeColor: '#cc0000', fillColor: null, lineWidth: 2, borderStyle: 'solid' },
  ];
  zetDocument(modellen, bron);
  const { pdfDocLib, eersteNieuwObject } = await bouwAnnotatieDocument(state.documents[0]);
  const uitkomst = vlakDocument(pdfDocLib, {
    annotaties: modellen, herstelbaar: true, isTeVlakken: teVlakkenNa(eersteNieuwObject),
  });
  assert.deepEqual(uitkomst.gebakkenIds, ['kader']);
  const over = pdfDocLib.getPage(0).node.Annots().asArray().map((r) => pdfDocLib.context.lookup(r));
  assert.equal(over.length, 1);
  assert.equal(over[0].get(N('OPS_Subtype')).decodeText(), 'scaleRegion');
});
