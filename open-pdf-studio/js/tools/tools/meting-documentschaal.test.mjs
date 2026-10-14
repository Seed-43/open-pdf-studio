// Nieuwe maatlijnen en omtrekmetingen volgen de schaal van het document
// (#554). De kalibratie (doc.measureScale) en de meetschaal uit de PDF zelf
// (doc.pdfViewports) zijn net zo goed een schaalbron als een schaalgebied,
// schaalbalk of viewport-annotatie. Alleen zonder enige bron geldt de
// handmatige voorkeursschaal van het gereedschap (measureDistDimScale /
// measurePerimDimScale, standaard 1 in mm: één punt telt dan als één
// millimeter). Voorheen las een nieuwe maat in een gekalibreerd document
// "72" waar 2540 mm bedoeld was, terwijl de bestaande maten ernaast na het
// kalibreren wel goed werden herrekend.
//
// Echte state-store, meetfuncties en gereedschappen; het canvas en de
// gereedschapsmanager zijn stubs (zie ../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state, getActiveDocument } = await import('../../core/state.js');
const meting = await import('../../annotations/measurement.js');
const { measureDistanceTool } = await import('./measurement-tool.js');
const { createMeasurePerimeterAnnotation } = await import('../annotation-creators.js');

// Punten per millimeter op papier bij schaal 1:n.
const PPU = (n) => 72 / (25.4 * n);

const nepCanvas = { save() {}, restore() {}, setLineDash() {} };

/** Open een document met de gegeven schaalbronnen als actief tabblad. */
function metDocument(extra, fn) {
  state.documents.push({ annotations: [], currentPage: 1, pageRotations: {}, ...extra });
  state.activeDocumentIndex = state.documents.length - 1;
  try {
    return fn(getActiveDocument());
  } finally {
    state.documents.splice(0);
    state.activeDocumentIndex = -1;
    state.dimPoints = [];
    state.isDrawingDimension = false;
    state.measurePoints = null;
  }
}

/** Voorkeuren tijdelijk anders zetten; daarna de oude waarden terug. */
function metVoorkeuren(waarden, fn) {
  const oud = {};
  for (const sleutel of Object.keys(waarden)) {
    oud[sleutel] = state.preferences[sleutel];
    state.preferences[sleutel] = waarden[sleutel];
  }
  try {
    return fn();
  } finally {
    Object.assign(state.preferences, oud);
  }
}

/**
 * Teken een maatlijn van 72 pt (1 inch op papier) met het maatgereedschap:
 * klik, beweeg, klik, beweeg naar de kant, klik. Geeft de labels van de
 * voorvertoning en de vastgelegde annotatie terug.
 */
function tekenMaatlijn() {
  const voorvertoning = [];
  let vastgelegd = null;
  const basis = {
    state,
    scale: 1,
    canvasCtx: nepCanvas,
    snap: (x, y) => ({ snapped: false, x, y }),
    snapAngle: (hoek) => hoek,
    snapDistanceTo10: meting.snapDistanceTo10,
    calculateDistance: meting.calculateDistance,
    createAnnotation: (props) => ({ ...props }),
    recordAdd: (ann) => { vastgelegd = ann; },
    redraw() {},
    drawDimension: (_c, opties) => { voorvertoning.push(opties.measureText); },
    drawSnapIndicator() {},
  };
  const knop = { button: 0, shiftKey: false, ctrlKey: false };
  const klik = (x, y) => measureDistanceTool.onPointerDown({ ...basis, x, y }, knop);
  const beweeg = (x, y) => measureDistanceTool.onPointerMove({ ...basis, x, y }, knop);

  klik(100, 100);
  beweeg(172, 100);
  klik(172, 100);
  beweeg(130, 150);
  klik(130, 150);
  measureDistanceTool.onDeactivate({ ...basis, x: 0, y: 0 });
  return { voorvertoning, vastgelegd };
}

// Een omtrek van 144 pt: twee zijden van 72 pt.
const OMTREK = [{ x: 100, y: 100 }, { x: 172, y: 100 }, { x: 172, y: 172 }];

test('a calibrated document (doc.measureScale) measures a new dimension with the calibration', () => {
  metDocument({ measureScale: { pixelsPerUnit: PPU(100), unit: 'mm', method: 'scale-ratio', scaleRatio: '1:100' } }, () => {
    const { voorvertoning, vastgelegd } = tekenMaatlijn();
    // 1 inch op papier bij 1:100 is 2540 mm; de voorkeursschaal gaf "72".
    assert.deepEqual(voorvertoning, ['2540', '2540'], 'voorvertoning met de kalibratie');
    assert.ok(vastgelegd, 'de maatlijn is vastgelegd');
    assert.equal(vastgelegd.measureText, '2540');
    assert.equal(vastgelegd.measureUnit, 'mm');
    assert.equal(vastgelegd.measureScale, undefined, 'geen eigen voorkeursschaal op de maat');
    assert.ok(Math.abs(vastgelegd.measureValue - 2540) < 1e-6);
  });
});

test('the tool unit preference does not turn a calibrated length into feet', () => {
  // Het geval uit de melding: eenheid van het gereedschap op voet gezet.
  metVoorkeuren({ measureDistDimUnit: 'ft' }, () => {
    metDocument({ measureScale: { pixelsPerUnit: PPU(100), unit: 'mm' } }, () => {
      const { voorvertoning, vastgelegd } = tekenMaatlijn();
      assert.deepEqual(voorvertoning, ['2540', '2540']);
      assert.equal(vastgelegd.measureText, '2540');
      assert.equal(vastgelegd.measureUnit, 'mm');
    });
  });
});

test('the PDF\'s own viewport scale (doc.pdfViewports) measures a new dimension', () => {
  const vp = { x: 0, y: 0, width: 800, height: 600, pixelsPerUnit: PPU(50), unit: 'mm', ratio: '1:50' };
  metDocument({ pdfViewports: { 1: [vp] } }, () => {
    const { voorvertoning, vastgelegd } = tekenMaatlijn();
    assert.deepEqual(voorvertoning, ['1270', '1270'], 'voorvertoning met de viewportschaal');
    assert.equal(vastgelegd.measureText, '1270');
    assert.equal(vastgelegd.measureUnit, 'mm');
    assert.equal(vastgelegd.measureScale, undefined);
  });
});

test('without any scale source the preference scale still applies to a new dimension', () => {
  metVoorkeuren({ measureDistDimScale: 2, measureDistDimUnit: 'mm' }, () => {
    metDocument({ measureScale: null }, () => {
      const { voorvertoning, vastgelegd } = tekenMaatlijn();
      assert.deepEqual(voorvertoning, ['144', '144']);
      assert.equal(vastgelegd.measureText, '144');
      assert.equal(vastgelegd.measureScale, 2);
    });
  });
});

test('a new perimeter in a calibrated document uses the calibration', () => {
  metDocument({ measureScale: { pixelsPerUnit: PPU(100), unit: 'mm' } }, () => {
    const ann = createMeasurePerimeterAnnotation(OMTREK.map((p) => ({ ...p })));
    // 144 pt bij 1:100 is 5080 mm; de voorkeursschaal gaf "144.00 mm".
    assert.equal(ann.measureText, '5080 mm');
    assert.equal(ann.measureUnit, 'mm');
    assert.equal(ann.measureScale, undefined);
  });
});

test('a new perimeter inside a PDF viewport uses the viewport scale', () => {
  const vp = { x: 0, y: 0, width: 800, height: 600, pixelsPerUnit: PPU(50), unit: 'mm', ratio: '1:50' };
  metDocument({ pdfViewports: { 1: [vp] } }, () => {
    const ann = createMeasurePerimeterAnnotation(OMTREK.map((p) => ({ ...p })));
    assert.equal(ann.measureText, '2540 mm');
    assert.equal(ann.measureScale, undefined);
  });
});

test('without any scale source the preference scale still applies to a new perimeter', () => {
  metVoorkeuren({ measurePerimDimScale: 2, measurePerimDimUnit: 'mm', measurePerimDimPrecision: 0 }, () => {
    metDocument({}, () => {
      const ann = createMeasurePerimeterAnnotation(OMTREK.map((p) => ({ ...p })));
      assert.equal(ann.measureText, '288 mm');
      assert.equal(ann.measureScale, 2);
    });
  });
});
