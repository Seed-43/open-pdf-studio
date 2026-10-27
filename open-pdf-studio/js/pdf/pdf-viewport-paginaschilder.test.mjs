import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

// Tekstbewerkingen in de enkelpagina-viewport (#669). De annotatie-overlay
// heeft daar de viewportmaat in CSS-pixels (overlay-canvas-size.js); op een
// scherm met devicePixelRatio > 1 rekt de browser hem op. Nieuwe tekst die
// daarop getekend werd, was wazig naast de scherpe paginatekst. De viewport
// geeft de tekstbewerkingen nu aan een paginaschilder die op het paginacanvas
// tekent, met dezelfde devicepixel-transform als de pagina: op elke zoom
// zoom × dpr pixels per punt, met de oorsprong op een hele pixel.
//
// De echte pdf-viewport.js draait hier onder node met een nep-
// requestAnimationFrame, een nep-canvas en vervangen app-modules (zie
// pdf-viewport-test-hooks.mjs).

const wachtrij = new Map();
let volgendId = 1;
globalThis.requestAnimationFrame = (cb) => {
  const id = volgendId++;
  wachtrij.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = (id) => { wachtrij.delete(id); };
function draaiFrames() {
  const nu = [...wachtrij.values()];
  wachtrij.clear();
  for (const cb of nu) cb(performance.now());
  return nu.length;
}

const DPR = 1.5;
const container = { clientWidth: 800, clientHeight: 600, querySelector: () => null };
globalThis.window = { devicePixelRatio: DPR, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  getElementById: (id) => (id === 'pdf-container' ? container : null),
  querySelector: () => null,
};
globalThis.__vpTest = { impl: {} };

register('./pdf-viewport-test-hooks.mjs', import.meta.url);
const vp = await import('./pdf-viewport.js');
const { viewport } = vp;

// Nep-2D-context die de huidige transform bijhoudt (zoals een canvas).
function maakCtx() {
  let m = [1, 0, 0, 1, 0, 0];
  const stapel = [];
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const echt = {
    save: () => stapel.push(m.slice()),
    restore: () => { if (stapel.length) m = stapel.pop(); },
    setTransform: (...t) => { m = t.length === 1 ? [t[0].a, t[0].b, t[0].c, t[0].d, t[0].e, t[0].f] : t.slice(0, 6); },
    transform: (...t) => { m = mul(m, t); },
    scale: (sx, sy) => { m = mul(m, [sx, 0, 0, sy, 0, 0]); },
    translate: (tx, ty) => { m = mul(m, [1, 0, 0, 1, tx, ty]); },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
  };
  return new Proxy(echt, {
    get: (doel, sleutel) => (sleutel in doel ? doel[sleutel] : () => {}),
    set: () => true,
  });
}

test('de paginaschilder tekent op devicepixels: zoom × dpr per punt, op elke zoom', () => {
  const ctx = maakCtx();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  const aanroepen = [];
  const schilder = (c, pageNum) => {
    const t = c.getTransform();
    aanroepen.push({ pageNum, ...t });
  };
  vp.initViewport(canvas, () => {}, schilder);
  vp.setPage('a.pdf', 3, 600, 800, 0, 0, 0, 0);
  draaiFrames();
  assert.equal(canvas.width, 800 * DPR, 'paginacanvas op devicepixels');

  for (const zoom of [0.37, 1, 2.5, 8]) {
    viewport.zoom = zoom;
    viewport.offsetX = 13.3;
    viewport.offsetY = -7.7;
    viewport.dirty = true;
    draaiFrames();
    const laatste = aanroepen.at(-1);
    assert.ok(laatste, `schilder aangeroepen op zoom ${zoom}`);
    assert.equal(laatste.pageNum, 3);
    assert.ok(Math.abs(laatste.a - zoom * DPR) < 1e-9, `schaal ${laatste.a} ≠ ${zoom * DPR}`);
    assert.ok(Math.abs(laatste.d - zoom * DPR) < 1e-9);
    assert.equal(laatste.b, 0);
    assert.equal(laatste.c, 0);
    assert.ok(Number.isInteger(laatste.e) && Number.isInteger(laatste.f),
      `oorsprong op een hele devicepixel (${laatste.e}, ${laatste.f})`);
    assert.ok(Math.abs(laatste.e - viewport.offsetX * DPR) <= 0.5);
  }
});

test('zonder paginaschilder tekent de viewport gewoon de pagina', () => {
  const ctx = maakCtx();
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  vp.initViewport(canvas, () => {});
  vp.setPage('b.pdf', 1, 600, 800, 0, 0, 0, 0);
  assert.doesNotThrow(() => draaiFrames());
});
