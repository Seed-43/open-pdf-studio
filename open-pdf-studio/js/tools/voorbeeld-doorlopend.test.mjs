// Gereedschapsvoorbeelden in de doorlopende weergave (#616).
//
// In de enkele-paginaweergave is de overlay #annotation-canvas het zichtbare
// canvas. In de doorlopende weergave (ook boek en dubbele pagina) heeft elke
// pagina een eigen .annotation-canvas en staat de overlay niet op het scherm.
// Het rubberen kader van het knipgereedschap, het schaalgebied, de ruit van
// stretch, het vormvoorbeeld (rechthoek, callout, ...) en de snap-indicator
// werden op de overlay getekend en waren daardoor onzichtbaar; de basis-
// hertekening liep via de enkele-paginaroute, zodat een vorig voorbeeld op het
// paginacanvas bleef staan.
//
// De echte bronnen draaien hier met alleen hun imports vervangen (die trekken
// de DOM, de state en SolidJS mee).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let _nr = 0;

// De bronnen lezen window.__pdfViewport; zonder viewport = de weergave zonder
// vector-viewport (doorlopend, of een document zonder bestandspad).
globalThis.window = globalThis.window || {};

/**
 * Laadt een bronbestand met elke import (en elke her-export uit een ander
 * bestand) vervangen door een stub. Namen zonder eigen stub worden een
 * functie die niets doet; dynamische imports lossen op in een leeg object.
 */
async function laadMetStubs(relPad, stubs = {}) {
  const namen = new Set();
  const bron = readFileSync(new URL(relPad, import.meta.url), 'utf8')
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, (_, wat) => {
      const binnen = wat.replace(/[{}]/g, ' ');
      for (const deel of binnen.split(',')) {
        const naam = deel.trim().split(/\s+as\s+/).pop().trim();
        if (naam) namen.add(naam);
      }
      return '';
    })
    .replace(/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/\bimport\((['"])[^'"]+\1\)/g, 'Promise.resolve({})');
  const sleutel = `__opdsVoorbeeldStubs${_nr++}`;
  globalThis[sleutel] = stubs;
  const kop = [...namen]
    .map((n) => `const ${n} = globalThis.${sleutel}.${n} ?? (() => undefined);`)
    .join('\n');
  return import('data:text/javascript;base64,' + Buffer.from(`${kop}\n${bron}`, 'utf8').toString('base64'));
}

/** Een 2D-context die elke aanroep en elke toekenning onthoudt. */
function opnameCtx(naam) {
  const log = [];
  const ctx = new Proxy({ naam, log, canvas: { dataset: {} } }, {
    get(doel, prop) {
      if (prop in doel) return doel[prop];
      return (...args) => { log.push([prop, ...args]); };
    },
    set(doel, prop, waarde) {
      log.push(['=' + String(prop), waarde]);
      return true;
    },
  });
  return ctx;
}

const getekend = (ctx, methode) => ctx.log.filter((r) => r[0] === methode);

/** Een wereld per test: document, overlay, paginacanvas en tellers. */
async function wereld(viewMode, { actiefCanvas = null } = {}) {
  const doc = {
    viewMode, scale: 1.5, filePath: 'C:/x.pdf', currentPage: 2,
    annotations: [], selectedAnnotations: [],
  };
  const state = {
    preferences: {}, currentTool: 'box', startX: 10, startY: 20,
    lastSnapResult: null, activeContinuousCanvas: actiefCanvas,
  };
  const overlay = opnameCtx('overlay');
  const teller = { enkel: 0, doorlopend: 0 };
  const redrawAnnotations = () => { teller.enkel++; };
  const redrawContinuous = () => { teller.doorlopend++; };
  const getActiveDocument = () => doc;
  const doelwit = await laadMetStubs('./preview-target.js', {
    state, getActiveDocument, redrawAnnotations, redrawContinuous, annotationCtx: overlay,
  });
  const basis = {
    state, getActiveDocument, redrawAnnotations, redrawContinuous, annotationCtx: overlay,
    redrawForViewMode: doelwit.redrawForViewMode,
    previewCtx: doelwit.previewCtx,
    applyToolTransform: () => {},
    getEffectiveScale: () => doc.scale,
    i18next: { t: (k, o) => o?.defaultValue || k },
  };
  return { doc, state, overlay, teller, basis, doelwit };
}

// ── Het gedeelde doel ──────────────────────────────────────────────────

test('previewCtx: een meegegeven canvas wint, in elke weergave', async () => {
  for (const modus of ['single', 'continuous']) {
    const w = await wereld(modus);
    const pagina = opnameCtx('pagina');
    assert.equal(w.doelwit.previewCtx(pagina), pagina);
  }
});

test('previewCtx zonder doel: overlay in enkele pagina, actief paginacanvas in doorlopend', async () => {
  const pagina = opnameCtx('pagina');
  const canvas = { getContext: () => pagina };
  const enkel = await wereld('single', { actiefCanvas: canvas });
  assert.equal(enkel.doelwit.previewCtx(), enkel.overlay);
  const door = await wereld('continuous', { actiefCanvas: canvas });
  assert.equal(door.doelwit.previewCtx(), pagina);
  // Geen actief paginacanvas: terug naar de overlay (oud gedrag).
  const zonder = await wereld('continuous');
  assert.equal(zonder.doelwit.previewCtx(null), zonder.overlay);
});

test('redrawForViewMode volgt de weergavemodus', async () => {
  const enkel = await wereld('single');
  enkel.doelwit.redrawForViewMode();
  assert.deepEqual(enkel.teller, { enkel: 1, doorlopend: 0 });
  const door = await wereld('continuous');
  door.doelwit.redrawForViewMode();
  assert.deepEqual(door.teller, { enkel: 0, doorlopend: 1 });
});

// ── Vormvoorbeeld (box, callout, lijn, wolk, ...) en snap-indicator ─────

async function laadVormvoorbeeld(w, extra = {}) {
  const drawAnnotation = (ctx, ann) => ctx.fillRect('ann', ann.type);
  const drawSnapIndicator = (ctx) => ctx.arc('snap');
  return laadMetStubs('./shape-preview.js', {
    ...w.basis,
    buildAnnotationProps: (tool) => ({ type: tool }),
    withSymbolInsertFormat: (_t, a) => a,
    getAnnotationType: () => null,
    drawAnnotation, drawSnapIndicator,
    ...extra,
  });
}

test('vormvoorbeeld in doorlopend: op het paginacanvas, met de doorlopende basishertekening', async () => {
  const w = await wereld('continuous');
  w.state.lastSnapResult = { snapped: true, x: 1, y: 2 };
  const { drawShapePreview } = await laadVormvoorbeeld(w);
  const pagina = opnameCtx('pagina');
  drawShapePreview(50, 60, {}, pagina);
  assert.deepEqual(w.teller, { enkel: 0, doorlopend: 1 });
  assert.equal(getekend(pagina, 'fillRect').length, 1, 'het voorbeeld staat op het paginacanvas');
  assert.equal(getekend(pagina, 'arc').length, 1, 'de snap-indicator ook');
  assert.equal(w.overlay.log.length, 0, 'niets op de onzichtbare overlay');
  assert.deepEqual(pagina.log.at(-1), ['restore']);
});

test('vormvoorbeeld in enkele pagina zonder doel: ongewijzigd op de overlay', async () => {
  const w = await wereld('single');
  w.state.lastSnapResult = { snapped: true, x: 1, y: 2 };
  const { drawShapePreview } = await laadVormvoorbeeld(w);
  drawShapePreview(50, 60, {});
  assert.deepEqual(w.teller, { enkel: 1, doorlopend: 0 });
  assert.equal(getekend(w.overlay, 'fillRect').length, 1);
  assert.equal(getekend(w.overlay, 'arc').length, 1);
});

test('plugin-voorbeeld (typeHandler.preview) krijgt het paginacanvas', async () => {
  const w = await wereld('continuous');
  let kreeg = null;
  const { drawShapePreview } = await laadVormvoorbeeld(w, {
    buildAnnotationProps: () => null,
    getAnnotationType: () => ({ preview: (ctx) => { kreeg = ctx; } }),
  });
  const pagina = opnameCtx('pagina');
  drawShapePreview(5, 5, {}, pagina);
  assert.equal(kreeg, pagina);
});

test('tool-context geeft het opgeloste paginacanvas door aan drawShapePreview', async () => {
  const w = await wereld('continuous');
  const aanroepen = [];
  const { buildToolContext } = await laadMetStubs('./tool-context.js', {
    ...w.basis,
    drawShapePreview: (...args) => { aanroepen.push(args); },
    weergaveRotatie: () => 0,
  });
  const pagina = opnameCtx('pagina');
  const ctx = buildToolContext({}, { x: 1, y: 2, pageNum: 3, canvas: {}, canvasCtx: pagina });
  ctx.drawShapePreview(7, 8, { e: 1 });
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0][0], 7);
  assert.equal(aanroepen[0][1], 8);
  assert.equal(aanroepen[0][3], pagina);
  // Een eigen doel van de aanroeper blijft winnen.
  const ander = opnameCtx('ander');
  ctx.drawShapePreview(7, 8, {}, ander);
  assert.equal(aanroepen[1][3], ander);
});

// ── Gereedschappen met een eigen voorbeeld ─────────────────────────────

function toolCtx(w, x, y, canvasCtx) {
  return {
    x, y, pageNum: 2, canvasCtx, canvas: { getContext: () => canvasCtx },
    scale: w.doc.scale, redraw: w.basis.redrawForViewMode,
    findAnnotationAt: () => null,
  };
}

test('knipgereedschap: rubberen kader op het paginacanvas in doorlopend', async () => {
  const w = await wereld('continuous');
  const { vectorSnippetTool } = await laadMetStubs('./tools/vector-snippet-tool.js', w.basis);
  const pagina = opnameCtx('pagina');
  vectorSnippetTool.onPointerDown(toolCtx(w, 10, 10, pagina), { button: 0 });
  vectorSnippetTool.onPointerMove(toolCtx(w, 80, 60, pagina));
  assert.equal(getekend(pagina, 'strokeRect').length, 2);
  assert.deepEqual(getekend(pagina, 'strokeRect').at(-1), ['strokeRect', 10, 10, 70, 50]);
  assert.equal(w.overlay.log.length, 0);
  assert.equal(w.teller.enkel, 0);
  assert.ok(w.teller.doorlopend >= 2);
  vectorSnippetTool.onDeactivate();
});

test('knipgereedschap in enkele pagina: kader op de overlay zoals voorheen', async () => {
  const w = await wereld('single');
  const { vectorSnippetTool } = await laadMetStubs('./tools/vector-snippet-tool.js', w.basis);
  vectorSnippetTool.onPointerDown(toolCtx(w, 10, 10, w.overlay), { button: 0 });
  vectorSnippetTool.onPointerMove(toolCtx(w, 80, 60, w.overlay));
  assert.equal(getekend(w.overlay, 'strokeRect').length, 2);
  assert.equal(w.teller.doorlopend, 0);
  vectorSnippetTool.onDeactivate();
});

test('knipgereedschap: lijndikte volgt de zoom van de weergave, niet een oude viewport', async () => {
  const w = await wereld('continuous');
  // Een inactieve viewport van een eerder enkel-paginadocument met zoom 4.
  globalThis.window.__pdfViewport = { active: false, zoom: 4 };
  try {
    const { vectorSnippetTool } = await laadMetStubs('./tools/vector-snippet-tool.js', w.basis);
    const pagina = opnameCtx('pagina');
    vectorSnippetTool.onPointerDown(toolCtx(w, 10, 10, pagina), { button: 0 });
    const dikte = pagina.log.filter((r) => r[0] === '=lineWidth').at(-1)[1];
    assert.equal(dikte, 1.5 / w.doc.scale);
    vectorSnippetTool.onDeactivate();
  } finally {
    delete globalThis.window.__pdfViewport;
  }
});

test('schaalgebied: oranje kader op het paginacanvas in doorlopend', async () => {
  const w = await wereld('continuous');
  const { scaleRegionTool } = await laadMetStubs('./tools/scale-region-tool.js', w.basis);
  const pagina = opnameCtx('pagina');
  scaleRegionTool.onPointerDown(toolCtx(w, 5, 5, pagina), { button: 0 });
  scaleRegionTool.onPointerMove(toolCtx(w, 45, 25, pagina));
  assert.deepEqual(getekend(pagina, 'strokeRect').at(-1), ['strokeRect', 5, 5, 40, 20]);
  assert.equal(w.overlay.log.length, 0);
  assert.equal(w.teller.enkel, 0);
  scaleRegionTool.onDeactivate();
});

async function laadStretch(w) {
  return laadMetStubs('./tools/stretch-tool.js', {
    ...w.basis,
    cloneAnnotation: (a) => ({ ...a }),
    verticesOf: (a) => [{ x: a.x, y: a.y }],
    canStretch: () => true,
    stretchAnnotation: (orig, ann, dx, dy) => { ann.x = orig.x + dx; ann.y = orig.y + dy; },
    isEditableTarget: () => true,
    isAnnotationPickableInView: () => true,
    raakbaarBijKlik: () => true,
    typeLengthActive: () => false,
    typeLengthBuffer: () => '10,0',
    parseCoordBuffer: () => ({ kind: 'cartesian', a: 10, b: 0 }),
    getMeasureScale: () => ({ pixelsPerUnit: 1 }),
  });
}

test('stretch: ruit op het paginacanvas en na een getypte verplaatsing doorlopend hertekend', async () => {
  const w = await wereld('continuous');
  w.doc.annotations.push({ id: 'a', page: 2, x: 20, y: 20 });
  const { stretchTool } = await laadStretch(w);
  const pagina = opnameCtx('pagina');
  stretchTool.onPointerDown(toolCtx(w, 10, 10, pagina), { button: 0 });
  stretchTool.onPointerMove(toolCtx(w, 40, 40, pagina), {});
  assert.deepEqual(getekend(pagina, 'strokeRect').at(-1), ['strokeRect', 10, 10, 30, 30]);
  assert.equal(w.overlay.log.length, 0);
  assert.equal(w.teller.enkel, 0, 'de ruit hertekent niet via de enkele-paginaroute');

  stretchTool.onPointerUp(toolCtx(w, 40, 40, pagina), {});
  assert.equal(typeof w.state._typeLengthCommit, 'function');
  const voor = w.teller.doorlopend;
  w.state._typeLengthCommit();
  assert.equal(w.doc.annotations[0].x, 30, 'de verplaatsing is toegepast');
  assert.equal(w.teller.enkel, 0, 'het resultaat hertekent niet via de enkele-paginaroute');
  assert.ok(w.teller.doorlopend > voor, 'het resultaat verschijnt op de pagina');
});

test('stretch in enkele pagina: ruit op de overlay zoals voorheen', async () => {
  const w = await wereld('single');
  const { stretchTool } = await laadStretch(w);
  stretchTool.onPointerDown(toolCtx(w, 10, 10, w.overlay), { button: 0 });
  stretchTool.onPointerMove(toolCtx(w, 40, 40, w.overlay), {});
  assert.equal(getekend(w.overlay, 'strokeRect').length, 1);
  assert.equal(w.teller.doorlopend, 0);
  stretchTool.onDeactivate();
});

test('reeks (array): voorbeeld wist het vorige via de doorlopende hertekening', async () => {
  const w = await wereld('continuous');
  w.doc.selectedAnnotations = [{ id: 's', page: 2, x: 0, y: 0 }];
  const { arrayTool } = await laadMetStubs('./tools/array-tool.js', {
    ...w.basis,
    cloneForInsert: (a) => ({ ...a }),
    applyMoveGeneric: () => {},
    recordBulkAdd: () => {},
  });
  const pagina = opnameCtx('pagina');
  arrayTool.onPointerDown(toolCtx(w, 0, 0, pagina), { button: 0 });
  arrayTool.onPointerMove(toolCtx(w, 30, 0, pagina), {});
  assert.ok(getekend(pagina, 'lineTo').length >= 1, 'voorbeeld op het paginacanvas');
  assert.equal(w.teller.enkel, 0);
  assert.equal(w.teller.doorlopend, 1);
  arrayTool.onPointerDown(toolCtx(w, 30, 0, pagina), { button: 0 });
  assert.equal(w.teller.enkel, 0);
  assert.equal(w.teller.doorlopend, 2, 'de kopieën verschijnen op de pagina');
  arrayTool.onDeactivate();
});

test('verlengen en trimmen hertekenen in doorlopend via de doorlopende route', async () => {
  const lijn = (id, sx, sy, ex, ey) => ({ id, page: 2, startX: sx, startY: sy, endX: ex, endY: ey });
  for (const [pad, naam] of [['./tools/extend-tool.js', 'extendTool'], ['./tools/trim-tool.js', 'trimTool']]) {
    const w = await wereld('continuous');
    const grens = lijn('g', 50, -50, 50, 50);
    const doelLijn = lijn('d', 0, 0, 30, 0);
    let volgende = grens;
    const mod = await laadMetStubs(pad, {
      ...w.basis,
      lineLineIntersection: () => ({ x: 50, y: 0, t: 1.6, u: 0.5 }),
      cloneAnnotation: (a) => ({ ...a }),
      recordModify: () => {},
      updateStatusMessage: () => {},
    });
    const tool = mod[naam];
    const ctx = { ...toolCtx(w, 40, 0, opnameCtx('p')), findAnnotationAt: () => volgende };
    tool.onPointerDown(ctx, { button: 0 });
    volgende = doelLijn;
    tool.onPointerDown(ctx, { button: 0 });
    assert.equal(w.teller.enkel, 0, `${naam}: geen enkele-paginahertekening`);
    assert.equal(w.teller.doorlopend, 2, `${naam}: grens en resultaat op de pagina`);
  }
});
