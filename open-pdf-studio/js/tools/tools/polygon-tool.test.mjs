// De veelhoek-tool plaatst hoek voor hoek (#622).
//
// De echte tool, de snap-engine en de state-store draaien hier onder node
// (zie ../../core/app-test-hooks.mjs en ../../pdf/saver-test-hooks.mjs). Een
// klik volgt de dispatcher: eerst zijn snap op het klikpunt (startX/startY),
// dan pointerdown en pointerup van de tool. Een dubbelklik is twee klikken
// en daarna pointerdown met detail 2, zoals handleDblClick hem doorgeeft.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../../pdf/saver-test-hooks.mjs', import.meta.url);
// Na het afronden schakelt de tool via een dynamische import van manager.js
// terug naar de selectietool; die module laadt onder node niet. Lege stub.
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('/js/tools/manager.js')) {
    return { format: 'module', shortCircuit: true, source: 'export function maybeRevertToSelect() {}' };
  }
  return nextLoad(url, context);
}`)}`);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const snapEngine = await import('../snap-engine.js');
const { snapAngle } = await import('../../utils/helpers.js');
const { createAnnotationFromTool } = await import('../annotation-creators.js');
const { consumeKey, typeLengthActive } = await import('../type-length-input.js');
const { getMeasureScale } = await import('../../annotations/measurement.js');
const { polygonTool, veelhoekInAanbouw } = await import('./polygon-tool.js');

function stilCanvas() {
  const opgeslagen = {};
  return new Proxy(opgeslagen, {
    get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => {}),
    set: (doel, sleutel, waarde) => { doel[sleutel] = waarde; return true; },
  });
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
  state.currentTool = 'polygon';
  Object.assign(state.preferences, {
    enableObjectSnap: false, enableGridSnap: false, polarTrackingEnabled: false,
    enableAngleSnap: true, angleSnapDegrees: 45,
  });
  polygonTool.onDeactivate(ctxBij(0, 0));
  return state.documents[0];
}

let toegevoegd = [];
function ctxBij(x, y) {
  const doc = state.documents[state.activeDocumentIndex];
  return {
    x, y, state, pageNum: 1, scale: 1, canvasCtx: stilCanvas(),
    snap: (px, py, uitsluiten, punten) => snapEngine.performSnap(px, py, doc.annotations, 1, 1, uitsluiten, punten),
    snapToGrid: (v) => v,
    snapAngle,
    setPolarAnchor: snapEngine.setPolarAnchor,
    clearPolarAnchor: snapEngine.clearPolarAnchor,
    createAnnotationFromTool,
    drawShapePreview() {}, redraw() {}, drawSnapIndicator() {},
    recordAdd(a) { toegevoegd.push(a); },
  };
}

const gebeurtenis = (extra = {}) => ({ button: 0, detail: 0, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra });

function klik(x, y, extra) {
  const doc = state.documents[state.activeDocumentIndex];
  const start = snapEngine.performSnap(x, y, doc.annotations, 1, 1);
  state.startX = start.snapped ? start.x : x;
  state.startY = start.snapped ? start.y : y;
  polygonTool.onPointerDown(ctxBij(x, y), gebeurtenis(extra));
  polygonTool.onPointerUp(ctxBij(x, y), gebeurtenis(extra));
}
const beweeg = (x, y, extra) => polygonTool.onPointerMove(ctxBij(x, y), gebeurtenis(extra));
function dubbelklik(x, y) {
  klik(x, y);
  klik(x, y);
  polygonTool.onPointerDown(ctxBij(x, y), gebeurtenis({ detail: 2 }));
}
function toets(key) {
  const e = gebeurtenis({ key });
  let tegengehouden = false;
  e.preventDefault = () => { tegengehouden = true; };
  polygonTool.onKeyDown({ state, redraw() {} }, e);
  return tegengehouden;
}
const veelhoeken = () => state.documents[0].annotations.filter((a) => a.type === 'polygon');
const kaal = (pts) => pts.map((p) => ({ x: p.x, y: p.y }));

test('drie klikken en Enter geven een veelhoek met precies die drie hoekpunten', () => {
  openen();
  toegevoegd = [];
  klik(100, 100);
  klik(200, 100);
  klik(150, 180);
  assert.deepEqual(veelhoekInAanbouw(), [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 180 }]);
  assert.equal(veelhoeken().length, 0, 'nog niets afgerond');
  assert.equal(toets('Enter'), true, 'Enter is van de tool');
  const [v] = veelhoeken();
  assert.ok(v, 'veelhoek aangemaakt');
  assert.deepEqual(kaal(v.points), [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 180 }]);
  assert.equal(v.sides, 3);
  assert.deepEqual([v.x, v.y, v.width, v.height], [100, 100, 100, 80]);
  // Enter komt via de toetsenbord-handler (zonder recordAdd in de context):
  // de tool zet de ongedaan-stap zelf.
  assert.equal(state.documents[0].undoStack.length, 1, 'één ongedaan-stap');
  assert.deepEqual(veelhoekInAanbouw(), []);
  assert.equal(typeLengthActive(), false, 'lengte-invoer weer uit');
});

test('Escape laat niets achter', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  klik(150, 180);
  assert.equal(polygonTool.onEscape(ctxBij(0, 0)), true);
  assert.equal(veelhoeken().length, 0);
  assert.deepEqual(veelhoekInAanbouw(), []);
  assert.equal(snapEngine.getPolarAnchor(), null, 'geen poolanker meer');
  assert.equal(polygonTool.onEscape(ctxBij(0, 0)), false, 'zonder tekening: niets te doen');
});

test('een klik op het eerste hoekpunt sluit de veelhoek', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  klik(200, 200);
  klik(100, 200);
  klik(103, 98);
  const [v] = veelhoeken();
  assert.ok(v);
  assert.equal(v.points.length, 4, 'het sluitpunt is geen vijfde hoekpunt');
});

test('dubbelklik rondt af zonder dubbel hoekpunt', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  klik(220, 160);
  dubbelklik(150, 220);
  const [v] = veelhoeken();
  assert.ok(v);
  assert.deepEqual(kaal(v.points), [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 220, y: 160 }, { x: 150, y: 220 }]);
  assert.equal(v.sides, 4);
});

test('rechtermuisklik rondt af; met minder dan drie hoekpunten komt er niets', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  polygonTool.onPointerDown(ctxBij(0, 0), gebeurtenis({ button: 2 }));
  assert.equal(veelhoeken().length, 0);
  assert.deepEqual(veelhoekInAanbouw(), []);
  klik(100, 100);
  klik(200, 100);
  klik(150, 180);
  polygonTool.onPointerDown(ctxBij(0, 0), gebeurtenis({ button: 2 }));
  assert.equal(veelhoeken().length, 1);
});

test('Backspace haalt het laatste hoekpunt weg', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  klik(400, 400);
  assert.equal(toets('Backspace'), true);
  assert.deepEqual(veelhoekInAanbouw(), [{ x: 100, y: 100 }, { x: 200, y: 100 }]);
  klik(150, 180);
  toets('Enter');
  assert.deepEqual(kaal(veelhoeken()[0].points), [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 180 }]);
});

test('Enter met twee hoekpunten rondt niet af', () => {
  openen();
  klik(100, 100);
  klik(200, 100);
  toets('Enter');
  assert.equal(veelhoeken().length, 0);
  assert.equal(veelhoekInAanbouw().length, 2);
  polygonTool.onEscape(ctxBij(0, 0));
});

test('Shift legt de zijde op de hoekstap', () => {
  openen();
  klik(100, 100);
  klik(200, 108, { shiftKey: true });
  const [a, b] = veelhoekInAanbouw();
  assert.ok(Math.abs(b.y - a.y) < 1e-9, `horizontaal (dy = ${b.y - a.y})`);
  polygonTool.onEscape(ctxBij(0, 0));
});

test('een getypte lengte + Enter plaatst het volgende hoekpunt op die afstand', () => {
  openen();
  klik(100, 100);
  beweeg(300, 100);
  for (const k of ['5', '0']) consumeKey(k);
  beweeg(300, 100);
  assert.equal(typeof state._typeLengthCommit, 'function');
  state._typeLengthCommit();
  const [, b] = veelhoekInAanbouw();
  const ppu = getMeasureScale(1, 100, 100).pixelsPerUnit || 1;
  assert.ok(Math.abs(b.x - (100 + 50 * ppu)) < 1e-6 && Math.abs(b.y - 100) < 1e-6, `${b.x},${b.y}`);
  polygonTool.onEscape(ctxBij(0, 0));
});

test('een sleep vóór het eerste hoekpunt tekent de regelmatige zeshoek, met hoekpunten', () => {
  openen();
  state.startX = 100;
  state.startY = 100;
  polygonTool.onPointerDown(ctxBij(100, 100), gebeurtenis());
  beweeg(200, 160);
  polygonTool.onPointerUp(ctxBij(300, 200), gebeurtenis());
  const [v] = veelhoeken();
  assert.ok(v, 'zeshoek aangemaakt');
  assert.equal(v.points.length, 6);
  assert.equal(v.sides, 6);
  // Hoekpunt 0 bovenaan het midden van het gesleepte vak.
  assert.ok(Math.abs(v.points[0].x - 200) < 1e-9 && Math.abs(v.points[0].y - 100) < 1e-9);
  assert.deepEqual(veelhoekInAanbouw(), []);
});
