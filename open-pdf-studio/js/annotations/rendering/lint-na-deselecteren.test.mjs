// Na deselecteren keert het lint terug naar het tabblad waar je vandaan kwam
// (GitHub #674).
//
// Het vangnet-effect in ribbonStore.js draait synchroon binnen
// setContextualTabsVisible(false). Riep updateContextualTabs() dat aan vóór
// autoActivateContextualTab(), dan zette het effect het lint al op Start
// voordat het vorige tabblad (bv. Tekenen) teruggezet kon worden.
//
// De echte lintstatus, het opmaakarchief en ui-state draaien hier onder node
// (zie ../../core/app-test-hooks.mjs). bridge.ts wordt een stub met de ECHTE
// lint- en opmaakexports, zoals in de app.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../../pdf/saver-test-hooks.mjs', import.meta.url);

const LINT = new URL('../../solid/stores/ribbonStore.js', import.meta.url).href;
const OPMAAK = new URL('../../solid/stores/formatStore.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(String.raw`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ECHT = {
  switchRibbonTab: ['${LINT}', 'switchToTab'],
  ribbonActiveTab: ['${LINT}', 'activeTab'],
  setRibbonActiveTab: ['${LINT}', 'setActiveTab'],
  contextualTabsVisible: ['${LINT}', 'contextualTabsVisible'],
  setContextualTabsVisible: ['${LINT}', 'setContextualTabsVisible'],
  syncFormatStore: ['${OPMAAK}', 'syncFormatStore'],
};
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/bridge.ts')) {
    const bron = readFileSync(fileURLToPath(url), 'utf8');
    const namen = new Set();
    for (const m of bron.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const deel of m[1].split(',')) {
        const naam = deel.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(naam)) namen.add(naam);
      }
    }
    const regels = [];
    for (const naam of namen) {
      if (ECHT[naam]) regels.push('export { ' + ECHT[naam][1] + ' as ' + naam + " } from '" + ECHT[naam][0] + "';");
      else regels.push('export function ' + naam + '() {}');
    }
    return { format: 'module', shortCircuit: true, source: regels.join('\n') };
  }
  return nextLoad(url, context);
}`)}`);

const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const lint = await import('../../solid/stores/ribbonStore.js');
const { updateContextualTabs } = await import('./ui-state.js');
await new Promise((r) => setTimeout(r, 0));

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, modified: false, textEdits: [], watermarks: [], bookmarks: [],
    pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  state.currentTool = 'select';
  state.toolOverrides = null;
  return state.documents[0];
}

function selecteer(doc, ...anns) {
  doc.annotations = anns;
  doc.selectedAnnotations = anns;
  updateContextualTabs();
}

function deselecteer(doc) {
  doc.selectedAnnotations = [];
  updateContextualTabs();
}

const vak = (id) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 10, height: 10, strokeColor: '#ff0000' });

for (const tab of ['drawing', 'comment', 'view']) {
  test(`selecteren en deselecteren vanaf '${tab}' keert terug naar '${tab}'`, () => {
    const doc = openen();
    updateContextualTabs();
    lint.setActiveTab(tab);

    selecteer(doc, vak('a1'));
    assert.equal(lint.contextualTabsVisible(), true);
    assert.equal(lint.activeTab(), 'format');

    deselecteer(doc);
    assert.equal(lint.contextualTabsVisible(), false);
    assert.equal(lint.activeTab(), tab, 'het lint keert terug naar het vorige tabblad, niet naar Start');
  });
}

test('een enkele afbeelding opent Afbeelding en keert ook terug', () => {
  const doc = openen();
  updateContextualTabs();
  lint.setActiveTab('drawing');
  selecteer(doc, { id: 'img1', type: 'image', page: 1, x: 0, y: 0, width: 10, height: 10 });
  assert.equal(lint.activeTab(), 'image');
  deselecteer(doc);
  assert.equal(lint.activeTab(), 'drawing');
});

test('wie zelf naar een gewoon tabblad ging, blijft daar na deselecteren', () => {
  const doc = openen();
  updateContextualTabs();
  lint.setActiveTab('drawing');
  selecteer(doc, vak('a1'));
  lint.setActiveTab('view');
  deselecteer(doc);
  assert.equal(lint.activeTab(), 'view');
});

test('het vangnet blijft: verbergen zonder updateContextualTabs valt terug op Start', () => {
  lint.setContextualTabsVisible(true);
  lint.setActiveTab('format');
  lint.setContextualTabsVisible(false);
  assert.equal(lint.activeTab(), 'home');
});
