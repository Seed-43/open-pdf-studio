// Opslaan als het gebundelde CJK-font ontbreekt, met de echte saver.
//
// Ontbrak NotoSansTC-Regular.ttf in de resourcemap, dan mislukte het hele
// opslaan ("failed to open file ..."). Een ontbrekend font mag alleen dat ene
// uiterlijk raken: het tekstvak valt terug op de WinAnsi-appearance, een
// OCR-tekstlaag wordt overgeslagen, en er komt een waarschuwing in de console.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

// Een resourcemap zonder fonts: de fs-plugin weigert zoals in de app.
globalThis.__TAURI__ = {
  path: { resourceDir: async () => 'C:/app/resources', join: async (...delen) => delen.join('/') },
  core: { invoke: async () => undefined },
  fs: { readFile: async (pad) => { throw new Error(`failed to open file at path: ${pad}`); } },
};

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

async function opslaan(bronBytes, document) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'zonder-font', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], annotations: [], ...document,
  }];
  state.activeDocumentIndex = 0;
  const gelukt = await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true });
  return { gelukt, uit };
}

/** Vangt console.warn tijdens `fn`. */
async function metWaarschuwingen(fn) {
  const meldingen = [];
  const oud = console.warn;
  console.warn = (...a) => meldingen.push(a.map(String).join(' '));
  try { return { uitkomst: await fn(), meldingen }; } finally { console.warn = oud; }
}

const tekstvak = {
  id: 'cjk', page: 1, type: 'textbox', x: 60, y: 60, width: 400, height: 60, rotation: 0,
  text: '中文测试 ABC', fontSize: 14, fontFamily: 'Arial', textPadding: 3, color: '#000000',
  strokeColor: '#000000', fillColor: null, textColor: '#000000', lineWidth: 1, borderStyle: 'solid', opacity: 1,
};

test('een tekstvak met Chinees wordt opgeslagen zonder CJK-font, met een waarschuwing', async () => {
  const { uitkomst: { gelukt, uit }, meldingen } = await metWaarschuwingen(
    async () => opslaan(await leegBlad(), { annotations: [tekstvak] }));
  assert.equal(gelukt, true, 'opslaan gelukt');
  const doc = await PDFDocument.load(uit, { throwOnInvalidObject: true });
  const annot = doc.context.lookup(doc.getPage(0).node.Annots().get(0), PDFDict);
  assert.equal(annot.lookup(PDFName.of('Contents')).decodeText(), '中文测试 ABC', 'de tekst zelf blijft bewaard');
  const ap = annot.lookup(PDFName.of('AP'), PDFDict);
  assert.ok(ap?.get(PDFName.of('N')), 'het tekstvak heeft nog een appearance');
  assert.ok(meldingen.some((m) => /NotoSansTC-Regular\.ttf/.test(m)), `waarschuwing: ${JSON.stringify(meldingen)}`);
});

test('een OCR-tekstlaag zonder CJK-font wordt overgeslagen, het opslaan lukt', async () => {
  const words = [{ text: 'Hello', left: 72, top: 72, width: 60, height: 14 }];
  const { uitkomst: { gelukt, uit }, meldingen } = await metWaarschuwingen(
    async () => opslaan(await leegBlad(), { ocrResults: { 1: words } }));
  assert.equal(gelukt, true, 'opslaan gelukt');
  assert.equal((await PDFDocument.load(uit)).getPageCount(), 1);
  assert.ok(meldingen.some((m) => /OCR/i.test(m)), `waarschuwing: ${JSON.stringify(meldingen)}`);
});
