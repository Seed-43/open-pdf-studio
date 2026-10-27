// Alles vlakken / alles terughalen (#615): de byte-omzetting zelf, zonder app.
//
// - Vlakken zet de appearance van elke markering in de pagina-inhoud (een
//   gemarkeerd blok met een eigen partij-kenmerk) en haalt de markering uit
//   /Annots. Formuliervelden, koppelingen en markeringen zonder /AP blijven
//   niet als beeld achter; formuliervelden blijven gewoon staan.
// - Met herstel gaat er een verliesvrije kopie van het model mee in de
//   catalogus; terughalen haalt alleen de blokken van die partijen weg.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFStream, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import {
  FLATTEN_SLEUTEL, BATCH_SLEUTEL, FLATTEN_TAG, KNIPSEL_SLEUTELS, MODEL_ID_SLEUTEL,
  vlakDocument, ontvlakDocument, flattenBytes, unflattenBytes, bakMatrix,
  leesFlattenSnapshot, flattenKnipselSleutels, snapshotJson,
} from './flatten-bytes.js';

const N = (s) => PDFName.of(s);

/** Een appearance zoals saver/vector-ap.js hem schrijft: BBox = Rect, Matrix verschuift terug. */
function apStroom(ctx, rect, inhoud = '1 0 0 RG 2 w 0 0 m 50 50 l S') {
  const [x1, y1, x2, y2] = rect;
  return ctx.register(ctx.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2], Matrix: [1, 0, 0, 1, -x1, -y1],
  }));
}

function markering(ctx, { subtype = 'Square', rect = [100, 600, 200, 700], ap = true, extra = {} } = {}) {
  const d = ctx.obj({ Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, ...extra });
  if (ap) d.set(N('AP'), ctx.obj({ N: apStroom(ctx, rect) }));
  return ctx.register(d);
}

/** Een blad met een rechthoek, en optioneel een formulierveld en een koppeling. */
async function blad({ veld = false, link = false, zonderAp = false, verborgen = false } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  pagina.drawText('Inhoud', { x: 50, y: 800, size: 12 });
  const ctx = doc.context;
  const annots = [markering(ctx)];
  if (zonderAp) annots.push(markering(ctx, { subtype: 'Text', rect: [300, 300, 320, 320], ap: false }));
  if (verborgen) annots.push(markering(ctx, { rect: [10, 10, 20, 20], extra: { F: 2 } }));
  if (link) annots.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] })));
  if (veld) {
    annots.push(ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of('naam'), Rect: [50, 50, 200, 70],
      AP: ctx.obj({ N: apStroom(ctx, [50, 50, 200, 70], 'BT ET') }),
    })));
  }
  pagina.node.set(N('Annots'), ctx.obj(annots));
  return doc;
}

const MODEL = [{ id: 'a1', type: 'box', page: 1, x: 100, y: 142, width: 100, height: 100, color: '#ff0000', author: 'Tester' }];

function annotsVan(doc, i = 0) {
  const a = doc.getPage(i).node.lookup(N('Annots'));
  return a instanceof PDFArray ? a.asArray().map((r) => doc.context.lookup(r)) : [];
}

function inhoudStromen(doc, i = 0) {
  const c = doc.getPage(i).node.lookup(N('Contents'));
  const refs = c instanceof PDFArray ? c.asArray() : [c];
  return refs.map((r) => doc.context.lookup(r)).filter((s) => s instanceof PDFStream);
}

const tekst = (s) => new TextDecoder().decode(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getUnencodedContents());
const gevlakteStromen = (doc, i = 0) => inhoudStromen(doc, i).filter((s) => s.dict.get(N(BATCH_SLEUTEL)));

test('bakMatrix: de appearance-ruimte op de Rect (PDF 32000 12.5.5)', () => {
  // BBox = Rect, Matrix schuift terug: alleen weer verschuiven.
  assert.deepEqual(bakMatrix([100, 600, 200, 700], [1, 0, 0, 1, -100, -600], [100, 600, 200, 700]), [1, 0, 0, 1, 100, 600]);
  // BBox vanaf 0 en een twee keer zo grote Rect: schalen.
  assert.deepEqual(bakMatrix([0, 0, 50, 25], null, [10, 20, 110, 70]), [2, 0, 0, 2, 10, 20]);
  // Een gedraaide /Matrix: de omhullende van de getransformeerde BBox past op de Rect.
  const m = bakMatrix([0, 0, 40, 20], [0, 1, -1, 0, 0, 0], [0, 0, 20, 40]);
  assert.deepEqual(m.map((v) => Math.round(v * 1000) / 1000), [1, 0, 0, 1, 20, 0]);
});

test('vlakken: de markering in de inhoud, uit /Annots, met een herstelkopie', async () => {
  const doc = await blad();
  const r = vlakDocument(doc, { annotaties: MODEL, batchId: 'B1' });
  assert.equal(r.gebakken, 1);
  assert.equal(annotsVan(doc).length, 0, 'geen annotaties meer');
  const [stroom, ...meer] = gevlakteStromen(doc);
  assert.equal(meer.length, 0, 'één gevlakt blok');
  assert.equal(stroom.dict.get(N(BATCH_SLEUTEL)).decodeText(), 'B1');
  const ops = tekst(stroom);
  assert.match(ops, new RegExp(`/${FLATTEN_TAG} BMC`));
  assert.match(ops, /q 1 0 0 1 100 600 cm \/OPSFlat[-\w]* Do Q/);
  assert.match(ops, /EMC\s*$/);
  // Het XObject staat in de resources van de pagina.
  const naam = ops.match(/\/(OPSFlat[-\w]*) Do/)[1];
  assert.ok(doc.getPage(0).node.normalizedEntries().XObject.get(N(naam)), 'XObject geregistreerd');
  const snap = leesFlattenSnapshot(doc);
  assert.equal(snap.batches.length, 1);
  assert.equal(snap.batches[0].id, 'B1');
  assert.deepEqual(snap.batches[0].annotations, MODEL);
});

test('de gevlakte inhoud overleeft opslaan en heropenen, en terughalen geeft het model terug', async () => {
  const doc = await blad();
  const { bytes, gebakken } = await flattenBytes(await doc.save(), { annotaties: MODEL });
  assert.equal(gebakken, 1);
  const terug = await PDFDocument.load(bytes);
  assert.equal(annotsVan(terug).length, 0);
  assert.equal(gevlakteStromen(terug).length, 1);
  assert.ok(terug.catalog.get(N(FLATTEN_SLEUTEL)), 'herstelkopie in de catalogus');

  const u = await unflattenBytes(bytes);
  assert.equal(u.verwijderd, 1);
  assert.equal(u.gevonden, 1);
  assert.deepEqual(u.annotaties, MODEL);
  const schoon = await PDFDocument.load(u.bytes);
  assert.equal(gevlakteStromen(schoon).length, 0, 'geen gevlakt blok meer');
  assert.equal(schoon.catalog.get(N(FLATTEN_SLEUTEL)), undefined, 'geen herstelkopie meer');
  assert.match(tekst(inhoudStromen(schoon).find((s) => /Tj/.test(tekst(s)))), /Tj/, 'de eigen inhoud blijft');
  // Het XObject is ook uit de resources (en het bestand) weg.
  const xo = schoon.getPage(0).node.normalizedEntries().XObject;
  assert.equal(xo.keys().filter((k) => k.asString().startsWith('/OPSFlat')).length, 0);
});

test('zonder herstel: wel gebakken, geen kopie, en terughalen zegt dat het niet kan', async () => {
  const doc = await blad();
  const { bytes, gebakken } = await flattenBytes(await doc.save(), { annotaties: MODEL, herstelbaar: false });
  assert.equal(gebakken, 1);
  const terug = await PDFDocument.load(bytes);
  assert.equal(terug.catalog.get(N(FLATTEN_SLEUTEL)), undefined, 'geen herstelkopie');
  const u = await unflattenBytes(bytes);
  assert.equal(u.snapshot, null);
  assert.equal(u.gevonden, 1, 'wel gevlakt');
  assert.equal(u.verwijderd, 0, 'niets weggehaald');
  assert.equal(gevlakteStromen(await PDFDocument.load(u.bytes)).length, 1, 'het blok blijft');
});

test('nooit gevlakt: niets gevonden en niets veranderd', async () => {
  const doc = await blad();
  const u = await unflattenBytes(await doc.save());
  assert.equal(u.snapshot, null);
  assert.equal(u.gevonden, 0);
  assert.equal(u.verwijderd, 0);
  assert.deepEqual(u.annotaties, []);
});

test('twee keer vlakken: twee partijen, terughalen haalt ze allebei terug', async () => {
  const doc = await blad();
  const b1 = await flattenBytes(await doc.save(), { annotaties: MODEL, batchId: 'B1' });
  // Nieuwe markering na de eerste keer vlakken.
  const tussen = await PDFDocument.load(b1.bytes);
  tussen.getPage(0).node.set(N('Annots'), tussen.context.obj([markering(tussen.context, { rect: [300, 100, 350, 150] })]));
  const tweede = [{ id: 'a2', type: 'circle', page: 1, x: 300, y: 692, width: 50, height: 50 }];
  const b2 = await flattenBytes(await tussen.save(), { annotaties: tweede, batchId: 'B2' });
  const snap = leesFlattenSnapshot(await PDFDocument.load(b2.bytes));
  assert.deepEqual(snap.batches.map((b) => b.id), ['B1', 'B2'], 'de eerste partij blijft herstelbaar');
  const u = await unflattenBytes(b2.bytes);
  assert.equal(u.verwijderd, 2);
  assert.deepEqual(u.annotaties.map((a) => a.id).sort(), ['a1', 'a2']);
});

test('onherstelbaar en daarna herstelbaar: terughalen laat het onherstelbare blok staan', async () => {
  const doc = await blad();
  const b1 = await flattenBytes(await doc.save(), { annotaties: MODEL, batchId: 'VAST', herstelbaar: false });
  const tussen = await PDFDocument.load(b1.bytes);
  tussen.getPage(0).node.set(N('Annots'), tussen.context.obj([markering(tussen.context, { rect: [300, 100, 350, 150] })]));
  const tweede = [{ id: 'a2', type: 'circle', page: 1, x: 300, y: 692, width: 50, height: 50 }];
  const b2 = await flattenBytes(await tussen.save(), { annotaties: tweede, batchId: 'LOS' });
  const u = await unflattenBytes(b2.bytes);
  assert.equal(u.verwijderd, 1);
  assert.deepEqual(u.annotaties.map((a) => a.id), ['a2']);
  const blijft = gevlakteStromen(await PDFDocument.load(u.bytes));
  assert.deepEqual(blijft.map((s) => s.dict.get(N(BATCH_SLEUTEL)).decodeText()), ['VAST']);
});

test('formuliervelden, koppelingen, markeringen zonder /AP en verborgen markeringen blijven annotatie', async () => {
  const doc = await blad({ veld: true, link: true, zonderAp: true, verborgen: true });
  const r = vlakDocument(doc, { annotaties: MODEL, batchId: 'B1' });
  assert.equal(r.gebakken, 1);
  assert.equal(r.zonderUiterlijk, 1);
  assert.equal(r.verborgen, 1);
  const rest = annotsVan(doc).map((d) => d.get(N('Subtype')).toString()).sort();
  assert.deepEqual(rest, ['/Link', '/Square', '/Text', '/Widget']);
});

test('met model-ids: alleen de gebakken markeringen in de herstelkopie, en de sleutel verdwijnt', async () => {
  const doc = await blad({ zonderAp: true });
  const [vak, notitie] = doc.getPage(0).node.lookup(N('Annots')).asArray().map((r) => doc.context.lookup(r));
  vak.set(N(MODEL_ID_SLEUTEL), PDFString.of('a1'));
  notitie.set(N(MODEL_ID_SLEUTEL), PDFString.of('n1'));
  const model = [...MODEL, { id: 'n1', type: 'comment', page: 1, x: 300, y: 522 }];
  const r = vlakDocument(doc, { annotaties: model, batchId: 'B1' });
  assert.deepEqual(r.gebakkenIds, ['a1']);
  assert.deepEqual(leesFlattenSnapshot(doc).batches[0].annotations.map((a) => a.id), ['a1']);
  assert.equal(notitie.get(N(MODEL_ID_SLEUTEL)), undefined, 'de tijdelijke sleutel is weg');
});

test('antwoord en review-status van een gebakken markering gaan mee; een aanhaallijn wordt mee gebakken', async () => {
  const doc = await blad();
  const ctx = doc.context;
  const lijst = doc.getPage(0).node.lookup(N('Annots'));
  const ouder = lijst.get(0);
  lijst.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 1, 1], F: 30, IRT: ouder })));
  const leider = markering(ctx, { subtype: 'PolyLine', rect: [200, 650, 260, 700], extra: { IRT: ouder } });
  lijst.push(leider);
  const r = vlakDocument(doc, { annotaties: MODEL, batchId: 'B1' });
  assert.equal(r.gebakken, 2, 'vak en aanhaallijn');
  assert.equal(r.verborgen, 0, 'de review-status telt niet als achtergebleven');
  assert.equal(annotsVan(doc).length, 0);
});

test('alleen de aangewezen markeringen: andere annotaties blijven onaangeroerd', async () => {
  const doc = await blad();
  const ctx = doc.context;
  const eigen = markering(ctx, { rect: [300, 300, 350, 350] });
  const lijst = doc.getPage(0).node.lookup(N('Annots'));
  lijst.push(eigen);
  const r = vlakDocument(doc, { annotaties: MODEL, batchId: 'B1', isTeVlakken: (ref) => ref === eigen });
  assert.equal(r.gebakken, 1);
  assert.equal(annotsVan(doc).length, 1, 'de niet aangewezen rechthoek blijft annotatie');
});

test('een pop-up van een gevlakte markering verdwijnt mee', async () => {
  const doc = await blad();
  const ctx = doc.context;
  const lijst = doc.getPage(0).node.lookup(N('Annots'));
  const ouder = lijst.get(0);
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 1, 1], Parent: ouder }));
  ctx.lookup(ouder).set(N('Popup'), popup);
  lijst.push(popup);
  vlakDocument(doc, { annotaties: MODEL, batchId: 'B1' });
  assert.equal(annotsVan(doc).length, 0);
});

test('een markering op een laag houdt haar laag in de inhoud (/OC BDC)', async () => {
  const doc = await blad();
  const ctx = doc.context;
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Laag') }));
  const ann = ctx.lookup(doc.getPage(0).node.lookup(N('Annots')).get(0));
  ann.set(N('OC'), ocg);
  vlakDocument(doc, { annotaties: MODEL, batchId: 'B1' });
  const ops = tekst(gevlakteStromen(doc)[0]);
  const m = ops.match(/\/OC \/(\w+) BDC/);
  assert.ok(m, 'in een /OC-blok');
  const props = doc.getPage(0).node.normalizedEntries().Resources.lookup(N('Properties'), PDFDict);
  assert.equal(props.get(N(m[1])), ocg);
});

test('een appearance met toestanden: de toestand van /AS wordt gebakken', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([200, 200]);
  const ctx = doc.context;
  const aan = apStroom(ctx, [10, 10, 30, 30]);
  const d = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 30, 30], AS: 'Aan',
    AP: ctx.obj({ N: ctx.obj({ Aan: aan, Uit: apStroom(ctx, [10, 10, 30, 30], '') }) }),
  }));
  pagina.node.set(N('Annots'), ctx.obj([d]));
  const r = vlakDocument(doc, { annotaties: [], batchId: 'B1', herstelbaar: false });
  assert.equal(r.gebakken, 1);
});

test('pagina verschoven na het vlakken: de markeringen gaan terug naar de pagina van hun blok', async () => {
  const doc = await blad();
  const { bytes } = await flattenBytes(await doc.save(), { annotaties: MODEL, batchId: 'B1' });
  const verschoven = await PDFDocument.load(bytes);
  verschoven.insertPage(0, [595, 842]);
  const u = await unflattenBytes(await verschoven.save());
  assert.equal(u.annotaties[0].page, 2);
});

test('knipselsleutels van de herstelkopie, zodat hun bron niet wordt opgeruimd', async () => {
  const doc = await blad();
  vlakDocument(doc, {
    annotaties: [...MODEL, { id: 'k1', type: 'vectorSnippet', page: 1, snippetKey: 'abcdef0123456789' }],
    batchId: 'B1',
  });
  assert.deepEqual([...flattenKnipselSleutels(doc)], ['abcdef0123456789']);
  const stroom = doc.context.lookup(doc.catalog.get(N(FLATTEN_SLEUTEL)));
  assert.ok(stroom.dict.get(N(KNIPSEL_SLEUTELS)));
  const leeg = await blad();
  assert.equal(flattenKnipselSleutels(leeg).size, 0);
});

test('snapshotJson: functies en schermobjecten gaan niet mee, de rest wel', () => {
  const json = snapshotJson({ batches: [{ id: 'B', annotations: [{ id: 'x', f: () => 1, _cachedImg: { nodeType: 1 }, tekst: 'ë€' }] }] });
  const terug = JSON.parse(json);
  assert.deepEqual(terug.batches[0].annotations[0], { id: 'x', tekst: 'ë€' });
});

test('niet-ASCII-tekst in het model komt ongeschonden terug', async () => {
  const doc = await blad();
  const model = [{ ...MODEL[0], subject: 'Opmerking — ëéü 中文' }];
  const { bytes } = await flattenBytes(await doc.save(), { annotaties: model });
  const u = await unflattenBytes(bytes);
  assert.equal(u.annotaties[0].subject, 'Opmerking — ëéü 中文');
});
