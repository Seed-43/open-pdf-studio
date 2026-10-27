// Split line compare mode (#603): pure helpers for mode logic, line position,
// OLD page transform and zoom-independent handle sizes.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPARE_MODES,
  normalizeCompareMode,
  isSinglePaneMode,
  splitFraction,
  splitOldTransform,
  screenPx,
} from './split-line.js';

test('the three compare modes are overlay, side and split', () => {
  assert.deepEqual([...COMPARE_MODES], ['overlay', 'side', 'split']);
  for (const m of COMPARE_MODES) assert.equal(normalizeCompareMode(m), m);
});

test('unknown modes fall back to overlay', () => {
  for (const m of [undefined, null, '', 'wipe', 'SPLIT', 3]) {
    assert.equal(normalizeCompareMode(m), 'overlay');
  }
});

test('overlay and split share one pane, side-by-side has two', () => {
  assert.equal(isSinglePaneMode('overlay'), true);
  assert.equal(isSinglePaneMode('split'), true);
  assert.equal(isSinglePaneMode('side'), false);
  assert.equal(isSinglePaneMode(undefined), true);
});

test('split fraction follows the pointer inside the page', () => {
  assert.equal(splitFraction(150, 100, 200), 0.25);
  assert.equal(splitFraction(200, 100, 200), 0.5);
  assert.equal(splitFraction(300, 100, 200), 1);
  assert.equal(splitFraction(100, 100, 200), 0);
});

test('split fraction is clamped to 0..1 outside the page', () => {
  assert.equal(splitFraction(-500, 100, 200), 0);
  assert.equal(splitFraction(99, 100, 200), 0);
  assert.equal(splitFraction(301, 100, 200), 1);
  assert.equal(splitFraction(5000, 100, 200), 1);
});

test('split fraction is the same at any zoom (scaled wrapper rect)', () => {
  // Same spot of the page, wrapper rendered at 1x, 2x and 0.5x.
  for (const z of [1, 2, 0.5]) {
    const left = 40;
    const width = 800 * z;
    assert.equal(splitFraction(left + 0.3 * width, left, width), 0.3);
  }
});

test('split fraction gives null without a usable wrapper size', () => {
  assert.equal(splitFraction(10, 0, 0), null);
  assert.equal(splitFraction(10, 0, -5), null);
  assert.equal(splitFraction(10, 0, NaN), null);
  assert.equal(splitFraction(NaN, 0, 100), null);
  assert.equal(splitFraction(10, undefined, 100), null);
});

test('old page transform: zero offset is a plain zero translate', () => {
  assert.equal(splitOldTransform({ dx: 0, dy: 0, rotation: 0 }, 600, 400), 'translate(0px, 0px)');
  assert.equal(splitOldTransform(undefined, 600, 400), 'translate(0px, 0px)');
  assert.equal(splitOldTransform({}, 600, 400), 'translate(0px, 0px)');
});

test('old page transform: dx and dy move the old page in bitmap px', () => {
  assert.equal(splitOldTransform({ dx: 12, dy: -3.5, rotation: 0 }, 600, 400), 'translate(12px, -3.5px)');
  assert.equal(splitOldTransform({ dx: NaN, dy: 7 }, 600, 400), 'translate(0px, 7px)');
});

test('old page transform: rotation turns about the NEW page centre', () => {
  assert.equal(
    splitOldTransform({ dx: 5, dy: 6, rotation: 1.5 }, 600, 400),
    'translate(5px, 6px) translate(300px, 200px) rotate(1.5deg) translate(-300px, -200px)',
  );
});

// Apply the CSS transform list (with transform-origin 0 0) to a point, the way
// the browser does: functions are applied right to left.
function applyCss(transform, [x, y]) {
  const ops = [...transform.matchAll(/(translate|rotate)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
  let p = [x, y];
  for (const [fn, args] of ops.reverse()) {
    if (fn === 'translate') {
      const [a, b] = args.split(',').map((s) => parseFloat(s));
      p = [p[0] + a, p[1] + b];
    } else {
      const r = (parseFloat(args) * Math.PI) / 180;
      p = [p[0] * Math.cos(r) - p[1] * Math.sin(r), p[0] * Math.sin(r) + p[1] * Math.cos(r)];
    }
  }
  return p;
}

// The change detection draws the old page with: translate(dx,dy),
// translate(cx,cy), rotate, translate(-cx,-cy) where c is the NEW page centre.
function applyDetection({ dx, dy, rotation }, w, h, [x, y]) {
  const cx = w / 2;
  const cy = h / 2;
  const r = (rotation * Math.PI) / 180;
  const ux = x - cx;
  const uy = y - cy;
  return [ux * Math.cos(r) - uy * Math.sin(r) + cx + dx, ux * Math.sin(r) + uy * Math.cos(r) + cy + dy];
}

test('old page transform matches the change detection alignment', () => {
  const off = { dx: 14, dy: -9, rotation: 2.5 };
  const w = 900;
  const h = 640;
  const css = splitOldTransform(off, w, h);
  for (const pt of [[0, 0], [900, 0], [450, 320], [123, 600]]) {
    const a = applyCss(css, pt);
    const b = applyDetection(off, w, h, pt);
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${pt} -> ${a} vs ${b}`);
  }
});

test('screen px keeps handle sizes constant under the CSS zoom preview', () => {
  assert.equal(screenPx(18, 1), '18px');
  assert.equal(screenPx(18, 2), '9px');
  assert.equal(screenPx(10, 0.5), '20px');
  assert.equal(screenPx(18, 0), '18px');
  assert.equal(screenPx(18, NaN), '18px');
});
