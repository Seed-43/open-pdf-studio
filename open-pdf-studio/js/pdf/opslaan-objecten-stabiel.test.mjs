// Opslaan → heropenen → opslaan laat het bestand niet groeien.
//
// pdf-lib schrijft elk object in zijn context mee, ook als niets er meer naar
// verwijst. De saver vervangt bij elke save alle annotaties die hij beheert
// door nieuwe uit het model; de oude woordenboeken, hun appearances en hun
// lettertypen bleven als ballast in het bestand staan en kregen bij de
// volgende save weer nieuwe nummers boven op de oude. De xref-tabel groeide
// zo bij elke save met het hele annotatiebestand.
//
// Deze test slaat met de echte saver (saver-test-hooks.mjs) en de echte lader
// drie keer op en eist dat het bestand na de eerste save even groot blijft:
// zelfde /Size, geen onbereikbare objecten, dezelfde markeringen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { createAnnotation } = await import('../annotations/factory.js');

const N = (s) => PDFName.of(s);

async function bronBestand() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Blad ${i + 1}`, { x: 40, y: 20, size: 10 });
  }
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const lib = await PDFDocument.load(bytes.slice());
  const modellen = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    const kaart = await extractAnnotationColors(n, lib);
    for (const annot of await pagina.getAnnotations()) {
      const m = await convertPdfAnnotation(annot, n, viewport, new Map(), kaart);
      if (m) modellen.push(m);
    }
  }
  await doc.loadingTask.destroy();
  return modellen;
}

async function opslaan(bronBytes, modellen) {
  state.documents = [{
    id: 'stabiel', filePath: 'C:/stabiel/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1, 2]), textEdits: [], currentPage: 1,
  }];
  state.activeDocumentIndex = 0;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: () => true,
      writeBinaryFileAtomic: (_pad, b) => { globalThis.__saverTest.uit = b; return true; },
    },
  };
  assert.equal(await savePDF('C:/stabiel/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return globalThis.__saverTest.uit;
}

function markeringen() {
  return [
    createAnnotation({ type: 'box', page: 1, x: 50, y: 60, width: 120, height: 80, color: '#ff0000',
      strokeColor: '#ff0000', fillColor: '#ffff00', lineWidth: 2, author: 'Tester', subject: 'Vak' }),
    createAnnotation({ type: 'circle', page: 1, x: 220, y: 60, width: 90, height: 90, color: '#0000ff',
      strokeColor: '#0000ff', lineWidth: 3, author: 'Tester' }),
    createAnnotation({ type: 'arrow', page: 1, startX: 60, startY: 300, endX: 300, endY: 360, color: '#008000',
      strokeColor: '#008000', lineWidth: 2, headSize: 12, author: 'Tester' }),
    createAnnotation({ type: 'draw', page: 2, path: [{ x: 60, y: 420 }, { x: 120, y: 470 }, { x: 200, y: 430 }],
      color: '#000000', strokeColor: '#000000', lineWidth: 2, author: 'Tester' }),
    createAnnotation({ type: 'polygon', page: 2, points: [{ x: 350, y: 300 }, { x: 500, y: 320 }, { x: 450, y: 420 }],
      color: '#ff00ff', strokeColor: '#ff00ff', lineWidth: 2, author: 'Tester' }),
    createAnnotation({ type: 'textbox', page: 1, x: 330, y: 60, width: 200, height: 60, text: 'Tekstvak',
      fontSize: 14, fontFamily: 'Helvetica', color: '#000000', textColor: '#000000', strokeColor: '#000000',
      fillColor: '#ffffff', lineWidth: 1, author: 'Tester' }),
    createAnnotation({ type: 'comment', page: 2, x: 520, y: 700, text: 'Notitie', color: '#ffff00', author: 'Tester' }),
  ];
}

/** /Size uit de trailer (of de xref-stroom) van de bytes zelf. */
function xrefGrootte(bytes) {
  const tekst = Buffer.from(bytes).toString('latin1');
  const treffers = [...tekst.matchAll(/\/Size\s+(\d+)/g)];
  assert.ok(treffers.length, 'een /Size in het bestand');
  return Number(treffers.at(-1)[1]);
}

/** Objecten in het bestand waar vanaf de trailer niets naar verwijst. */
function onbereikbaar(lib) {
  const context = lib.context;
  const gezien = new Set();
  const t = context.trailerInfo;
  const stapel = [t.Root, t.Info].filter(Boolean);
  while (stapel.length) {
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      if (gezien.has(o.tag)) continue;
      gezien.add(o.tag);
      o = context.lookup(o);
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stapel.push(v);
    else if (o instanceof PDFArray) stapel.push(...o.asArray());
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stapel.push(v);
  }
  return context.enumerateIndirectObjects().filter(([ref]) => !gezien.has(ref.tag)).length;
}

function annotTelling(lib) {
  return lib.getPages().map((p) => {
    const a = p.node.lookup(N('Annots'));
    return a instanceof PDFArray ? a.size() : 0;
  });
}

test('opslaan → heropenen → opslaan: zelfde /Size, geen ballast', async () => {
  const eerste = await opslaan(await bronBestand(), markeringen());
  const tweede = await opslaan(eerste, await laad(eerste));
  const derde = await opslaan(tweede, await laad(tweede));

  const [lib1, lib2, lib3] = await Promise.all([eerste, tweede, derde].map((b) => PDFDocument.load(b)));
  for (const [naam, lib] of [['eerste', lib1], ['tweede', lib2], ['derde', lib3]]) {
    assert.equal(onbereikbaar(lib), 0, `${naam} save: geen onbereikbare objecten`);
  }
  assert.deepEqual(annotTelling(lib2), annotTelling(lib1), 'dezelfde annotaties per pagina');
  assert.deepEqual(annotTelling(lib3), annotTelling(lib1), 'dezelfde annotaties per pagina');
  assert.equal(xrefGrootte(tweede), xrefGrootte(eerste), 'tweede save: /Size groeit niet');
  assert.equal(xrefGrootte(derde), xrefGrootte(eerste), 'derde save: /Size groeit niet');
  assert.equal(lib3.context.enumerateIndirectObjects().length, lib1.context.enumerateIndirectObjects().length,
    'evenveel objecten');

  const modellen = await laad(derde);
  assert.equal(modellen.length, 7, 'alle zeven markeringen na drie saves');
});
