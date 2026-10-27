// De tekstlaag bij ongedaan maken en opnieuw uitvoeren van een tekstbewerking
// (#719). Ongedaan maken zette de originele tekst al terug in de spans;
// opnieuw uitvoeren liet de laag op de originele tekst staan, zodat zoeken en
// selecteren tot de volgende opslag de oude tekst vonden en een klik een
// tweede bewerking van dezelfde run begon.
//
// Echte state-store en undo-manager (zie ./app-test-hooks.mjs), met een
// tekstlaag van nep-spans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('./state.ts');
const undo = await import('./undo-manager.js');
const { bewerkingSpans, spanTekstenNa } = await import('../text/tekstlaag-bewerking.js');

function span(tekst, x, y, hoek = 0) {
  const r = hoek * Math.PI / 180;
  return {
    textContent: tekst,
    dataset: { pdfTransform: JSON.stringify([12 * Math.cos(r), 12 * Math.sin(r), -12 * Math.sin(r), 12 * Math.cos(r), x, y]) },
  };
}

function laagMet(spans) {
  const laag = { querySelectorAll: () => spans };
  globalThis.document.querySelector = (sel) => (String(sel).startsWith('.textLayer') ? laag : null);
  return laag;
}

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

// Een regel van twee spans ("Eerste " + "versie"), zoals de tekstlaag van PDF.js.
function bewerking(extra = {}) {
  return {
    id: 'e1', page: 1, originalText: 'Eerste versie', newText: 'Tweede versie',
    pdfX: 72, pdfY: 700, fontSize: 12, lineSpacing: 14.4, textAngle: 0,
    originalLineInfo: [{ x: 72, y: 700, fontSize: 12, angle: 0, text: 'Eerste versie' }],
    originalSpanTexts: [['Eerste ', 'versie']],
    ...extra,
  };
}

test('opnieuw uitvoeren van een tekstbewerking zet de nieuwe tekst terug in de tekstlaag', async () => {
  const doc = openen();
  const spans = [span('Eerste ', 72, 700), span('versie', 110, 700), span('Andere regel', 72, 680)];
  laagMet(spans);
  const edit = bewerking();
  // Zoals finishPdfTextEditing: record erin, spans bijgewerkt, dan de stap.
  doc.textEdits.push({ ...edit });
  spans[0].textContent = 'Tweede versie';
  spans[1].textContent = '';
  spans[0].dataset.editId = 'e1';
  spans[1].dataset.editId = 'e1';
  doc.undoStack = [{ type: 'addTextEdit', textEdit: { ...edit } }];
  doc.redoStack = [];

  await undo.undo();
  assert.deepEqual(spans.map(s => s.textContent), ['Eerste ', 'versie', 'Andere regel']);
  assert.equal(spans[0].dataset.editId, undefined, 'na ongedaan maken hoort de span niet meer bij het record');

  await undo.redo();
  assert.deepEqual(spans.map(s => s.textContent), ['Tweede versie', '', 'Andere regel'],
    'na opnieuw toont de tekstlaag de bewerkte tekst');
  assert.equal(spans[0].dataset.editId, 'e1', 'een klik heropent hetzelfde record');
  assert.equal(doc.textEdits.length, 1);
});

test('opnieuw gebruikt de span-teksten die het bevestigen zette (kolommen)', async () => {
  const doc = openen();
  const spans = [span('Offerte:', 72, 700), span('AC294', 200, 700)];
  laagMet(spans);
  const edit = bewerking({
    originalText: 'Offerte:\tAC294', newText: 'Factuur:\tAC295',
    originalLineInfo: [{ x: 72, y: 700, fontSize: 12, angle: 0, text: 'Offerte:AC294' }],
    originalSpanTexts: [['Offerte:', 'AC294']],
  });
  doc.textEdits.push({ ...edit });
  spans[0].textContent = 'Factuur:';
  spans[1].textContent = 'AC295';
  doc.undoStack = [{ type: 'addTextEdit', textEdit: { ...edit }, tekstlaagNa: [['Factuur:', 'AC295']] }];
  doc.redoStack = [];
  await undo.undo();
  assert.deepEqual(spans.map(s => s.textContent), ['Offerte:', 'AC294']);
  await undo.redo();
  assert.deepEqual(spans.map(s => s.textContent), ['Factuur:', 'AC295']);
});

test('ongedaan maken en opnieuw van een herbewerking (modifyTextEdit) volgen de tekstlaag', async () => {
  const doc = openen();
  const spans = [span('Tweede versie', 72, 700), span('', 110, 700)];
  laagMet(spans);
  const oud = bewerking();
  const nieuw = bewerking({ newText: 'Derde versie' });
  doc.textEdits.push({ ...nieuw });
  spans[0].textContent = 'Derde versie';
  doc.undoStack = [{ type: 'modifyTextEdit', oldTextEdit: { ...oud }, newTextEdit: { ...nieuw } }];
  doc.redoStack = [];
  await undo.undo();
  assert.deepEqual(spans.map(s => s.textContent), ['Tweede versie', '']);
  await undo.redo();
  assert.deepEqual(spans.map(s => s.textContent), ['Derde versie', '']);
});

test('een verplaatst blok: de spans staan op het originele anker', () => {
  const spans = [span('Eerste ', 72, 700), span('versie', 110, 700), span('Verderop', 300, 500)];
  const laag = { querySelectorAll: () => spans };
  const regels = bewerkingSpans(laag, bewerking({ pdfX: 300, pdfY: 500, moved: true }));
  assert.deepEqual(regels[0].map(s => s.textContent), ['Eerste ', 'versie']);
});

test('gedraaide tekst (90°): de regel loopt langs y', () => {
  const spans = [span('Eerste ', 100, 300, 90), span('versie', 100, 340, 90), span('Naast', 120, 300, 90)];
  const laag = { querySelectorAll: () => spans };
  const edit = bewerking({
    pdfX: 100, pdfY: 300, textAngle: 90,
    originalLineInfo: [{ x: 100, y: 300, fontSize: 12, angle: 90, text: 'Eerste versie' }],
  });
  assert.deepEqual(bewerkingSpans(laag, edit)[0].map(s => s.textContent), ['Eerste ', 'versie']);
});

test('spanTekstenNa: wissen maakt alle spans leeg; minder regels laat de rest leeg', () => {
  const edit = bewerking({ originalText: 'a\nb', originalSpanTexts: [['a', 'x'], ['b']] });
  assert.deepEqual(spanTekstenNa({ ...edit, newText: '' }), [['', ''], ['']]);
  assert.deepEqual(spanTekstenNa({ ...edit, newText: 'nieuw\tdeel' }), [['nieuw deel', ''], ['']]);
});

test('een intussen opnieuw opgebouwde tekstlaag (andere tekst) blijft ongemoeid', async () => {
  const doc = openen();
  // Na opslaan en herladen staat de opgeslagen tekst in één span, met een
  // buurspan op dezelfde regel die niet bij de bewerking hoort.
  const spans = [span('Tweede versie', 72, 700), span('Buurtekst', 160, 700)];
  laagMet(spans);
  const edit = bewerking({ newText: 'Derde versie' });
  doc.textEdits.push({ ...edit });
  doc.undoStack = [];
  doc.redoStack = [{ type: 'addTextEdit', textEdit: { ...edit } }];
  await undo.redo();
  assert.deepEqual(spans.map(s => s.textContent), ['Tweede versie', 'Buurtekst'],
    'de laag toont niet het origineel: niets overschrijven');
});

test('een vervanging via de MCP-teksttools zet de tekstlaag ook bij', async () => {
  const fs = await import('node:fs');
  const bron = fs.readFileSync(new URL('../text/mcp-text-tools.js', import.meta.url), 'utf8');
  const pasToe = bron.slice(bron.indexOf('async function pasToe'), bron.indexOf('export async function replaceTextForMcp'));
  assert.match(pasToe, /toonBewerkingInTekstlaag\(laag, record\)/);
});
