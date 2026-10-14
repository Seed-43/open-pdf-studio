import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

// Paginalabels (#580) en paginabewerkingen: een naam verhuist mee met zijn
// pagina, en ongedaan maken / opnieuw doen zetten de labels van die stand
// terug. De app-modules eromheen zijn vervangen (page-manager-test-hooks.mjs);
// page-manager.js, pagina-labels(-app).js en pdf-lib zijn echt.
register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');

const SLEUTEL = 'geheugen/bladen.pdf';

async function bytesMet(aantal) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) doc.addPage([200, 200]);
  return new Uint8Array(await doc.save());
}

async function opstelling(aantal, labels, { dirty = true } = {}) {
  const bytes = await bytesMet(aantal);
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: 'doc-labels',
    filePath: SLEUTEL,
    pdfDoc: { numPages: aantal, destroy() {} },
    annotations: [],
    pageRotations: {},
    currentPage: 1,
    pageLabels: labels,
    pageLabelsDirty: dirty,
  };
  const undo = [];
  globalThis.window = { __TAURI__: {} };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => false,
      getDocument: ({ data }) => ({
        promise: PDFDocument.load(data).then((d) => ({ numPages: d.getPageCount(), destroy() {} })),
      }),
      recordPageStructure: (...a) => { undo.push(a); },
    },
  };
  return { doc, undo };
}

const ongedaan = (stap) => pm.restorePageState(stap[0], stap[1], stap[2], stap[3]);
const opnieuw = (stap) => pm.restorePageState(stap[4], stap[5], stap[6], stap[7]);

test('verwijderen: de namen schuiven mee, ongedaan maken en opnieuw doen zetten ze terug', async () => {
  const o = await opstelling(4, ['Cover', 'S-101', 'S-102', 'S-103']);
  await pm.deletePages([2]);
  assert.deepEqual(o.doc.pageLabels, ['Cover', 'S-102', 'S-103']);
  assert.equal(o.doc.pageLabelsDirty, true, 'de bytes dragen de oude labels: opnieuw schrijven bij opslaan');
  await ongedaan(o.undo[0]);
  assert.deepEqual(o.doc.pageLabels, ['Cover', 'S-101', 'S-102', 'S-103']);
  await opnieuw(o.undo[0]);
  assert.deepEqual(o.doc.pageLabels, ['Cover', 'S-102', 'S-103']);
});

test('verplaatsen: elke naam blijft bij zijn pagina, ook na ongedaan maken', async () => {
  const o = await opstelling(3, ['A-1', 'A-2', 'A-3']);
  await pm.reorderPages([3, 1, 2]);
  assert.deepEqual(o.doc.pageLabels, ['A-3', 'A-1', 'A-2']);
  await ongedaan(o.undo[0]);
  assert.deepEqual(o.doc.pageLabels, ['A-1', 'A-2', 'A-3']);
});

test('lege pagina invoegen: de nieuwe pagina krijgt haar nummer', async () => {
  const o = await opstelling(2, ['Cover', 'S-101']);
  await pm.insertBlankPages('after', 1, 1, 100, 100);
  assert.deepEqual(o.doc.pageLabels, ['Cover', '2', 'S-101']);
});

test('zonder labels blijft alles bij paginanummers en wordt niets bewerkt', async () => {
  const o = await opstelling(3, null, { dirty: false });
  await pm.deletePages([1]);
  assert.equal(o.doc.pageLabels, null);
  assert.equal(o.doc.pageLabelsDirty, false);
});
