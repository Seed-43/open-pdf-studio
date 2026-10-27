// Save round trip of corrections made in the proofreading mode (#508, part 2),
// with the real saver (saver.js) and the real converter of the loader.
//
// A text PDF (pdf-lib, Helvetica) with three pages: upright text, a page with
// /Rotate 90, and text rotated a quarter turn on an upright page. The text
// model comes from pdf.js getTextContent as in the app; the corrections are
// made with the same functions the mode uses (insert, Delete pressed twice,
// Backspace, a replace of a word). After saving and reopening: the same
// kinds, colours, rectangles and reading directions, no duplicates, the
// struck text kept in /OPS_MarkedText and never in /Contents, and the page
// content itself untouched. A second save of the reopened document gives the
// same file.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import {
  PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts, degrees, decodePDFRawStream, PDFRawStream,
} from 'pdf-lib';

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
const { resolveGroupLinks } = await import('./loader/correction-load.js');
const { buildTextModel, indexOf } = await import('../annotations/corrections/text-model.js');
const { applyInsert, applyReplace, applyStrike } = await import('../annotations/corrections/proofreading-apply.js');
const { correctionKind, CORRECTION_COLORS } = await import('../annotations/corrections/model.js');

const REGELS = {
  1: { rotate: 0, lines: [['The quikc brown fox', 72, 700], ['jumps ovver the lazy dog.', 72, 684]] },
  2: { rotate: 90, lines: [['Rotated page text here', 72, 500]] },
  3: { rotate: 0, lines: [['Vertical words go up', 300, 200, 90]] },
};
const GROOTTE = 12;

async function tekstPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2, 3]) {
    const pagina = doc.addPage([612, 792]);
    pagina.setRotation(degrees(REGELS[n].rotate));
    for (const [tekst, x, y, draai] of REGELS[n].lines) {
      pagina.drawText(tekst, { x, y, size: GROOTTE, font, ...(draai ? { rotate: degrees(draai) } : {}) });
    }
  }
  return { bytes: await doc.save(), font };
}

/** Text model per page, as the mode builds it (here measured with the font's own widths). */
async function modellen(bytes, font) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const uit = {};
  for (const n of [1, 2, 3]) {
    const pagina = await lezer.getPage(n);
    const transform = pagina.getViewport({ scale: 1, rotation: pagina.rotate }).transform;
    const inhoud = await pagina.getTextContent();
    uit[n] = buildTextModel(inhoud.items, { transform, measure: (s) => font.widthOfTextAtSize(s, 1) });
  }
  await lezer.loadingTask.destroy();
  return uit;
}

function document(bronBytes, annotations = []) {
  state.documents = [{
    id: 'proeflezen', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations,
    currentPage: 1, scale: 1, viewMode: 'single', selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [], watermarks: [], bookmarks: [],
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

async function opslaan(bronBytes) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'saved');
  return uit;
}

/** Reopen as js/pdf/loader.js does: convert every annotation, then link the replaces. */
async function heropen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pdfLib = await PDFDocument.load(bytes.slice());
  const alle = [];
  for (const n of [1, 2, 3]) {
    const pagina = await lezer.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    const kaart = await extractAnnotationColors(n, pdfLib);
    const byPdfId = new Map();
    const groepen = [];
    for (const annot of await pagina.getAnnotations()) {
      const omgezet = await convertPdfAnnotation(annot, n, viewport, new Map(), kaart);
      if (!omgezet) continue;
      if (annot.id) byPdfId.set(annot.id, omgezet);
      if (annot.replyType === 'Group' && annot.inReplyTo) groepen.push({ converted: omgezet, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
      alle.push(omgezet);
    }
    resolveGroupLinks(groepen, byPdfId);
  }
  await lezer.loadingTask.destroy();
  return alle;
}

const tekstVan = (ctx, v) => {
  const o = v === undefined ? undefined : ctx.lookup(v);
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined;
};

/** Raw annotation dictionaries and decoded page content per page. */
async function rauw(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  return doc.getPages().map((pagina) => {
    const refs = ctx.lookup(pagina.node.get(PDFName.of('Annots')))?.asArray() || [];
    const annots = refs.map((ref) => {
      const d = ctx.lookup(ref);
      return {
        subtype: d.get(PDFName.of('Subtype'))?.toString(),
        it: d.get(PDFName.of('IT'))?.toString(),
        rt: d.get(PDFName.of('RT'))?.toString(),
        irt: d.get(PDFName.of('IRT'))?.toString(),
        contents: tekstVan(ctx, d.get(PDFName.of('Contents'))),
        marked: tekstVan(ctx, d.get(PDFName.of('OPS_MarkedText'))),
        ap: !!d.get(PDFName.of('AP')),
      };
    });
    const inhoud = ctx.lookup(pagina.node.get(PDFName.of('Contents')));
    const stromen = Array.isArray(inhoud?.asArray?.()) ? inhoud.asArray().map((r) => ctx.lookup(r)) : [inhoud];
    const tekst = stromen.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : '')).join('\n');
    return { annots, inhoud: tekst };
  });
}

let klaar;
async function rondgang() {
  if (klaar) return klaar;
  const { bytes, font } = await tekstPdf();
  const m = await modellen(bytes, font);
  const doc = document(bytes);

  // Page 1: insert 'quick' fix by replacing 'quikc', insert at the end of line 1,
  // Delete twice on 'v' of 'ovver' (struck 'v' then 've' -> extended), and Backspace once.
  const ovver = indexOf(m[1], 1, 7); // 'jumps o|vver'
  const vervang = applyReplace(doc, m[1], 1, { start: 4, end: 9 }, 'quick');
  const invoeg = applyInsert(doc, m[1], 1, indexOf(m[1], 0, 19), ' jumps');
  const een = applyStrike(doc, m[1], 1, { cursor: ovver, dir: 'forward' });
  const twee = applyStrike(doc, m[1], 1, { cursor: een.cursor, last: een.last, dir: 'forward' });
  const bs = applyStrike(doc, m[1], 1, { cursor: indexOf(m[1], 1, 21), dir: 'backward', unit: 'word' });
  // Page 2 (/Rotate 90): a replace and an insert.
  const vervang2 = applyReplace(doc, m[2], 2, { start: 13, end: 17 }, 'copy');
  const invoeg2 = applyInsert(doc, m[2], 2, 7, '!');
  // Page 3 (text going up): a delete of one word and an insert.
  const del3 = applyStrike(doc, m[3], 3, { cursor: 9, selection: { anchor: 9, focus: 15 }, dir: 'forward' });
  const invoeg3 = applyInsert(doc, m[3], 3, 8, 'big ');

  const gemaakt = state.documents[0].annotations.map((a) => JSON.parse(JSON.stringify(a)));
  const save1 = await opslaan(bytes);
  const terug1 = await heropen(save1);
  document(save1, terug1.map((a) => ({ ...a })));
  const save2 = await opslaan(save1);
  const terug2 = await heropen(save2);
  klaar = {
    bytes, m, gemaakt, save1, save2, terug1, terug2,
    bron: await rauw(bytes), rauw1: await rauw(save1), rauw2: await rauw(save2),
    stappen: { vervang, invoeg, een, twee, bs, vervang2, invoeg2, del3, invoeg3 },
  };
  return klaar;
}

const bijna = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const zelfdeVak = (a, b, msg) => {
  for (const k of ['x', 'y', 'width', 'height']) bijna(a[k], b[k], 0.01, `${msg} ${k}`);
};
const hex = (c) => String(c || '').toUpperCase();

test('the corrections made in the mode are what the user did', async () => {
  const { stappen, gemaakt } = await rondgang();
  assert.equal(stappen.vervang.strike.markedText, 'quikc');
  assert.equal(stappen.twee.annotation.markedText, 'vv', 'Delete twice: one strike that grew');
  assert.equal(stappen.twee.annotation.id, stappen.een.annotation.id);
  assert.equal(stappen.bs.annotation.markedText, 'lazy ', 'Ctrl+Backspace strikes the word before the cursor');
  assert.equal(stappen.vervang2.strike.markedText, 'text');
  assert.equal(stappen.del3.annotation.markedText, 'words ');
  assert.equal(gemaakt.length, 10, 'two replaces (2 each), three inserts, three deletes');
  assert.deepEqual(gemaakt.filter((a) => a.page === 2).map((a) => a.textDir), [90, 90, 90], 'page /Rotate 90: text runs down');
  assert.deepEqual(gemaakt.filter((a) => a.page === 3).map((a) => a.textDir), [270, 270], 'text going up');
});

test('after save and reopen: same kinds, colours, rectangles and directions, no duplicates', async () => {
  const { gemaakt, terug1, terug2 } = await rondgang();
  for (const [label, terug] of [['first save', terug1], ['second save', terug2]]) {
    assert.equal(terug.length, gemaakt.length, `${label}: number of annotations`);
    for (const n of [1, 2, 3]) {
      const voor = gemaakt.filter((a) => a.page === n);
      const na = terug.filter((a) => a.page === n);
      const soorten = (lijst) => lijst.map((a) => correctionKind(a, lijst)).sort();
      assert.deepEqual(soorten(na), soorten(voor), `${label} page ${n}: kinds`);
      for (const a of voor) {
        const kind = correctionKind(a, voor);
        const b = na.find((x) => correctionKind(x, na) === kind && (a.type === 'caret' ? x.text === a.text : x.markedText === a.markedText));
        assert.ok(b, `${label} page ${n}: ${kind} ${a.text ?? a.markedText} found`);
        assert.equal(hex(b.color), hex(a.color), `${label} page ${n} ${kind}: colour`);
        assert.equal(b.textDir, a.textDir, `${label} page ${n} ${kind}: textDir`);
        if (a.type === 'caret') {
          zelfdeVak(b, a, `${label} page ${n} caret`);
        } else {
          assert.equal(b.intent, 'StrikeOutTextEdit');
          assert.equal(b.rects.length, a.rects.length, `${label} page ${n}: lines`);
          a.rects.forEach((r, i) => zelfdeVak(b.rects[i], r, `${label} page ${n} strike line ${i + 1}`));
        }
      }
    }
  }
});

test('colours per kind: insert blue, delete red, replace purple', async () => {
  const { terug1 } = await rondgang();
  for (const a of terug1) {
    const kind = correctionKind(a, terug1);
    const verwacht = { insert: CORRECTION_COLORS.insert, delete: CORRECTION_COLORS.delete, replace: CORRECTION_COLORS.replace, replaceChild: CORRECTION_COLORS.replace }[kind];
    assert.equal(hex(a.color), hex(verwacht), `${kind}`);
  }
});

test('the struck text is in /OPS_MarkedText and never in /Contents; replaces are linked as a group', async () => {
  const { rauw1, rauw2, gemaakt } = await rondgang();
  const geschrapt = gemaakt.filter((a) => a.markedText).map((a) => a.markedText);
  assert.equal(geschrapt.length, 5);
  for (const pagina of [...rauw1, ...rauw2]) {
    for (const a of pagina.annots) {
      for (const tekst of geschrapt) {
        assert.ok(!(a.contents || '').includes(tekst.trim()), `/Contents ${JSON.stringify(a.contents)} holds no struck text`);
      }
      assert.ok(a.ap, `${a.subtype} has an appearance`);
      if (a.subtype === '/StrikeOut') {
        assert.equal(a.it, '/StrikeOutTextEdit');
        assert.ok(a.marked, 'struck text kept');
      }
    }
    const kinderen = pagina.annots.filter((a) => a.rt === '/Group');
    const ouders = pagina.annots.filter((a) => a.it === '/Replace');
    assert.equal(kinderen.length, ouders.length, 'one child per replace');
    for (const k of kinderen) assert.equal(k.contents, undefined, 'a linked child has no /Contents');
  }
  const p1 = rauw1[0].annots;
  assert.deepEqual(p1.filter((a) => a.subtype === '/Caret').map((a) => a.contents).sort(), [' jumps', 'quick']);
  assert.deepEqual(p1.filter((a) => a.subtype === '/StrikeOut').map((a) => a.marked).sort(), ['lazy ', 'quikc', 'vv']);
});

test('the page content is untouched and a second save keeps the same annotations', async () => {
  const { bron, rauw1, rauw2 } = await rondgang();
  bron.forEach((p, i) => {
    assert.equal(rauw1[i].inhoud, p.inhoud, `page ${i + 1}: content stream unchanged`);
    assert.equal(rauw2[i].inhoud, p.inhoud, `page ${i + 1}: still unchanged`);
    assert.equal(p.annots.length, 0, 'the source had no annotations');
    const zonderAp = (lijst) => lijst.map(({ irt, ...rest }) => rest);
    assert.deepEqual(zonderAp(rauw2[i].annots), zonderAp(rauw1[i].annots), `page ${i + 1}: same annotations after a second save`);
  });
});
