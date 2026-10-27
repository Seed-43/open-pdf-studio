// Opslaan van een tekstvak met Chinees en Japans, met de echte saver.
//
// Sinds de CJK-appearance gaan tekens die WinAnsi niet kan tonen met het
// gebundelde Noto Sans TC de appearance in. Vereenvoudigde tekens als 测 en 试
// staan daar niet in en kwamen als lege vakjes (glyph 0) in het bestand; die
// moeten uit het tweede gebundelde font (Noto Sans SC) komen.

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { parseToUnicodeCMap } from '../text/content-stream-text.js';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const RESOURCES = fileURLToPath(new URL('../../src-tauri/resources/', import.meta.url));
const BESTANDEN = ['NotoSansTC-Regular.ttf', 'NotoSansSC-Regular.otf'];
const aanwezig = BESTANDEN.every((b) => existsSync(path.join(RESOURCES, 'fonts', b)));
const zonderFonts = aanwezig ? false : 'CJK-fonts ontbreken — draai eerst npm run prepare:ocr-runtime';

// De Tauri-API's die het fontbestand uit de resourcemap lezen.
globalThis.__TAURI__ = {
  path: { resourceDir: async () => RESOURCES, join: async (...delen) => path.join(...delen) },
  core: { invoke: async () => undefined },
  fs: { readFile: async (pad) => readFileSync(pad) },
};

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');

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
    id: 'cjk', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');
const streamTekst = (stream) => latin1(stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents());

/** De getoonde tekst per Tj uit de appearance, met per Type0-font de CID's via /ToUnicode. */
function getoondeRuns(doc, annot) {
  const ctx = doc.context;
  const ap = ctx.lookup(ctx.lookup(annot.get(PDFName.of('AP')), PDFDict).get(PDFName.of('N')));
  const fonts = ctx.lookup(ap.dict.lookup(PDFName.of('Resources'), PDFDict).get(PDFName.of('Font')), PDFDict);
  const inhoud = streamTekst(ap);
  const runs = [];
  let font = null;
  for (const m of inhoud.matchAll(/\/(\S+) [\d.]+ Tf|<([0-9A-Fa-f]*)> Tj|\(((?:\\.|[^\\)])*)\) Tj/g)) {
    if (m[1]) { font = m[1]; continue; }
    if (m[2] !== undefined) {
      const dict = ctx.lookup(fonts.get(PDFName.of(font)), PDFDict);
      const cmap = parseToUnicodeCMap(streamTekst(ctx.lookup(dict.get(PDFName.of('ToUnicode'))))).map;
      const cids = m[2].match(/.{4}/g).map((h) => parseInt(h, 16));
      runs.push({ font, cids, tekst: cids.map((c) => cmap.get(c) ?? '\uFFFD').join('') });
    } else {
      runs.push({ font, cids: null, tekst: m[3] });
    }
  }
  return runs;
}

test('Vereenvoudigd Chinees en Japans in een tekstvak krijgen elk een echte glyph', { skip: zonderFonts }, async () => {
  const tekst = '中文测试 日本語テキスト ABC';
  const bytes = await opslaan(await leegBlad(), [{
    id: 'cjk', page: 1, type: 'textbox', x: 60, y: 60, width: 400, height: 60, rotation: 0,
    text: tekst, fontSize: 14, fontFamily: 'Arial', textPadding: 3, color: '#000000',
    strokeColor: '#000000', fillColor: null, textColor: '#000000', lineWidth: 1, borderStyle: 'solid', opacity: 1,
  }]);
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const annot = doc.context.lookup(doc.getPage(0).node.Annots().get(0), PDFDict);
  const runs = getoondeRuns(doc, annot);
  assert.equal(runs.map((r) => r.tekst).join('').replace(/\s+/g, ' '), tekst, JSON.stringify(runs));
  for (const r of runs.filter((x) => x.cids)) {
    assert.ok(r.cids.every((c) => c !== 0), `geen .notdef in '${r.tekst}' (${r.font})`);
  }
  const sc = runs.find((r) => r.tekst.includes('测'));
  assert.ok(sc && sc.font !== runs.find((r) => r.tekst.includes('中')).font,
    `测 komt uit een ander font dan 中: ${JSON.stringify(runs)}`);
});
