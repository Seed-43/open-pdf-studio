// Vaste hoeken bij het tekenen van een meetvlak (GitHub #536).
//
// Het meetvlak kent dezelfde hoekbeperking als het lijngereedschap: Shift
// zet een zijde op een veelvoud van de hoekstap (angleSnapDegrees) en
// poolhoek-volgen (F10, polarTrackingEnabled) trekt de cursor naar de
// dichtstbijzijnde hoekstap vanaf het laatst geplaatste hoekpunt. Het
// lijngereedschap zet daarvoor zelf het poolanker op zijn hoekpunt; het
// meetvlak deed dat niet en leunde op het anker dat de dispatcher bij elke
// klik op het klikpunt zet. Daardoor:
//   - lag het poolanker na een klik op de cursor in plaats van op het
//     geplaatste hoekpunt, zodat de klik zelf de zijde NIET op de getoonde
//     hoek legde (de voorvertoning toonde horizontaal, het hoekpunt lag scheef);
//   - kon het eerste punt van een nieuw vlak naar een oud anker trekken.
//
// De echte tool, de snap-engine en de state-store draaien hier onder node
// (zie ../../core/app-test-hooks.mjs en ../../pdf/saver-test-hooks.mjs, die
// de schermonderdelen leeg maken). De dispatcher-stap van een klik
// (pointerdown: snap op het klikpunt en daar het poolanker) wordt nagebootst.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../../pdf/saver-test-hooks.mjs', import.meta.url);
// Na het afronden schakelt de tool via een dynamische import van manager.js
// terug naar de selectietool; die module (met de hele gereedschapsset) laadt
// onder node niet af en houdt het proces open. Hier is hij een lege stub.
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
const meas = await import('../../annotations/measurement.js');
const { measureAreaTool } = await import('./measurement-tool.js');

// Een canvas-context die alles slikt.
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
  state.measurePoints = null;
  state.measurePhase = 'outer';
  state.measureOuterPoints = null;
  state.measureHoles = [];
  return state.documents[0];
}

function voorkeuren(extra) {
  Object.assign(state.preferences, {
    enableObjectSnap: false, enableGridSnap: false,
    polarTrackingEnabled: false, polarIncrement: 45, polarTolerance: 3,
    enableAngleSnap: true, angleSnapDegrees: 45,
  }, extra);
}

function ctxBij(x, y) {
  const doc = state.documents[state.activeDocumentIndex];
  return {
    x, y, state, pageNum: 1, scale: 1, canvasCtx: stilCanvas(),
    snap: (px, py, uitsluiten, punten) => snapEngine.performSnap(px, py, doc.annotations, 1, 1, uitsluiten, punten),
    snapAngle,
    setPolarAnchor: snapEngine.setPolarAnchor,
    clearPolarAnchor: snapEngine.clearPolarAnchor,
    snapDistanceTo10: (x1, y1, x2, y2) => ({ x: x2, y: y2 }),
    redraw() {}, drawSnapIndicator() {}, drawMeasureAreaShape() {}, drawMeasurePerimeterShape() {},
    drawCentroidLabel() {},
    calculateArea: meas.calculateArea, calculatePerimeter: meas.calculatePerimeter,
    formatMeasurement: meas.formatMeasurement,
    createMeasureAreaAnnotation: (points, holes) => ({ id: 'nieuw', type: 'measureArea', page: 1, points, holes }),
    recordAdd() {},
  };
}

const gebeurtenis = (extra = {}) => ({ button: 0, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra });

/** Een klik zoals tool-dispatcher.js hem doorgeeft: eerst zijn snap en poolanker, dan de tool. */
function klik(x, y, extra) {
  const doc = state.documents[state.activeDocumentIndex];
  const start = snapEngine.performSnap(x, y, doc.annotations, 1, 1);
  snapEngine.setPolarAnchor(start.snapped ? start.x : x, start.snapped ? start.y : y, 1);
  measureAreaTool.onPointerDown(ctxBij(x, y), gebeurtenis(extra));
}

function beweeg(x, y, extra) {
  measureAreaTool.onPointerMove(ctxBij(x, y), gebeurtenis(extra));
}

const punten = () => state.measurePoints.map((p) => ({ x: p.x, y: p.y }));

test('poolhoek-volgen: de klik legt de zijde op de getoonde hoek, zijde na zijde', () => {
  openen();
  voorkeuren({ polarTrackingEnabled: true });
  snapEngine.clearPolarAnchor();
  klik(100, 100);
  beweeg(200, 103);
  assert.equal(state.lastSnapResult?.type, 'polar', 'de voorvertoning ligt op de hoekstap');
  klik(200, 103);
  const [a, b] = punten();
  assert.ok(Math.abs(b.y - a.y) < 1e-9, `eerste zijde horizontaal (dy = ${b.y - a.y})`);
  // Volgende zijde: bijna verticaal vanaf het GEPLAATSTE hoekpunt.
  beweeg(b.x + 3, 200);
  assert.equal(state.lastSnapResult?.type, 'polar');
  klik(b.x + 3, 200);
  const c = punten()[2];
  assert.ok(Math.abs(c.x - b.x) < 1e-9, `tweede zijde verticaal (dx = ${c.x - b.x})`);
  // Het anker staat op het laatste hoekpunt.
  const anker = snapEngine.getPolarAnchor();
  assert.ok(anker && Math.abs(anker.x - c.x) < 1e-9 && Math.abs(anker.y - c.y) < 1e-9);
  measureAreaTool.onDeactivate(ctxBij(0, 0));
});

test('het eerste hoekpunt trekt niet naar een oud poolanker', () => {
  openen();
  voorkeuren({ polarTrackingEnabled: true });
  snapEngine.setPolarAnchor(0, 0, 1);       // achtergebleven van een vorige tekening
  beweeg(100, 104);
  assert.notEqual(state.lastSnapResult?.type, 'polar', 'zweven zonder punten: geen poolsnap');
  klik(100, 104);
  assert.deepEqual(punten(), [{ x: 100, y: 104 }]);
  measureAreaTool.onDeactivate(ctxBij(0, 0));
});

test('Shift zet elke zijde op de hoekstap (zelfde regel als lijn en maat)', () => {
  openen();
  voorkeuren({ polarTrackingEnabled: false, angleSnapDegrees: 45 });
  snapEngine.clearPolarAnchor();
  klik(100, 100);
  klik(200, 110, { shiftKey: true });
  klik(260, 230, { shiftKey: true });
  const [a, b, c] = punten();
  assert.ok(Math.abs(b.y - a.y) < 1e-9, 'horizontaal');
  const hoek = Math.atan2(c.y - b.y, c.x - b.x) * 180 / Math.PI;
  assert.ok(Math.abs(hoek - 45) < 1e-9 || Math.abs(hoek - 90) < 1e-9, `veelvoud van 45° (${hoek})`);
  measureAreaTool.onDeactivate(ctxBij(0, 0));
});

test('na afronden of afbreken is er geen poolanker meer', () => {
  openen();
  voorkeuren({ polarTrackingEnabled: true });
  klik(100, 100);
  klik(200, 100);
  klik(200, 200);
  assert.ok(snapEngine.getPolarAnchor(), 'tijdens het tekenen staat het anker');
  measureAreaTool.onEscape(ctxBij(0, 0));
  assert.equal(snapEngine.getPolarAnchor(), null, 'Escape rondt af en wist het anker');

  klik(100, 100);
  klik(200, 100);
  measureAreaTool.onDeactivate(ctxBij(0, 0));
  assert.equal(snapEngine.getPolarAnchor(), null, 'van gereedschap wisselen wist het anker');
});
