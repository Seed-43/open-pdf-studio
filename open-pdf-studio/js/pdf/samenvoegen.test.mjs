// Samenvoegen neemt alles mee wat bij de pagina's hoort, niet alleen de kale
// pagina's: annotaties (met appearance, beeld, popup en /IRT), formulier-
// velden, bladwijzers, koppelingen en benoemde bestemmingen, lagen,
// paginalabels, draaiing en paginavakken. En het overleeft opslaan en
// heropenen met de echte saver en lader.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFString, PDFHexString, PDFStream } from 'pdf-lib';
import { bronA, bronB, doel, annotatiesPerPagina } from './samenvoegen.testhulp.mjs';
import { opslaan, laadAlles, state } from './rondgang.testhulp.mjs';
import { voegPdfsSamen, telHandtekeningen, uniekeNaam, achtervoegselVoor } from './samenvoegen.js';
import { bladwijzersNaSamenvoegen, openDocumentVoorPad, padSleutel } from './samenvoegen-model.js';
import { loadBookmarksFromPdf } from './bladwijzers-lezen.js';
import { vulLabelsAan } from './pagina-labels.js';
import { voegGelezenLagenToe } from './saver/annotatie-lagen.js';
import { mergeAntwoord, nieuwMergeVerslag } from './merge-verslag.js';

const N = (s) => PDFName.of(s);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function laadPdfjs(bytes) {
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
}

/** Samenvoegen zoals de app het doet, met de bestandsnamen erbij. */
async function samenvoegen(doelBytes, bronnen, opties = {}) {
  const d = await PDFDocument.load(doelBytes);
  const geladen = [];
  for (const [naam, bytes] of bronnen) geladen.push({ doc: await PDFDocument.load(bytes), naam });
  const verslag = await voegPdfsSamen(d, geladen, { invoegIndex: d.getPageCount(), positie: 'end', ...opties });
  const bytes = new Uint8Array(await d.save({ updateFieldAppearances: false }));
  return { bytes, verslag };
}

/** Bladwijzers als [titel, paginaindex, diepte]. */
async function bladwijzers(pd) {
  const uit = [];
  const loop = async (items, diepte) => {
    for (const it of items || []) {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await pd.getDestination(dest);
      uit.push([it.title, dest ? await pd.getPageIndex(dest[0]) : null, diepte]);
      await loop(it.items, diepte + 1);
    }
  };
  await loop(await pd.getOutline(), 0);
  return uit;
}

const naamVan = (doc, ref) => {
  const t = doc.context.lookup(ref)?.get(N('T'));
  return t?.decodeText?.();
};

test('the merged pages keep every annotation, on the right page, pointing at that page', async () => {
  const { bytes } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const m = await PDFDocument.load(bytes);
  assert.deepEqual(annotatiesPerPagina(m), [
    ['Circle', 'Widget'],
    ['Square', 'Text', 'Popup', 'Text', 'FreeText', 'Ink', 'Link', 'Link', 'Widget'],
    ['Stamp'],
    ['Square', 'Link', 'Widget', 'Widget'],
  ]);
  const ctx = m.context;
  for (const pagina of m.getPages()) {
    const annots = pagina.node.lookup(N('Annots'))?.asArray() || [];
    for (const ref of annots) {
      const d = ctx.lookup(ref);
      const p = d.get(N('P'));
      if (p) assert.equal(p, pagina.ref, '/P wijst naar de pagina waar de annotatie op staat');
      // Popup en antwoord wijzen naar annotaties op dezelfde pagina.
      for (const sleutel of ['Popup', 'IRT', 'Parent']) {
        const r = d.get(N(sleutel));
        if (r instanceof PDFRef && ctx.lookup(r)?.get(N('Subtype'))?.toString() !== '/Widget' && sleutel !== 'Parent') {
          assert.ok(annots.includes(r), `${sleutel} wijst naar een annotatie op deze pagina`);
        }
      }
    }
  }
  // Notitie, popup en antwoord horen bij elkaar.
  const p2 = m.getPage(1).node.lookup(N('Annots')).asArray().map((r) => [r, ctx.lookup(r)]);
  const [notitieRef, notitie] = p2.find(([, d]) => d.get(N('NM'))?.decodeText() === 'a-notitie');
  const [popupRef, popup] = p2.find(([, d]) => d.get(N('Subtype')).toString() === '/Popup');
  const [, antwoord] = p2.find(([, d]) => d.get(N('NM'))?.decodeText() === 'a-antwoord');
  assert.equal(notitie.get(N('Popup')), popupRef);
  assert.equal(popup.get(N('Parent')), notitieRef);
  assert.equal(antwoord.get(N('IRT')), notitieRef);
  // De eigen sleutel en de appearance van de rechthoek.
  const [, vierkant] = p2.find(([, d]) => d.get(N('NM'))?.decodeText() === 'a-vierkant');
  assert.equal(vierkant.get(N('OPS_HatchPattern')).decodeText(), 'diagonal-left');
  assert.ok(ctx.lookup(vierkant.lookup(N('AP')).get(N('N'))) instanceof PDFStream);
  // De stempel houdt zijn beeld.
  const stempel = ctx.lookup(m.getPage(2).node.lookup(N('Annots')).get(0));
  const apStempel = ctx.lookup(stempel.lookup(N('AP')).get(N('N')));
  const beeld = ctx.lookup(apStempel.dict.lookup(N('Resources')).lookup(N('XObject')).get(N('Im0')));
  assert.equal(beeld.dict.get(N('Subtype')).toString(), '/Image');
});

test('links and named destinations go to the right page of the result; clashing names get a suffix', async () => {
  const { bytes, verslag } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const pd = await laadPdfjs(bytes);
  const naarPagina = async (dest) => {
    const d = typeof dest === 'string' ? await pd.getDestination(dest) : dest;
    return pd.getPageIndex(d[0]);
  };
  const links = [];
  for (let n = 1; n <= pd.numPages; n++) {
    for (const a of await (await pd.getPage(n)).getAnnotations()) {
      if (a.subtype === 'Link') links.push([n - 1, await naarPagina(a.dest)]);
    }
  }
  // A blad 1 (index 1) → A blad 2 (index 2), twee keer (direct en benoemd); B → B.
  assert.deepEqual(links, [[1, 2], [1, 2], [3, 3]]);
  const dests = await pd.getDestinations();
  assert.deepEqual([...(dests instanceof Map ? dests.keys() : Object.keys(dests))].sort(), ['kaart', 'kaart_bronB', 'start']);
  assert.equal(await naarPagina('start'), 1);
  assert.deepEqual(verslag.bronnen[1].hernoemdeBestemmingen, [{ van: 'kaart', naar: 'kaart_bronB' }]);
  await pd.loadingTask.destroy();
});

test('form fields are merged into one AcroForm, clashing names renamed per source file, signatures dropped', async () => {
  const { bytes, verslag } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const m = await PDFDocument.load(bytes);
  const af = m.catalog.lookup(N('AcroForm'));
  const namen = af.lookup(N('Fields')).asArray().map((r) => naamVan(m, r));
  assert.deepEqual(namen, ['naam', 'naam_bronA', 'naam_bronB', 'handtekening']);
  // Elk veld houdt zijn waarde en zijn uiterlijk.
  const velden = af.lookup(N('Fields')).asArray().map((r) => m.context.lookup(r));
  assert.deepEqual(velden.slice(0, 3).map((v) => v.get(N('V')).decodeText()), ['Doel', 'Bron A', 'Bron B']);
  for (const v of velden.slice(0, 3)) assert.ok(m.context.lookup(v.lookup(N('AP')).get(N('N'))) instanceof PDFStream);
  // De handtekening is weg, het veld blijft; het formulier zegt dat er
  // handtekeningvelden zijn, niet dat het document ondertekend is.
  assert.equal(velden[3].get(N('V')), undefined);
  assert.equal(af.get(N('SigFlags')).asNumber(), 1);
  assert.equal(telHandtekeningen(m), 0);
  assert.equal(verslag.bronnen[1].handtekeningen, 1);
  // pdf.js ziet de velden met hun nieuwe namen.
  const pd = await laadPdfjs(bytes);
  const fo = await pd.getFieldObjects();
  assert.deepEqual([...fo.keys()].sort(), ['handtekening', 'naam', 'naam_bronA', 'naam_bronB']);
  assert.equal(fo.get('naam_bronB')[0].value, 'Bron B');
  await pd.loadingTask.destroy();
});

test('bookmarks of each source go under one bookmark named after the file, at the right position', async () => {
  const bronnen = [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]];
  const { bytes: eind, verslag } = await samenvoegen(await doel(), bronnen);
  const pd = await laadPdfjs(eind);
  assert.deepEqual(await bladwijzers(pd), [
    ['Doel', 0, 0],
    ['bronA.pdf', 1, 0],
    ['Hoofdstuk A', 1, 1],
    ['Kaart A', 2, 2],
    ['bronB.pdf', 3, 0],
    ['Hoofdstuk B', 3, 1],
  ]);
  assert.deepEqual(verslag.bladwijzerGroepen, [1, 2]);
  await pd.loadingTask.destroy();

  const { bytes: begin } = await samenvoegen(await doel(), bronnen, { invoegIndex: 0, positie: 'start' });
  const pd2 = await laadPdfjs(begin);
  assert.deepEqual((await bladwijzers(pd2)).filter((b) => b[2] === 0), [['bronA.pdf', 0, 0], ['bronB.pdf', 2, 0], ['Doel', 3, 0]]);
  await pd2.loadingTask.destroy();
});

test('layers are merged: visibility kept, clashing names get the file name, order grouped per file', async () => {
  const { bytes } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const pd = await laadPdfjs(bytes);
  const oc = await pd.getOptionalContentConfig();
  const lagen = [...oc].map(([, g]) => [g.name, g.visible]);
  assert.deepEqual(lagen, [['Wanden', false], ['Wanden (bronB.pdf)', true]]);
  assert.deepEqual(oc.getOrder().map((g) => g.name), ['bronA.pdf', 'bronB.pdf']);
  await pd.loadingTask.destroy();
});

test('a layer of this app with the same id stays one layer', async () => {
  const maak = async (naam) => {
    const d = await PDFDocument.create();
    const p = d.addPage([200, 200]);
    const ocg = d.context.register(d.context.obj({ Type: 'OCG', Name: PDFString.of(naam), OPS_LayerId: PDFString.of('l-gedeeld') }));
    d.catalog.set(N('OCProperties'), d.context.obj({ OCGs: [ocg], D: { Order: [ocg] } }));
    d.catalog.set(N('OPS_AnnotLayers'), d.context.obj({ Layers: [ocg] }));
    const r = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], OC: ocg }));
    p.node.set(N('Annots'), d.context.obj([r]));
    return d.save();
  };
  const { bytes } = await samenvoegen(await maak('Constructie'), [['b.pdf', await maak('Constructie')]]);
  const m = await PDFDocument.load(bytes);
  const ocgs = m.catalog.lookup(N('OCProperties')).lookup(N('OCGs')).asArray();
  assert.equal(ocgs.length, 1);
  const oc2 = m.context.lookup(m.getPage(1).node.lookup(N('Annots')).get(0)).get(N('OC'));
  assert.equal(oc2, ocgs[0], 'de annotatie van de bron hangt aan dezelfde laag');
  assert.deepEqual(m.catalog.lookup(N('OPS_AnnotLayers')).lookup(N('Layers')).asArray(), ocgs);
});

test('page labels, rotation, crop box and user unit are kept', async () => {
  const { bytes } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const pd = await laadPdfjs(bytes);
  assert.deepEqual(await pd.getPageLabels(), ['1', 'A-1', 'i', '4']);
  await pd.loadingTask.destroy();
  const m = await PDFDocument.load(bytes);
  const p3 = m.getPage(2);
  assert.equal(p3.getRotation().angle, 90);
  assert.deepEqual(p3.node.lookup(N('CropBox')).asArray().map((n) => n.asNumber()), [10, 10, 585, 832]);
  assert.equal(p3.node.get(N('UserUnit')).asNumber(), 2);
  assert.deepEqual(m.getPage(3).getSize(), { width: 842, height: 595 });
});

test('a label range of the document that spans the insertion point continues after the inserted pages', async () => {
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) d.addPage([300, 300]);
  d.catalog.set(N('PageLabels'), d.context.obj({ Nums: [0, { S: 'D', P: PDFString.of('D-'), St: 1 }] }));
  const { bytes } = await samenvoegen(await d.save(), [['bronA.pdf', await bronA()]], { invoegIndex: 1, positie: 'after' });
  const pd = await laadPdfjs(bytes);
  assert.deepEqual(await pd.getPageLabels(), ['D-1', 'A-1', 'i', 'D-2', 'D-3']);
  await pd.loadingTask.destroy();
});

test('without page labels anywhere, none are written', async () => {
  const kaal = async () => { const d = await PDFDocument.create(); d.addPage([100, 100]); return d.save(); };
  const { bytes } = await samenvoegen(await kaal(), [['k.pdf', await kaal()]]);
  const m = await PDFDocument.load(bytes);
  assert.equal(m.catalog.get(N('PageLabels')), undefined);
});

test('a document whose named destinations sit in a tree with /Kids keeps them', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([100, 100]);
  const blad = d.context.register(d.context.obj({ Names: [PDFString.of('eigen'), [p.ref, N('Fit')]], Limits: [PDFString.of('eigen'), PDFString.of('eigen')] }));
  d.catalog.set(N('Names'), d.context.obj({ Dests: d.context.register(d.context.obj({ Kids: [blad] })) }));
  const { bytes } = await samenvoegen(await d.save(), [['bronA.pdf', await bronA()]]);
  const pd = await laadPdfjs(bytes);
  const dests = await pd.getDestinations();
  assert.deepEqual([...dests.keys()].sort(), ['eigen', 'kaart', 'start']);
  assert.equal(await pd.getPageIndex((await pd.getDestination('eigen'))[0]), 0);
  await pd.loadingTask.destroy();
});

test('names: a free name stays, a taken one gets the suffix of its file', () => {
  assert.equal(uniekeNaam('naam', new Set(), 'b'), 'naam');
  assert.equal(uniekeNaam('naam', new Set(['naam']), 'b'), 'naam_b');
  assert.equal(uniekeNaam('naam', new Set(['naam', 'naam_b']), 'b'), 'naam_b_2');
  assert.equal(achtervoegselVoor('Tekening 2.v3.pdf', 1), 'Tekening_2_v3');
  assert.equal(achtervoegselVoor('', 4), 'bron4');
});

test('telHandtekeningen counts set signatures only', async () => {
  assert.equal(telHandtekeningen(await PDFDocument.load(await bronB())), 1);
  assert.equal(telHandtekeningen(await PDFDocument.load(await bronB({ handtekening: false }))), 0);
  assert.equal(telHandtekeningen(await PDFDocument.load(await bronA())), 0);
});

// ── Met de echte saver en lader ─────────────────────────────────────────────

/** Opslaan zoals de app na het samenvoegen: alle pagina's geladen, bladwijzers uit het model. */
async function slaSamengevoegdOp(bytes, extraModellen = []) {
  const modellen = await laadAlles(bytes);
  const pd = await laadPdfjs(bytes);
  const bookmarks = await loadBookmarksFromPdf(pd);
  await pd.loadingTask.destroy();
  const paginas = new Set(Array.from({ length: modellen.aantalPaginas }, (_, i) => i + 1));
  return opslaan(bytes, [...modellen, ...extraModellen], {
    lagen: modellen.lagen,
    document: { _annotationPagesReady: paginas, bookmarks },
  });
}

/** Annotaties per pagina zoals pdf.js ze ziet, zonder popups (die horen bij hun ouder). */
async function soortenPerPagina(bytes) {
  const pd = await laadPdfjs(bytes);
  const uit = [];
  for (let n = 1; n <= pd.numPages; n++) {
    const annots = await (await pd.getPage(n)).getAnnotations();
    uit.push(annots.filter((a) => a.subtype !== 'Popup').map((a) => a.subtype).sort());
  }
  await pd.loadingTask.destroy();
  return uit;
}

test('merge → save → reopen: annotations, replies, fields, bookmarks, links, layers and labels are all still there', async () => {
  const { bytes } = await samenvoegen(await doel(), [['bronA.pdf', await bronA()], ['bronB.pdf', await bronB()]]);
  const voor = await soortenPerPagina(bytes);
  const opgeslagen = await slaSamengevoegdOp(bytes);
  assert.deepEqual(await soortenPerPagina(opgeslagen), voor);

  // Het antwoord wijst na heropenen nog naar de notitie.
  const modellen = await laadAlles(opgeslagen);
  const notitie = modellen.find((m) => m.page === 2 && m.type === 'comment' && m.text === 'vraag');
  const antwoord = modellen.find((m) => m.page === 2 && m.type === 'comment' && m.text === 'antwoord');
  assert.ok(notitie && antwoord, 'notitie en antwoord staan er nog');
  assert.equal(antwoord.inReplyTo, notitie.id);
  // Het tekstvak en de inkt van bron A.
  assert.ok(modellen.some((m) => m.page === 2 && m.type === 'textbox'));
  assert.ok(modellen.some((m) => m.page === 2 && m.type === 'draw'));
  // De eigen arcering van de rechthoek uit bron A.
  assert.ok(modellen.some((m) => m.page === 2 && m.hatchPattern === 'diagonal-left'));
  // Een stempel met beeld.
  assert.ok(modellen.some((m) => m.page === 3 && m.type === 'stamp'));

  const pd = await laadPdfjs(opgeslagen);
  assert.deepEqual((await bladwijzers(pd)).map((b) => [b[0], b[1]]), [
    ['Doel', 0], ['bronA.pdf', 1], ['Hoofdstuk A', 1], ['Kaart A', 2], ['bronB.pdf', 3], ['Hoofdstuk B', 3],
  ]);
  const fo = await pd.getFieldObjects();
  assert.deepEqual([...fo.keys()].sort(), ['handtekening', 'naam', 'naam_bronA', 'naam_bronB']);
  assert.deepEqual(await pd.getPageLabels(), ['1', 'A-1', 'i', '4']);
  const oc = await pd.getOptionalContentConfig();
  assert.deepEqual([...oc].map(([, g]) => [g.name, g.visible]), [['Wanden', false], ['Wanden (bronB.pdf)', true]]);
  const links = [];
  for (let n = 1; n <= pd.numPages; n++) {
    for (const a of await (await pd.getPage(n)).getAnnotations()) {
      if (a.subtype !== 'Link') continue;
      const d = typeof a.dest === 'string' ? await pd.getDestination(a.dest) : a.dest;
      links.push([n - 1, await pd.getPageIndex(d[0])]);
    }
  }
  assert.deepEqual(links, [[1, 2], [1, 2], [3, 3]]);
  assert.equal((await pd.getPage(3)).rotate, 90);
  await pd.loadingTask.destroy();
});

test('an open document with unsaved annotations is merged as it is in the app, its file untouched', async () => {
  const bestand = await bronA();
  const ongewijzigd = bestand.slice();
  // Het geopende document: de annotaties uit het bestand plus een nieuwe,
  // nog niet opgeslagen rechthoek op blad 2.
  const modellen = await laadAlles(bestand);
  const nieuw = {
    id: 'onopgeslagen', type: 'box', page: 2, x: 120, y: 140, width: 90, height: 60,
    color: '#ff00ff', strokeColor: '#ff00ff', fillColor: null, lineWidth: 2, opacity: 1, rotation: 0,
    borderStyle: 'solid', author: 'Tester', text: 'nog niet opgeslagen',
  };
  const openDoc = {
    id: 'open', filePath: 'C:/tmp/opds-edit-1.pdf', saveTargetPath: 'C:/Projecten/BronA.pdf', isUntitled: false,
    pdfDoc: {}, annotations: [...modellen, nieuw], pageRotations: {},
    _annotationPagesReady: new Set([1, 2]), textEdits: [], bookmarks: [],
  };
  // Het samenvoegen herkent het bestand als geopend document, ook met
  // andere schrijfwijze van het pad.
  assert.equal(openDocumentVoorPad([{ id: 'x', filePath: 'C:/a.pdf', pdfDoc: {} }, openDoc], 'c:\\projecten\\brona.pdf'), openDoc);
  assert.equal(openDocumentVoorPad([openDoc], 'C:/tmp/opds-edit-1.pdf'), null, 'de werkkopie is niet het bestand');
  assert.equal(padSleutel('C:\\A\\b.PDF'), 'c:/a/b.pdf');

  // De momentopname van de saver: wat opslaan zou schrijven, zonder schrijven.
  let geschreven = 0;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bestand,
      writeBinaryFile: () => { geschreven++; return true; },
      writeBinaryFileAtomic: () => { geschreven++; return true; },
    },
  };
  state.documents = [openDoc];
  state.activeDocumentIndex = 0;
  const { bouwMomentopname } = await import('./saver.js');
  const momentopname = await bouwMomentopname(openDoc);
  assert.equal(geschreven, 0, 'er is niets weggeschreven');
  assert.deepEqual(bestand, ongewijzigd, 'het bronbestand is niet veranderd');

  const { bytes } = await samenvoegen(await doel(), [['BronA.pdf', momentopname]]);
  const samen = await laadAlles(bytes);
  const terug = samen.find((m) => m.page === 3 && m.type === 'box' && m.color === '#ff00ff');
  assert.ok(terug, 'de onopgeslagen rechthoek staat in het resultaat, op blad 3');
  // Na opslaan en heropenen nog steeds.
  const opgeslagen = await slaSamengevoegdOp(bytes);
  assert.ok((await laadAlles(opgeslagen)).some((m) => m.page === 3 && m.type === 'box' && m.color === '#ff00ff'));
});

// ── Het model van de app ────────────────────────────────────────────────────

test('bookmarks after merging: own ones move with their page, each file gets its group at the insertion point', () => {
  const model = [
    { id: 'bm_1', title: 'Een', page: 1, parentId: null, sortOrder: 0 },
    { id: 'bm_2', title: 'Twee', page: 2, parentId: null, sortOrder: 1 },
    { id: 'bm_3', title: 'Onder twee', page: 2, parentId: 'bm_2', sortOrder: 0 },
  ];
  // Wat uit de samengevoegde bytes komt (ids van de lezer, botsen met het model).
  const uitBytes = [
    { id: 'bm_1', title: 'Een', page: 1, parentId: null, sortOrder: 0 },
    { id: 'bm_2', title: 'b.pdf', page: 2, parentId: null, sortOrder: 1 },
    { id: 'bm_3', title: 'Hoofdstuk', page: 3, parentId: 'bm_2', sortOrder: 0 },
    { id: 'bm_4', title: 'Twee', page: 4, parentId: null, sortOrder: 2 },
  ];
  const pageMapping = { 1: 1, 2: 4 };
  const uit = bladwijzersNaSamenvoegen(model, uitBytes, {
    groepIndexen: [1], pageMapping, invoegIndex: 1, positie: 'after', idVoorvoegsel: 'm_',
  });
  const boven = uit.filter((b) => !b.parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((b) => [b.title, b.page]);
  assert.deepEqual(boven, [['Een', 1], ['b.pdf', 2], ['Twee', 4]]);
  assert.equal(uit.find((b) => b.id === 'bm_3').page, 4, 'een eigen bladwijzer verhuist mee met zijn pagina');
  const groep = uit.find((b) => b.title === 'b.pdf');
  assert.equal(groep.id, 'm_1');
  assert.deepEqual(uit.filter((b) => b.parentId === groep.id).map((b) => [b.title, b.page]), [['Hoofdstuk', 3]]);
  assert.equal(new Set(uit.map((b) => b.id)).size, uit.length, 'geen dubbele ids');

  const eind = bladwijzersNaSamenvoegen(model, uitBytes, { groepIndexen: [1], pageMapping: { 1: 1, 2: 2 }, invoegIndex: 2, positie: 'end' });
  assert.deepEqual(eind.filter((b) => !b.parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((b) => b.title), ['Een', 'Twee', 'b.pdf']);
  const begin = bladwijzersNaSamenvoegen(model, uitBytes, { groepIndexen: [1], pageMapping: { 1: 2, 2: 3 }, invoegIndex: 0, positie: 'start' });
  assert.deepEqual(begin.filter((b) => !b.parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((b) => b.title), ['b.pdf', 'Een', 'Twee']);
});

test('page labels of inserted pages fill in around the existing labels', () => {
  assert.deepEqual(vulLabelsAan(null, new Map([[2, 'A-1'], [3, 'i']]), 4), ['1', 'A-1', 'i', '4']);
  assert.deepEqual(vulLabelsAan(['x', 'y'], new Map(), 2), ['x', 'y']);
  assert.equal(vulLabelsAan(null, new Map([[2, '2']]), 3), null, 'gewone nummers blijven null');
  assert.deepEqual(vulLabelsAan(['D-1', '', '', 'D-2'], new Map([[2, 'A-1'], [3, 'A-2']]), 4), ['D-1', 'A-1', 'A-2', 'D-2']);
});

test('annotation layers read from merged pages are added to the model, known ones stay as they were', () => {
  const doc = { annotationLayers: [{ id: 'default', name: '' }, { id: 'l1', name: 'Mijn laag', visible: false }] };
  const veranderd = voegGelezenLagenToe(doc, {
    lagen: [{ id: 'l1', name: 'Anders', visible: true }, { id: 'l2', name: 'Uit bron', visible: true }],
    ocgIds: ['12R'],
  });
  assert.equal(veranderd, true);
  assert.deepEqual(doc.annotationLayers.map((l) => [l.id, l.name, l.visible]), [
    ['default', '', true], ['l1', 'Mijn laag', false], ['l2', 'Uit bron', true],
  ]);
  assert.ok(doc._annotatieLaagOcgIds.has('12R'));
  assert.equal(voegGelezenLagenToe(doc, null), false);
});

test('the MCP answer says what came along per file, including dropped signatures', () => {
  const verslag = nieuwMergeVerslag();
  verslag.merged.push('C:/t/b.pdf');
  verslag.pagesInserted = 1;
  verslag.carried = [{
    naam: 'b.pdf', pad: 'C:/t/b.pdf', aantal: 1, annotaties: 3, velden: 2,
    hernoemdeVelden: [{ van: 'naam', naar: 'naam_b' }], bestemmingen: 1, hernoemdeBestemmingen: [],
    bladwijzers: 1, lagen: 1, handtekeningen: 1, uitApp: true,
  }];
  const antwoord = mergeAntwoord(verslag, { filePaths: ['C:/t/b.pdf'], position: 'end', pagesBefore: 1, pagesAfter: 2 });
  assert.equal(antwoord.ok, true);
  assert.deepEqual(antwoord.carried, [{
    file: 'C:/t/b.pdf', pages: 1, annotations: 3, fields: 2, renamedFields: [{ from: 'naam', to: 'naam_b' }],
    namedDestinations: 1, renamedDestinations: [], bookmarks: 1, layers: 1, signaturesRemoved: 1, fromOpenDocument: true,
  }]);
});

test('pages before the first label range keep their empty label', async () => {
  const d = await PDFDocument.create();
  for (let i = 0; i < 2; i++) d.addPage([300, 300]);
  d.catalog.set(N('PageLabels'), d.context.obj({ Nums: [1, { P: PDFString.of('Blad ') , S: 'D' }] }));
  const voor = await laadPdfjs(await d.save());
  const verwacht = await voor.getPageLabels();
  await voor.loadingTask.destroy();
  const { bytes } = await samenvoegen(await doel(), [['b.pdf', await d.save()]]);
  const pd = await laadPdfjs(bytes);
  assert.deepEqual((await pd.getPageLabels()).slice(1), verwacht);
  await pd.loadingTask.destroy();
});
