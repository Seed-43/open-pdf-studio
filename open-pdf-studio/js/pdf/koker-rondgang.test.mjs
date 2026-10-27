// Een kokerprofiel uit een ouder bestand ("Koker 100x100x5") komt bij het
// openen terug onder de nieuwe naam K100/5, met hetzelfde symbool-id. Echte
// saver (saver-test-hooks.mjs) en echte lader (annotation-converter.js), zoals
// eigenschappen-rondgang.test.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
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
const { decodePdfTextObject } = await import('./saver/pdf-text.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'koker', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, new Map(), kaart);
  await doc.loadingTask.destroy();
  return modellen;
}

async function opgeslagenParams(bytes) {
  const doc = await PDFDocument.load(bytes);
  const refs = doc.getPage(0).node.Annots()?.asArray() || [];
  return refs
    .map((ref) => doc.context.lookup(ref).get(PDFName.of('OPS_Params')))
    .filter(Boolean)
    .map((v) => JSON.parse(decodePdfTextObject(v)));
}

const koker = (id, maat, x) => ({
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', lineWidth: 1, opacity: 1, author: 'User',
  id, type: 'parametricSymbol', symbolId: 'staal-koker', x, y: 100, width: 60, height: 60,
  params: { maat, aanzicht: 'doorsnede', schaal: 1, hartlijn: true, toonLabel: true },
});

test('een oude kokermaat in het bestand opent als K100/5', async () => {
  // Bestand zoals een oudere versie het schreef: de oude naam in OPS_Params.
  const bytes = await opslaan(await leegBlad(), [
    koker('vierkant', 'Koker 100x100x5', 100),
    koker('rechthoek', 'Koker 100x50x5', 300),
  ]);
  const opgeslagen = (await opgeslagenParams(bytes)).map((p) => p.maat).sort();
  assert.deepEqual(opgeslagen, ['Koker 100x100x5', 'Koker 100x50x5'], 'het oude bestand bevat de oude namen');

  const modellen = (await laad(bytes)).filter((m) => m.type === 'parametricSymbol');
  assert.equal(modellen.length, 2);
  for (const m of modellen) assert.equal(m.symbolId, 'staal-koker');
  const maten = modellen.map((m) => m.params.maat).sort();
  assert.deepEqual(maten, ['K100/5', 'Koker 100x50x5']);
  const vierkant = modellen.find((m) => m.params.maat === 'K100/5');
  assert.equal(vierkant.params.aanzicht, 'doorsnede', 'de andere parameters blijven staan');
  assert.equal(vierkant.params.toonLabel, true);
});

test('opnieuw opslaan schrijft de nieuwe naam', async () => {
  const eerst = await laad(await opslaan(await leegBlad(), [koker('vierkant', 'Koker 120x120x6', 100)]));
  const bytes = await opslaan(await leegBlad(), eerst);
  assert.deepEqual((await opgeslagenParams(bytes)).map((p) => p.maat), ['K120/6']);
});
