// Pijltoetsen in de lint-tabstrook (#551): de tabstrook wisselt met pijl
// links/rechts van tabblad. De globale toetsafhandeling mag dan niet ook de
// geselecteerde annotaties verschuiven (dat wijzigde het document en zette een
// ongedaan-stap neer). Het echte keyboard-handlers.js, met stubs voor zijn
// imports (keyboard-handlers-stubs.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./keyboard-handlers-stubs.mjs', import.meta.url);

const log = [];
const ann = { id: 'a1', type: 'box', page: 1, x: 100, y: 100, width: 50, height: 20 };
const doc = { pdfDoc: { numPages: 3 }, scale: 1, currentPage: 2, selectedAnnotations: [ann], annotations: [ann], viewMode: 'single' };
let paneel = 'thumbnails';

globalThis.__khStubs = {
  state: { currentTool: 'select', preferences: {}, search: {} },
  getActiveDocument: () => doc,
  isPdfAReadOnly: () => false,
  isTextAnchored: () => false,
  weergaveVectorNaarPagina: (x, y) => ({ x, y }),
  applyMove: (a, dx, dy) => { a.x += dx; a.y += dy; log.push(`applyMove ${a.id}`); },
  recordModify: (id) => log.push(`recordModify ${id}`),
  recordBulkModify: () => log.push('recordBulkModify'),
  goToPage: (p) => log.push(`goToPage ${p}`),
  typeLengthActive: () => false,
  isGMoveModeActive: () => false,
  isGRotateModeActive: () => false,
  wisselTagEnRuimte: () => false,
  tabDoorOnderdelen: () => false,
  // Het select-gereedschap heeft geen onKeyDown.
  getTool: () => ({}),
  activeTab: () => paneel,
};

const { handleKeydown } = await import('./keyboard-handlers.js');

// Een element dat alleen `closest` kent: `binnen` zijn de selectors waar het in zit.
function element(binnen = [], tagName = 'BUTTON') {
  return {
    tagName, id: '', isContentEditable: false,
    closest: (selector) => (selector.split(',').map((s) => s.trim()).some((s) => binnen.includes(s)) ? {} : null),
  };
}
const tabknop = () => element(['[role="tablist"]', '[role="tab"]', '.ribbon-tabs']);

function toets(key, target, { defaultPrevented = false } = {}) {
  return {
    key, target, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
  };
}

test('controle: een pijl buiten een besturingselement verschuift de selectie wel', async () => {
  log.length = 0;
  ann.x = 100;
  await handleKeydown(toets('ArrowRight', element([], 'CANVAS')));
  assert.deepEqual(log, ['applyMove a1', 'recordModify a1']);
  assert.equal(ann.x, 101);
});

test('pijl rechts op een tabknop in de tabstrook verschuift niets en maakt geen ongedaan-stap', async () => {
  log.length = 0;
  ann.x = 100;
  await handleKeydown(toets('ArrowRight', tabknop()));
  assert.deepEqual(log, []);
  assert.equal(ann.x, 100);
});

test('ook als de tabstrook de toets al afhandelde (defaultPrevented) verschuift er niets', async () => {
  log.length = 0;
  ann.x = 100;
  await handleKeydown(toets('ArrowLeft', element([], 'CANVAS'), { defaultPrevented: true }));
  assert.deepEqual(log, []);
  assert.equal(ann.x, 100);
});

test('pijl omlaag in de tabstrook bladert niet door het document', async () => {
  log.length = 0;
  paneel = 'thumbnails';
  doc.selectedAnnotations = [];
  try {
    await handleKeydown(toets('ArrowDown', tabknop()));
    assert.deepEqual(log, []);
    // Controle: zonder besturingselement bladert dezelfde toets wel.
    await handleKeydown(toets('ArrowDown', element([], 'CANVAS')));
    assert.deepEqual(log, ['goToPage 3']);
  } finally {
    doc.selectedAnnotations = [ann];
  }
});

test('menu, keuzelijst en menubalk houden hun pijltoetsen ook', async () => {
  for (const binnen of [['[role="menu"]'], ['[role="menubar"]'], ['select'], ['[role="listbox"]']]) {
    log.length = 0;
    ann.x = 100;
    await handleKeydown(toets('ArrowUp', element(binnen)));
    assert.deepEqual(log, [], binnen[0]);
    assert.equal(ann.x, 100);
  }
});
