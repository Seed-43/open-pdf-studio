// Samenvoegen in de app (page-manager.js mergeFiles): de annotaties van de
// samengevoegde pagina's gaan het model in (het tekenen en de saver werken
// uit het model), de bladwijzers en paginalabels komen erbij, een geopend
// bronbestand telt zoals het in de app staat en het bronbestand op schijf
// blijft onaangeroerd. De app-modules eromheen zijn vervangen
// (page-manager-test-hooks.mjs); page-manager.js, samenvoegen.js, pdf-lib en
// pdf.js zijn echt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import { bronA, bronB, doel } from './samenvoegen.testhulp.mjs';

register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const SLEUTEL = 'C:/werk/doel.pdf';

async function opstelling({ bestanden = {}, geopend = [] } = {}) {
  const bytes = await doel();
  const cache = new Map([[SLEUTEL, bytes]]);
  const pdfDoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const doc = {
    id: 'doel', filePath: SLEUTEL, pdfDoc, currentPage: 1, pageRotations: {},
    annotations: [{ id: 'eigen', type: 'circle', page: 1, x: 10, y: 10, width: 20, height: 20 }],
    bookmarks: [{ id: 'bm_1', title: 'Doel', page: 1, parentId: null, sortOrder: 0 }],
    _loadedAnnotationPages: new Set([1]), _annotationPagesReady: new Set([1]),
  };
  const gelezen = [];
  const geschreven = [];
  const geladen = [];
  const momentopnamen = [];
  const undo = [];
  globalThis.window = { __TAURI__: {} };
  globalThis.__pmTest = {
    documents: [doc, ...geopend],
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => true,
      readBinaryFile: async (pad) => {
        gelezen.push(pad);
        if (!bestanden[pad]) throw new Error(`onbekend bestand ${pad}`);
        return bestanden[pad];
      },
      writeBinaryFile: async (pad) => { geschreven.push(pad); },
      getDocument: (o) => pdfjs.getDocument({ ...o, isEvalSupported: false, verbosity: 0 }),
      bouwMomentopname: async (d) => { momentopnamen.push(d.id); return d._momentopname; },
      // Wat de lader zou doen: hier alleen vastleggen welke pagina's hij kreeg
      // en ze als geladen markeren.
      laadAnnotatiesVoorPaginas: async (d, paginas) => {
        geladen.push([...paginas]);
        for (const p of paginas) {
          d._annotationPagesReady.add(p);
          d.annotations = [...d.annotations, { id: `uit-bytes-${p}`, type: 'box', page: p }];
        }
        return null;
      },
      markAllAnnotationPagesLoaded: (n, d) => {
        for (let i = 1; i <= n; i++) { d._loadedAnnotationPages.add(i); d._annotationPagesReady.add(i); }
      },
      cancelAnnotationLoading: (d) => { d._loadedAnnotationPages.clear(); d._annotationPagesReady.clear(); },
      recordPageStructure: (...a) => { undo.push(a); },
    },
  };
  return { doc, cache, gelezen, geschreven, geladen, momentopnamen, undo };
}

test('merged pages get their annotations loaded into the model, bookmarks and labels come along', async () => {
  const o = await opstelling({ bestanden: { 'C:/in/bronA.pdf': await bronA(), 'C:/in/bronB.pdf': await bronB() } });
  const verslag = await pm.mergeFiles(['C:/in/bronA.pdf', 'C:/in/bronB.pdf'], 'end');
  assert.deepEqual(verslag.merged, ['C:/in/bronA.pdf', 'C:/in/bronB.pdf']);
  assert.equal(verslag.pagesInserted, 3);
  assert.equal(o.doc.pdfDoc.numPages, 4);
  // Alleen de nieuwe pagina's worden geladen; pagina 1 stond al in het model.
  assert.deepEqual(o.geladen, [[2, 3, 4]]);
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['eigen', 1], ['uit-bytes-2', 2], ['uit-bytes-3', 3], ['uit-bytes-4', 4]]);
  // Ongedaan maken / opnieuw doen kent de geladen annotaties en de bladwijzers.
  const [stap] = o.undo;
  assert.equal(stap[5].length, 4, 'de stand na samenvoegen heeft alle annotaties');
  assert.deepEqual(stap[8].bookmarks.old.map((b) => b.title), ['Doel']);
  // Bladwijzers: die van het document en per bestand een groep.
  const boven = o.doc.bookmarks.filter((b) => !b.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(boven.map((b) => [b.title, b.page]), [['Doel', 1], ['bronA.pdf', 2], ['bronB.pdf', 4]]);
  const a = boven[1];
  assert.deepEqual(o.doc.bookmarks.filter((b) => b.parentId === a.id).map((b) => [b.title, b.page]), [['Hoofdstuk A', 2]]);
  // Paginalabels van de ingevoegde pagina's.
  assert.deepEqual(o.doc.pageLabels, ['1', 'A-1', 'i', '4']);
  assert.equal(o.doc.pageLabelsDirty, true);
  // Wat er meekwam, per bestand.
  assert.equal(verslag.carried.length, 2);
  assert.deepEqual(verslag.carried[1].hernoemdeVelden, [{ van: 'naam', naar: 'naam_bronB' }]);
  assert.equal(verslag.carried[1].handtekeningen, 1);
  // Niets naar de bronbestanden geschreven.
  assert.deepEqual(o.geschreven.filter((p) => /bron/i.test(p)), []);
  // Opnieuw doen zet de bladwijzers van na het samenvoegen terug.
  await pm.restorePageState(stap[0], stap[1], stap[2], stap[3], { bookmarks: stap[8].bookmarks.old });
  assert.deepEqual(o.doc.bookmarks.map((b) => b.title), ['Doel']);
  await pm.restorePageState(stap[4], stap[5], stap[6], stap[7], { bookmarks: stap[8].bookmarks.new });
  assert.equal(o.doc.bookmarks.filter((b) => !b.parentId).length, 3);
});

test('a source file that is open in the app is merged as the app has it, not as it is on disk', async () => {
  // Het geopende bronbestand: in de app heeft het een extra pagina (onopgeslagen).
  const opDisk = await bronA();
  const inApp = await PDFDocument.load(opDisk);
  inApp.addPage([300, 300]);
  const geopend = {
    id: 'bron-open', filePath: 'C:/tmp/opds-edit-9.pdf', saveTargetPath: 'C:\\In\\BronA.pdf',
    pdfDoc: {}, _momentopname: new Uint8Array(await inApp.save()),
  };
  const o = await opstelling({ bestanden: { 'c:/in/brona.pdf': opDisk }, geopend: [geopend] });
  const verslag = await pm.mergeFiles(['c:/in/brona.pdf'], 'end');
  assert.deepEqual(o.momentopnamen, ['bron-open']);
  assert.deepEqual(o.gelezen, [], 'het bestand op schijf is niet gelezen');
  assert.equal(verslag.pagesInserted, 3, 'de pagina die alleen in de app bestaat, is mee');
  assert.equal(verslag.carried[0].uitApp, true);
});

test('when the in-app state cannot be built, the file on disk is used', async () => {
  const geopend = { id: 'bron-open', saveTargetPath: 'C:/in/bronA.pdf', pdfDoc: {}, _momentopname: null };
  const o = await opstelling({ bestanden: { 'C:/in/bronA.pdf': await bronA() }, geopend: [geopend] });
  globalThis.__pmTest.impl.bouwMomentopname = async () => { throw new Error('beveiligd'); };
  const verslag = await pm.mergeFiles(['C:/in/bronA.pdf'], 'end');
  assert.deepEqual(o.gelezen, ['C:/in/bronA.pdf']);
  assert.equal(verslag.pagesInserted, 2);
});

test('inserting blank pages loads nothing that was already in the model', async () => {
  const o = await opstelling();
  await pm.insertBlankPages('end', 1, 1, 100, 100);
  // De lege pagina is nieuw en wordt geladen (er staat niets op); pagina 1 niet.
  assert.deepEqual(o.geladen, [[2]]);
});
