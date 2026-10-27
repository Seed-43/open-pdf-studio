// Alles vlakken / alles terughalen (#615): de hele rondgang met de echte
// saver (saver-test-hooks.mjs) en de echte lader, zoals de app hem doet.
//
// opslaan met markeringen → heropenen → vlakken (bouwAnnotatieDocument +
// vlakDocument) → opslaan → heropenen: geen annotaties meer, de markeringen
// staan in de pagina-inhoud (ook voor een andere lezer: pdf.js tekent de
// Form XObjects). Daarna terughalen → opslaan → heropenen: dezelfde
// markeringen met dezelfde eigenschappen, geen gevlakt blok, geen dubbele.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFArray, PDFStream } from 'pdf-lib';

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
const { createAnnotation } = await import('../annotations/factory.js');
const { vlakDocument, ontvlakDocument, ruimOnbereikbaarOp, FLATTEN_SLEUTEL, BATCH_SLEUTEL } = await import('./flatten-bytes.js');
const { vlakbareAnnotaties, voegTeruggehaaldToe } = await import('./flatten-all.js');

const N = (s) => PDFName.of(s);

async function leegBlad() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595, 842]);
  p.drawText('Bladinhoud', { x: 40, y: 20, size: 10 });
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt, plus wat pdf.js op de pagina tekent. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  const annots = await pagina.getAnnotations();
  for (const annot of annots) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  // Wat een andere lezer van de pagina-inhoud tekent (zonder annotaties).
  const ops = await pagina.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
  const formulieren = ops.fnArray.filter((f) => f === pdfjs.OPS.paintFormXObjectBegin).length;
  await doc.loadingTask.destroy();
  return { modellen: modellen.filter(Boolean), pdfjsAnnots: annots.length, formulieren };
}

function document(modellen, bytes) {
  state.documents = [{
    id: 'vlak', filePath: 'C:/vlak/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
  }];
  state.activeDocumentIndex = 0;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bytes,
      writeBinaryFile: () => true,
      writeBinaryFileAtomic: (_pad, b) => { globalThis.__saverTest.uit = b; return true; },
    },
  };
  return state.documents[0];
}

/** Opslaan met de echte saver, op de bytes van het geopende bestand. */
async function opslaan(bronBytes, modellen) {
  document(modellen, bronBytes);
  assert.equal(await savePDF('C:/vlak/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return globalThis.__saverTest.uit;
}

/** Alles vlakken zoals flatten-all.js het doet, zonder herladen. */
async function vlak(bytes, modellen, herstelbaar = true) {
  const doc = document(modellen, bytes);
  const { pdfDocLib, eersteNieuwObject } = await bouwAnnotatieDocument(doc);
  const teVlakken = vlakbareAnnotaties(modellen);
  const r = vlakDocument(pdfDocLib, {
    annotaties: teVlakken, herstelbaar,
    isTeVlakken: (ref) => ref.objectNumber > eersteNieuwObject,
  });
  const gebakken = new Set(r.gebakkenIds);
  const blijft = teVlakken.filter((a) => !gebakken.has(String(a.id)));
  await pdfDocLib.flush();
  ruimOnbereikbaarOp(pdfDocLib);
  return { ...r, blijft, bytes: new Uint8Array(await pdfDocLib.save()) };
}

function markeringen() {
  return [
    createAnnotation({ type: 'box', page: 1, x: 50, y: 60, width: 120, height: 80, color: '#ff0000',
      strokeColor: '#ff0000', fillColor: '#ffff00', lineWidth: 2, author: 'Tester', subject: 'Vak' }),
    createAnnotation({ type: 'circle', page: 1, x: 220, y: 60, width: 90, height: 90, color: '#0000ff',
      strokeColor: '#0000ff', lineWidth: 3, author: 'Tester' }),
    createAnnotation({ type: 'arrow', page: 1, startX: 60, startY: 300, endX: 300, endY: 360, color: '#008000',
      strokeColor: '#008000', lineWidth: 2, headSize: 12, author: 'Tester' }),
    createAnnotation({ type: 'draw', page: 1, path: [{ x: 60, y: 420 }, { x: 120, y: 470 }, { x: 200, y: 430 }, { x: 260, y: 500 }],
      color: '#000000', strokeColor: '#000000', lineWidth: 2, author: 'Tester' }),
    createAnnotation({ type: 'polygon', page: 1, points: [{ x: 350, y: 300 }, { x: 500, y: 320 }, { x: 450, y: 420 }],
      color: '#ff00ff', strokeColor: '#ff00ff', lineWidth: 2, author: 'Tester' }),
    createAnnotation({ type: 'textbox', page: 1, x: 330, y: 60, width: 200, height: 60, text: 'Vlak mij',
      fontSize: 14, fontFamily: 'Helvetica', color: '#000000', textColor: '#000000', strokeColor: '#000000',
      fillColor: '#ffffff', lineWidth: 1, author: 'Tester' }),
    // Een notitie heeft geen eigen uiterlijk op de pagina: die blijft markering.
    createAnnotation({ type: 'comment', page: 1, x: 520, y: 700, text: 'Blijft een notitie', color: '#ffff00', author: 'Tester' }),
  ];
}

/** De eigenschappen die na de rondgang gelijk moeten zijn. */
function kenmerken(m) {
  const r = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  const punten = (l) => (Array.isArray(l) ? l.map((p) => [r(p.x), r(p.y)]) : undefined);
  return {
    type: m.type, color: m.color, strokeColor: m.strokeColor, fillColor: m.fillColor ?? null,
    lineWidth: r(m.lineWidth), opacity: r(m.opacity), author: m.author, subject: m.subject || '',
    x: r(m.x), y: r(m.y), width: r(m.width), height: r(m.height),
    startX: r(m.startX), startY: r(m.startY), endX: r(m.endX), endY: r(m.endY),
    path: punten(m.path), points: punten(m.points), text: m.text,
  };
}

const sorteer = (l) => [...l].sort((a, b) => (a.type + a.x + a.startX).localeCompare(b.type + b.x + b.startX));

/** Annotatiewoordenboeken in het hele bestand, ook onbereikbare. */
function annotObjecten(pdfDoc) {
  return pdfDoc.context.enumerateIndirectObjects()
    .filter(([, o]) => o?.get?.(N('Type'))?.toString() === '/Annot').length;
}

function gevlakteStromen(pdfDoc) {
  const c = pdfDoc.getPage(0).node.lookup(N('Contents'));
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return refs.map((r) => pdfDoc.context.lookup(r)).filter((s) => s instanceof PDFStream && s.dict.get(N(BATCH_SLEUTEL)));
}

test('vlakken → opslaan → heropenen → terughalen → opslaan → heropenen', async () => {
  // Het geannoteerde bestand zoals de gebruiker het opent.
  const geannoteerd = await opslaan(await leegBlad(), markeringen());
  const open1 = await laad(geannoteerd);
  assert.equal(open1.modellen.length, 7, 'zeven markeringen na openen');

  // Vlakken.
  const v = await vlak(geannoteerd, open1.modellen);
  assert.equal(v.gebakkenIds.length, 6, `zes gebakken (zonder uiterlijk: ${v.zonderUiterlijk}, verborgen: ${v.verborgen})`);
  assert.equal(v.zonderUiterlijk, 1, 'de notitie heeft geen uiterlijk');
  assert.deepEqual(v.blijft.map((a) => a.type), ['comment'], 'alleen de notitie blijft in het model');
  const tussen = await PDFDocument.load(v.bytes);
  const tussenAnnots = tussen.getPage(0).node.lookup(N('Annots')).asArray().map((r) => tussen.context.lookup(r));
  assert.equal(tussenAnnots.length, 1);
  assert.equal(annotObjecten(tussen), 1, 'geen vervangen annotaties als ballast in het bestand');
  assert.equal(tussenAnnots[0].get(N('OPS_FlattenModelId')), undefined, 'geen tijdelijke sleutel in de bytes');

  // Ctrl+S na het vlakken: het model heeft alleen de notitie, de basis zijn de gevlakte bytes.
  const gevlaktOpgeslagen = await opslaan(v.bytes, v.blijft);
  const open2 = await laad(gevlaktOpgeslagen);
  assert.deepEqual(open2.modellen.map((m) => m.type), ['comment'], 'na heropenen alleen de notitie als markering');
  assert.equal(open2.pdfjsAnnots, 1, 'pdf.js ziet alleen de notitie');
  assert.ok(open2.formulieren >= 6, `pdf.js tekent de markeringen als pagina-inhoud (${open2.formulieren} Form XObjects)`);
  const lib2 = await PDFDocument.load(gevlaktOpgeslagen);
  assert.equal(gevlakteStromen(lib2).length, 1, 'één gevlakt blok');
  assert.ok(lib2.catalog.get(N(FLATTEN_SLEUTEL)), 'de herstelkopie overleeft een gewone save');

  // Terughalen, en weer opslaan met de teruggehaalde markeringen in het model.
  const lib3 = await PDFDocument.load(gevlaktOpgeslagen);
  const u = ontvlakDocument(lib3);
  ruimOnbereikbaarOp(lib3);
  assert.equal(u.verwijderd, 1);
  assert.equal(u.annotaties.length, 6);
  const terugBytes = await opslaan(new Uint8Array(await lib3.save()), voegTeruggehaaldToe(open2.modellen, u.annotaties));
  const open3 = await laad(terugBytes);
  assert.equal(open3.modellen.length, 7, 'alle zeven markeringen terug, geen dubbele');
  assert.deepEqual(sorteer(open3.modellen).map(kenmerken), sorteer(open1.modellen).map(kenmerken),
    'dezelfde eigenschappen als voor het vlakken');
  const lib4 = await PDFDocument.load(terugBytes);
  assert.equal(gevlakteStromen(lib4).length, 0, 'geen gevlakt blok meer');
  // Niet groter dan nodig: de gebakken appearances en de herstelkopie zijn weg.
  const stroomBytes = (d) => d.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFStream && !o.dict.get(N('Type'))?.toString().match(/XRef|ObjStm/))
    .reduce((n, [, o]) => n + o.getContentsSize(), 0);
  const voor = stroomBytes(await PDFDocument.load(geannoteerd));
  assert.ok(stroomBytes(lib3) <= voor * 1.05 + 64, `stroominhoud na terughalen ${stroomBytes(lib3)} bytes, vooraf ${voor}`);
  assert.equal(lib4.catalog.get(N(FLATTEN_SLEUTEL)), undefined, 'geen herstelkopie meer');

  // Nog eens opslaan verandert niets (geen groei van markeringen).
  const nogEens = await laad(await opslaan(terugBytes, open3.modellen));
  assert.equal(nogEens.modellen.length, 7);
});

test('zonder herstel: na heropenen gevlakt, en terughalen vindt geen kopie', async () => {
  const geannoteerd = await opslaan(await leegBlad(), markeringen());
  const open1 = await laad(geannoteerd);
  const v = await vlak(geannoteerd, open1.modellen, false);
  const opgeslagen = await opslaan(v.bytes, v.blijft);
  const lib = await PDFDocument.load(opgeslagen);
  assert.equal(lib.catalog.get(N(FLATTEN_SLEUTEL)), undefined);
  const u = ontvlakDocument(lib);
  assert.equal(u.snapshot, null);
  assert.equal(u.gevonden, 1);
  assert.equal((await laad(opgeslagen)).modellen.length, 1, 'alleen de notitie');
});

test('vlakken laat annotaties die de app niet beheert staan (koppeling)', async () => {
  const bron = await PDFDocument.load(await leegBlad());
  const ctx = bron.context;
  bron.getPage(0).node.set(N('Annots'), ctx.obj([ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 60, 30], Border: [0, 0, 0],
  }))]));
  const bytes = await bron.save();
  const v = await vlak(bytes, markeringen().slice(0, 1));
  assert.equal(v.gebakken, 1);
  const lib = await PDFDocument.load(v.bytes);
  const rest = lib.getPage(0).node.lookup(N('Annots')).asArray().map((r) => lib.context.lookup(r).get(N('Subtype')).toString());
  assert.deepEqual(rest, ['/Link']);
});

test('vlakbareAnnotaties: een vastgezet knipsel gaat niet in de herstelkopie', () => {
  const l = [{ id: 'a', type: 'box' }, { id: 'k', type: 'vectorSnippet', flattened: true },
    { id: 'g', type: 'vectorSnippet', gebakkenIn: 'x.pdf' }, { id: 'los', type: 'vectorSnippet' }];
  assert.deepEqual(vlakbareAnnotaties(l).map((a) => a.id), ['a', 'los']);
});

test('voegTeruggehaaldToe: een id dat al bestaat krijgt een nieuw id', () => {
  let n = 0;
  const uit = voegTeruggehaaldToe([{ id: 'a' }], [{ id: 'a', type: 'box' }, { id: 'b' }], () => `nieuw${++n}`);
  assert.deepEqual(uit.map((a) => a.id), ['a', 'nieuw1', 'b']);
});
