// Schaalgebied in het eigenschappenpaneel (#611): het paneel toont de
// knoppen die werken — kleur (rand), vulkleur zonder "geen", doorzichtigheid
// (rand) en vul-doorzichtigheid — met de waarden die getekend worden, en
// schrijft ze in het model.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { DEFAULT_PREFERENCES } = await import('../../core/constants.ts');
const {
  storeShowProperties, storeShowMultiSelection, annotProps, sectionVis, updateAnnotProp,
} = await import('./propertiesStore.js');
const { schaalgebiedStijl } = await import('../../annotations/scale-region-style.js');

function openen(annotations) {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

function gebied(extra = {}) {
  return {
    id: `sg-${Math.random().toString(36).slice(2, 8)}`, type: 'scaleRegion', page: 1,
    x: 100, y: 100, width: 200, height: 150, scaleString: '1:100', units: 'mm', label: '',
    color: '#ff9800', lineWidth: 1.5, borderStyle: 'dashed', opacity: 1,
    createdAt: '2026-10-19T10:00:00.000Z', modifiedAt: '2026-10-19T10:00:00.000Z',
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

test.beforeEach(() => {
  state.preferences = { ...DEFAULT_PREFERENCES };
});

test('een schaalgebied toont vulkleur (zonder "geen") en vul-doorzichtigheid, met de getekende waarden', () => {
  selecteer(gebied());
  assert.equal(sectionVis.fillColorGroup, true);
  assert.equal(sectionVis.fillNoneAllowed, false);
  assert.equal(sectionVis.colorGroup, true);
  assert.equal(sectionVis.opacityGroup, true);
  assert.equal(sectionVis.fillOpacityGroup, true);
  assert.equal(sectionVis.lineWidthGroup, true);
  assert.equal(sectionVis.borderStyleGroup, false, 'de rand is altijd gestreept: geen dode keuze');
  assert.equal(annotProps.fillColor, '#ff9800', 'zonder eigen vulkleur: de kleur');
  assert.equal(annotProps.fillOpacity, 10, 'zonder eigen vul-doorzichtigheid: 10 %');
  assert.equal(annotProps.opacity, 100);
});

test('een andere vorm houdt "geen vulling" en krijgt geen vul-doorzichtigheid', () => {
  // Een tekstvak: de rechthoek heeft sinds #685 wel een eigen vul-dekking.
  selecteer({ ...gebied(), type: 'textbox', fillColor: null, strokeColor: '#000000' });
  assert.equal(sectionVis.fillNoneAllowed, true);
  assert.equal(sectionVis.fillOpacityGroup, false);
  assert.equal(sectionVis.aparteDekking, false);
});

test('rechthoek, ellips, veelhoek en wolk: lijndekking en vuldekking apart (#685)', () => {
  for (const type of ['box', 'circle', 'polygon', 'cloud']) {
    const ann = { ...gebied(), type, fillColor: '#ffff00', strokeColor: '#ff0000', opacity: 0.6 };
    selecteer(ann);
    assert.equal(sectionVis.fillOpacityGroup, true, type);
    assert.equal(sectionVis.aparteDekking, true, type);
    assert.equal(annotProps.fillOpacity, 60, `${type}: een oud bestand toont de vulling op de dekking`);
    // De lijn wijzigen laat de vulling staan.
    updateAnnotProp('opacity', 100);
    assert.equal(ann.opacity, 1);
    assert.equal(ann.fillOpacity, 0.6, type);
    updateAnnotProp('fillOpacity', 25);
    assert.equal(ann.fillOpacity, 0.25);
    assert.equal(ann.opacity, 1);
  }
  // Meervoudige selectie van vormen: dezelfde twee velden.
  const a = { ...gebied(), type: 'box', fillColor: '#ffff00', opacity: 1, fillOpacity: 0.3 };
  const b = { ...gebied(), type: 'circle', fillColor: '#00ffff', opacity: 1, fillOpacity: 0.3 };
  const doc = openen([a, b]);
  doc.selectedAnnotations = [a, b];
  storeShowMultiSelection([a, b]);
  assert.equal(sectionVis.aparteDekking, true);
  assert.equal(annotProps.fillOpacity, 30);
  updateAnnotProp('opacity', 40);
  assert.deepEqual([a.opacity, a.fillOpacity, b.opacity, b.fillOpacity], [0.4, 0.3, 0.4, 0.3]);
});

test('de vul-doorzichtigheid schrijft een eigen waarde; de doorzichtigheid blijft voor de rand', () => {
  const ann = gebied();
  selecteer(ann);
  for (const v of [0, 50, 100]) {
    updateAnnotProp('fillOpacity', v);
    assert.equal(ann.fillOpacity, v / 100);
    assert.equal(annotProps.fillOpacity, v);
    assert.equal(schaalgebiedStijl(ann).vulAlfa, v / 100);
  }
  updateAnnotProp('opacity', 40);
  assert.equal(ann.opacity, 0.4);
  assert.equal(ann.fillOpacity, 1, 'de eigen vul-doorzichtigheid blijft staan');
  assert.equal(schaalgebiedStijl(ann).randAlfa, 0.4);
});

test('zonder eigen waarde volgt de getoonde vulling de doorzichtigheid en de kleur', () => {
  const ann = gebied();
  selecteer(ann);
  updateAnnotProp('opacity', 50);
  assert.equal(annotProps.fillOpacity, 5);
  assert.equal(ann.fillOpacity, undefined, 'niets vastgezet');
  updateAnnotProp('color', '#0000ff');
  assert.equal(annotProps.fillColor, '#0000ff');
  updateAnnotProp('fillColor', '#00aa00');
  assert.equal(ann.fillColor, '#00aa00');
  updateAnnotProp('color', '#ff0000');
  assert.equal(annotProps.fillColor, '#00aa00', 'een eigen vulkleur blijft');
});

test('meerdere schaalgebieden: gedeelde vul-doorzichtigheid, schrijven op allemaal', () => {
  const a = gebied();
  const b = gebied({ fillOpacity: 0.1 });
  const doc = openen([a, b]);
  doc.selectedAnnotations = [a, b];
  storeShowMultiSelection([a, b]);
  assert.equal(sectionVis.fillOpacityGroup, true);
  assert.equal(sectionVis.fillNoneAllowed, false);
  assert.equal(annotProps.fillOpacity, 10, 'standaard en 10 % zien er hetzelfde uit');
  updateAnnotProp('fillOpacity', 60);
  assert.equal(a.fillOpacity, 0.6);
  assert.equal(b.fillOpacity, 0.6);
});
