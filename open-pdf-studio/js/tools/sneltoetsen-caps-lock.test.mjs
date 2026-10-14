// Ctrl-sneltoetsen met Caps Lock aan (#577): e.key is dan een hoofdletter
// terwijl Shift niet is ingedrukt (en met Caps Lock + Shift juist een kleine
// letter). Alleen Shift mag Ctrl+S van Ctrl+Shift+S onderscheiden, en een
// Ctrl-letter mag nooit als enkel-toets-gereedschap (V = selecteren) tellen.
// Het echte keyboard-handlers.js, met stubs voor zijn imports
// (keyboard-handlers-stubs.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

register('./keyboard-handlers-stubs.mjs', import.meta.url);

const log = [];
const ann = { id: 'a1', type: 'box', page: 1, x: 100, y: 100, width: 50, height: 20 };
const doc = { pdfDoc: { numPages: 3 }, scale: 1, currentPage: 1, selectedAnnotations: [ann], annotations: [ann], viewMode: 'single' };
const state = { currentTool: 'select', preferences: {}, search: {} };

globalThis.__khStubs = {
  state,
  getActiveDocument: () => doc,
  isPdfAReadOnly: () => false,
  typeLengthActive: () => false,
  isGMoveModeActive: () => false,
  isGRotateModeActive: () => false,
  wisselTagEnRuimte: () => false,
  tabDoorOnderdelen: () => false,
  getTool: () => ({}),
  expandCorrectionGroups: (_alle, gekozen) => gekozen,
  savePDF: () => log.push('savePDF'),
  savePDFAs: () => log.push('savePDFAs'),
  showNewDocDialog: () => log.push('showNewDocDialog'),
  openPDFFile: () => log.push('openPDFFile'),
  closeActiveTab: () => log.push('closeActiveTab'),
  openFindBar: () => log.push('openFindBar'),
  undo: () => log.push('undo'),
  redo: () => log.push('redo'),
  selectAllOnPage: () => log.push('selectAllOnPage'),
  copyAnnotation: (a) => log.push(`copyAnnotation ${a.id}`),
  copyAnnotations: () => log.push('copyAnnotations'),
  pasteAnnotation: () => log.push('pasteAnnotation'),
  pasteAnnotations: () => log.push('pasteAnnotations'),
  deleteAnnotationsWithUndo: (_d, sel) => log.push(`delete ${sel.map((a) => a.id).join(',')}`),
  showDocPropertiesDialog: () => log.push('showDocPropertiesDialog'),
  toggleFullscreen: () => log.push('toggleFullscreen'),
  setTool: (t) => log.push(`setTool ${t}`),
};

const { handleKeydown } = await import('./keyboard-handlers.js');

const canvas = { tagName: 'CANVAS', id: '', isContentEditable: false, closest: () => null };

// Een Ctrl-toets zoals de WebView hem levert; `key` is wat Caps Lock en Shift
// er samen van maken.
function ctrlToets(key, { shift = false } = {}) {
  return {
    key, code: `Key${key.toUpperCase()}`, target: canvas,
    ctrlKey: true, metaKey: false, shiftKey: shift, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  };
}

async function druk(key, opties) {
  log.length = 0;
  doc.selectedAnnotations = [ann];
  await handleKeydown(ctrlToets(key, opties));
  return [...log];
}

test('Ctrl+S slaat op, met en zonder Caps Lock', async () => {
  assert.deepEqual(await druk('s'), ['savePDF']);
  assert.deepEqual(await druk('S'), ['savePDF'], 'Caps Lock aan');
});

test('Ctrl+Shift+S opent Opslaan als, met en zonder Caps Lock', async () => {
  assert.deepEqual(await druk('S', { shift: true }), ['savePDFAs']);
  assert.deepEqual(await druk('s', { shift: true }), ['savePDFAs'], 'Caps Lock aan');
});

test('Ctrl+C en Ctrl+X kopiëren en knippen met Caps Lock aan', async () => {
  assert.deepEqual(await druk('C'), ['copyAnnotation a1']);
  assert.deepEqual(await druk('X'), ['copyAnnotation a1', 'delete a1']);
});

test('Ctrl+V plakt met Caps Lock aan en wisselt geen gereedschap', async () => {
  state.clipboardAnnotation = { ...ann };
  state._internalCopyAt = 2;
  state._appBlurAt = 1;
  try {
    assert.deepEqual(await druk('v'), ['pasteAnnotation']);
    assert.deepEqual(await druk('V'), ['pasteAnnotation'], 'Caps Lock aan');
  } finally {
    delete state.clipboardAnnotation;
    delete state._internalCopyAt;
    delete state._appBlurAt;
  }
});

test('de overige Ctrl-letters werken ook met Caps Lock aan', async () => {
  assert.deepEqual(await druk('N'), ['showNewDocDialog']);
  assert.deepEqual(await druk('O'), ['openPDFFile']);
  assert.deepEqual(await druk('W'), ['closeActiveTab']);
  assert.deepEqual(await druk('F'), ['openFindBar']);
  assert.deepEqual(await druk('Z'), ['undo']);
  assert.deepEqual(await druk('Y'), ['redo']);
  assert.deepEqual(await druk('D'), ['showDocPropertiesDialog']);
  assert.deepEqual(await druk('L'), ['toggleFullscreen']);
  assert.ok((await druk('A')).includes('selectAllOnPage'));
});

test('Shift blijft het onderscheid maken: Ctrl+Shift+N, O, W, F en D doen niets', async () => {
  for (const letter of ['n', 'o', 'w', 'f', 'd']) {
    assert.deepEqual(await druk(letter.toUpperCase(), { shift: true }), [], `Ctrl+Shift+${letter}`);
    assert.deepEqual(await druk(letter, { shift: true }), [], `Ctrl+Shift+${letter} met Caps Lock`);
  }
});

test('een Ctrl-letter wisselt nooit van gereedschap', async () => {
  for (const letter of ['v', 'V', 'h', 'H', 't', 'T']) {
    const uit = await druk(letter);
    assert.ok(!uit.some((r) => r.startsWith('setTool')), `Ctrl+${letter}: ${uit.join(', ')}`);
  }
});

// Bewaking op de bron: geen Ctrl-sneltoets die e.key alleen met één
// hoofdletter-vorm vergelijkt. Zo'n regel moet beide vormen noemen of
// toLowerCase() gebruiken.
test('geen Ctrl-sneltoets in de bron vergelijkt e.key met maar één lettervorm', () => {
  const js = join(dirname(fileURLToPath(import.meta.url)), '..');
  const fouten = [];
  const loop = (map) => {
    for (const naam of readdirSync(map)) {
      const pad = join(map, naam);
      if (statSync(pad).isDirectory()) { if (naam !== 'i18n') loop(pad); continue; }
      if (!/\.(js|jsx)$/.test(naam) || /\.test\./.test(naam)) continue;
      readFileSync(pad, 'utf8').split(/\r?\n/).forEach((regel, i) => {
        if (!/ctrl/i.test(regel)) return;
        for (const m of regel.matchAll(/\be\.key === '([a-zA-Z])'/g)) {
          const ander = m[1] === m[1].toLowerCase() ? m[1].toUpperCase() : m[1].toLowerCase();
          if (!regel.includes(`e.key === '${ander}'`)) fouten.push(`${relative(js, pad)}:${i + 1}: ${regel.trim()}`);
        }
      });
    }
  };
  loop(js);
  assert.deepEqual(fouten, []);
});
