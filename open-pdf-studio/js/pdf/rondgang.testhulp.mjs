// Testhulp: opslaan met de echte saver en heropenen met de echte lader.
//
// Opslaan: js/pdf/saver.js onder node via saver-test-hooks.mjs. Heropenen:
// pdf.js-annotaties -> extractAnnotationColors -> zetPaginaAnnotatiesOm, de
// omzetting per pagina van js/pdf/loader.js. De lader geeft nieuwe id's:
// zoek modellen terug op soort of tekst, nooit op id of positie.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { leesAnnotatieLagen } = await import('./saver/annotatie-lagen.js');
const { getLayers } = await import('../annotations/annotatie-lagen.js');

export { state };

/** Een leeg A4-blad, eventueel met /Rotate. */
export async function leegBlad({ rotatie = 0 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  return doc.save();
}

/**
 * Opslaan met de echte saver, op de bytes van het geopende bestand.
 * @param {{ lagen?: object[]|null, impl?: object }} [opties]  de annotatielagen van
 *   het document, en vervangers voor gestubde modules (zie saver-test-hooks.mjs)
 */
export async function opslaan(bronBytes, modellen, { lagen = null, impl = {}, document = {} } = {}) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      ...impl,
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'rondgang', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
    ...(lagen ? { annotationLayers: lagen } : {}),
    // Meer pagina's, bladwijzers, paginalabels: wat de test meegeeft.
    ...document,
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

/**
 * De modellen van blad 1 zoals js/pdf/loader.js ze maakt, en de
 * annotatielagen zoals de lader ze uit het bestand haalt.
 */
export async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const lib = await PDFDocument.load(bytes.slice());
  const kaart = await extractAnnotationColors(1, lib);
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, new Map(), kaart);
  await doc.loadingTask.destroy();
  const gelezen = leesAnnotatieLagen(lib);
  modellen.lagen = gelezen ? getLayers({ annotationLayers: gelezen.lagen }) : null;
  return modellen;
}

/**
 * De modellen van alle bladen zoals js/pdf/loader.js ze maakt (pagina per
 * pagina), met het aantal bladen erbij.
 */
export async function laadAlles(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const lib = await PDFDocument.load(bytes.slice());
  const modellen = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    const kaart = await extractAnnotationColors(n, lib);
    modellen.push(...await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), n, viewport, new Map(), kaart));
  }
  modellen.aantalPaginas = doc.numPages;
  await doc.loadingTask.destroy();
  const gelezen = leesAnnotatieLagen(lib);
  modellen.lagen = gelezen ? getLayers({ annotationLayers: gelezen.lagen }) : null;
  return modellen;
}

/** De annotatie-woordenboeken van blad 1, met het document erbij. */
export async function woordenboeken(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const refs = doc.getPage(0).node.Annots()?.asArray() || [];
  const lijst = refs.map((ref) => ({ ref, dict: ctx.lookup(ref) }));
  lijst.doc = doc;
  return lijst;
}
