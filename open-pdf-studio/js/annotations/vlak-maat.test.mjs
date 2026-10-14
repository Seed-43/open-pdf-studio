// Schaal, eenheid en zijdematen van een BESTAAND meetvlak (GitHub #536).
//
// Het eigenschappenpaneel toonde bij een meetvlak wel de velden Schaal en
// Eenheid, maar ze deden niets: recomputeMeasureText rekende een meetvlak
// altijd opnieuw met de documentschaal (de eigen schaal werd genegeerd) en
// zette de gekozen eenheid daarna terug op die van het document. Het paneel
// kende bovendien alleen lengte-eenheden, terwijl het meetvlak 'mm²' bewaart.
//
// De echte state-store, het eigenschappenpaneel, de meetmodule en de
// vervormingen draaien hier onder node met de laadhaken van de app
// (zie ../core/app-test-hooks.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const meas = await import('./measurement.js');
const { storeShowProperties, annotProps, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');
const { applyResize } = await import('./transforms.js');
const { createMeasureAreaAnnotation } = await import('../tools/annotation-creators.js');
const { cloneAnnotation } = await import('./factory.js');

// 1:100 in millimeters: pixels (punten) per millimeter.
const PPU_100 = 72 / (25.4 * 100);
const MM_PER_PT = 1 / PPU_100;            // 35,28 mm per punt
const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function openen(annotations = [], measureScale = { pixelsPerUnit: PPU_100, unit: 'mm' }) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

/** Een meetvlak van 100 × 50 punt zoals het gereedschap het aanmaakt. */
function meetvlak(extra = {}) {
  openen([]);   // de documentschaal (1:100) geldt al bij het aanmaken
  const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 150 }, { x: 100, y: 150 }];
  const area = meas.calculateArea(points, undefined, 1);
  return {
    id: `ma-${Math.random().toString(36).slice(2, 8)}`, type: 'measureArea', page: 1, points,
    strokeColor: '#ff0000', color: '#ff0000', lineWidth: 1, opacity: 1,
    measureText: meas.formatMeasurement(area), measureValue: area.value, measureUnit: area.unit,
    measurePrecision: 2, createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
}

function selecteer(ann) {
  const doc = openen([ann]);
  doc.selectedAnnotation = ann;
  doc.selectedAnnotations = [ann];
  storeShowProperties(ann);
  return doc;
}

// ── uitgangssituatie ────────────────────────────────────────────────────────

test('een meetvlak op 1:100: 6,22 m² en het paneel toont de lengte-eenheid', () => {
  const ann = meetvlak();
  selecteer(ann);
  assert.equal(ann.measureText, '6.22 m²');
  assert.equal(ann.measureUnit, 'mm²');
  assert.equal(annotProps.measureUnit, 'mm', 'de keuzelijst kent alleen lengte-eenheden');
  assert.equal(annotProps.measureScale, 0, 'geen eigen schaal: leeg veld (documentschaal)');
});

// ── schaal ──────────────────────────────────────────────────────────────────

test('de schaal van een bestaand meetvlak wijzigen rekent de oppervlakte opnieuw', () => {
  const ann = meetvlak();
  selecteer(ann);
  updateAnnotProp('measureScale', '10');            // 10 mm per punt
  assert.equal(ann.measureScale, 10);
  assert.equal(ann.measureText, '0.50 m²', '5000 pt² × (10 mm)² = 0,5 m²');
  assert.ok(bijna(ann.measureValue, 500000));
  assert.equal(ann.measureUnit, 'mm²');
  assert.equal(annotProps.measureUnit, 'mm');
});

test('de eigen schaal leegmaken gaat terug naar de documentschaal', () => {
  const ann = meetvlak({ measureScale: 10 });
  selecteer(ann);
  updateAnnotProp('measureScale', '');
  assert.equal(ann.measureScale, 0);
  assert.equal(ann.measureText, '6.22 m²');
  assert.equal(ann.measureUnit, 'mm²');
  assert.equal(annotProps.measureUnit, 'mm');
});

// ── eenheid ─────────────────────────────────────────────────────────────────

test('de eenheid wijzigen houdt de echte maat: de eigen schaal rekent mee om', () => {
  const ann = meetvlak();
  selecteer(ann);
  updateAnnotProp('measureScale', '10');
  updateAnnotProp('measureUnit', 'cm');
  assert.ok(bijna(ann.measureScale, 1), '10 mm per punt = 1 cm per punt');
  assert.ok(bijna(annotProps.measureScale, 1), 'het schaalveld toont de omgerekende schaal');
  assert.equal(annotProps.measureUnit, 'cm');
  assert.equal(ann.measureUnit, 'cm²');
  assert.equal(ann.measureText, '5000.00 cm²');
});

test('een eenheid kiezen zonder eigen schaal legt de documentschaal vast in die eenheid', () => {
  const ann = meetvlak();
  selecteer(ann);
  updateAnnotProp('measureUnit', 'm');
  assert.ok(bijna(ann.measureScale, MM_PER_PT / 1000), 'documentschaal in meter per punt');
  assert.equal(ann.measureUnit, 'm²');
  assert.equal(ann.measureText, '6.22 m²', 'dezelfde oppervlakte');
  assert.equal(annotProps.measureUnit, 'm');
  assert.ok(bijna(annotProps.measureScale, MM_PER_PT / 1000));
});

test('de eigen schaal blijft gelden na het verslepen van een hoekpunt', () => {
  const ann = meetvlak({ measureScale: 1, measureUnit: 'cm²' });
  openen([ann]);
  const origineel = cloneAnnotation(ann);
  applyResize(ann, 'polyline_node_2', 0, 50, origineel);   // 100 × 50 → trapezium
  const verwacht = meas.formatMeasurement({ value: 7500, unit: 'cm²' });
  assert.equal(ann.measureText, verwacht);
  assert.equal(ann.measureUnit, 'cm²');
});

// ── zijdematen ──────────────────────────────────────────────────────────────

test('zijdematen: dezelfde schaal en afronding als de oppervlaktetekst', () => {
  const ann = meetvlak();
  openen([ann]);
  const teksten = meas.vlakZijdeTeksten(ann).map((z) => z.tekst);
  assert.deepEqual(teksten, ['3528 mm', '1764 mm', '3528 mm', '1764 mm']);
  for (const z of meas.vlakZijdeTeksten(ann)) {
    assert.equal(z.tekst, meas.formatMeasurement({ value: z.lengte * MM_PER_PT, unit: 'mm' }));
  }
});

test('zijdematen volgen de eigen schaal en eenheid van het meetvlak', () => {
  const ann = meetvlak();
  selecteer(ann);
  updateAnnotProp('measureScale', '10');
  updateAnnotProp('measureUnit', 'cm');
  assert.deepEqual(meas.vlakZijdeTeksten(ann).map((z) => z.tekst),
    ['100.0 cm', '50.0 cm', '100.0 cm', '50.0 cm']);
});

test('zijdematen staan uit tot de gebruiker ze aanzet', () => {
  const ann = meetvlak();
  selecteer(ann);
  assert.equal(annotProps.measureShowEdgeLengths, false);
  updateAnnotProp('measureShowEdgeLengths', true);
  assert.equal(ann.measureShowEdgeLengths, true);
  assert.equal(annotProps.measureShowEdgeLengths, true);
});

test('gereedschapsstandaard: nieuwe meetvlakken volgen de voorkeur, standaard uit', () => {
  assert.equal(DEFAULT_PREFERENCES.measureAreaShowEdgeLengths, false);
  openen([]);
  const punten = () => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  const oud = state.preferences.measureAreaShowEdgeLengths;
  try {
    state.preferences.measureAreaShowEdgeLengths = false;
    assert.notEqual(createMeasureAreaAnnotation(punten()).measureShowEdgeLengths, true);
    state.preferences.measureAreaShowEdgeLengths = true;
    assert.equal(createMeasureAreaAnnotation(punten()).measureShowEdgeLengths, true);
  } finally {
    state.preferences.measureAreaShowEdgeLengths = oud;
  }
});
