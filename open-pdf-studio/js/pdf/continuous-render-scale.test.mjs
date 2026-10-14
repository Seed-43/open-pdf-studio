// Unit-tests voor de renderschaal van een pagina in de doorlopende weergave
// (issue #549: doorlopend wazig t.o.v. enkele pagina op 125%/150% Windows-
// schaal). De PDFium-bitmap moet in apparaat-pixels gerenderd worden, net als
// in de enkele-paginaweergave (bitmap-orchestrator: zoom × dpr).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { continuousRenderScale } from './continuous-render-scale.js';

const A4 = { w: 595.303937007874, h: 841.889763779528 }; // pt
const CAP = 4096;

function schaalVoor({ scale, dpr, pagina = A4, maxAxisPx = CAP }) {
  return continuousRenderScale({
    scale, dpr,
    viewWidth: pagina.w * scale,
    viewHeight: pagina.h * scale,
    maxAxisPx,
  });
}

test('150% Windows-schaal: bitmap heeft dpr apparaat-pixels per CSS-pixel', () => {
  const s = schaalVoor({ scale: 1, dpr: 1.5 });
  assert.equal(s, 1.5);
  // Zelfde maat als de enkele-paginaweergave meet: 893 px voor 595 CSS-px.
  assert.equal(Math.round(A4.w * s), 893);
});

test('renderschaal = zoom × dpr op elke gangbare schaalfactor', () => {
  for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
    for (const scale of [0.5, 1, 1.5, 2]) {
      assert.equal(schaalVoor({ scale, dpr }), scale * dpr, `scale ${scale}, dpr ${dpr}`);
    }
  }
});

test('ongeldige dpr telt als 1', () => {
  for (const dpr of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(schaalVoor({ scale: 1.25, dpr }), 1.25, `dpr ${dpr}`);
  }
});

test('as-cap geldt voor de bitmap in apparaat-pixels', () => {
  // A0 op 400% bij 150%: de bitmap blijft binnen de cap.
  const A0 = { w: 2383.94, h: 3370.39 };
  const s = schaalVoor({ scale: 4, dpr: 1.5, pagina: A0 });
  assert.ok(Math.max(A0.w, A0.h) * s <= CAP + 1e-6, `as ${Math.max(A0.w, A0.h) * s}`);
  assert.ok(Math.abs(Math.max(A0.w, A0.h) * s - CAP) < 1e-6, 'benut de cap volledig');
});

test('pagina onder de cap in CSS-px maar erboven in apparaat-px wordt begrensd', () => {
  // 3000 CSS-px hoog × 1,5 = 4500 apparaat-px > 4096.
  const pagina = { w: 2000, h: 3000 };
  const s = schaalVoor({ scale: 1, dpr: 1.5, pagina });
  assert.ok(Math.abs(pagina.h * s - CAP) < 1e-6, `as ${pagina.h * s}`);
  assert.ok(s > 1, 'scherper dan de oude 1 px per CSS-px');
});

test('renderContinuousPage rendert PDFium op de dpr-bewuste schaal', () => {
  const bron = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(bron.includes("import { continuousRenderScale } from './continuous-render-scale.js';"),
    'renderer.js importeert continuousRenderScale');
  const start = bron.indexOf('async function renderContinuousPage(');
  const eind = bron.indexOf('\nexport async function ', start);
  assert.ok(start >= 0 && eind > start, 'renderContinuousPage gevonden');
  const fn = bron.slice(start, eind);
  assert.match(fn, /const renderScale = continuousRenderScale\(\{[\s\S]{0,200}dpr: getCanvasDPR\(\)/,
    'renderScale komt uit continuousRenderScale met de dpr');
  assert.doesNotMatch(fn, /doc\.scale \* \(CONT_MAX_AXIS_PX \/ _maxViewAxis\)/, 'geen inline schaal zonder dpr meer');
  assert.match(fn, /scale: renderScale,/, 'PDFium krijgt die schaal');
});
