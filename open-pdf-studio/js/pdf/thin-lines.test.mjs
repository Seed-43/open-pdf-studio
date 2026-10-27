// Thin Lines view mode (#595): the toggle must reach every render path of the
// page itself, not just the annotation overlay, and no cache may hand back a
// picture rendered in the other mode.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import fs from 'node:fs';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

// Tauri bridge stub: records every render command and answers with a 2x1
// bitmap in the [w u32][h u32][rgba] wire format.
const calls = [];
function wire(w = 2, h = 1) {
  const out = new Uint8Array(8 + w * h * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, w, true);
  dv.setUint32(4, h, true);
  return out;
}
globalThis.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'page_content_size') return 0;
      return wire();
    },
  },
};
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
globalThis.createImageBitmap ??= async (src) => ({ width: src.width, height: src.height, close() {} });

const { state } = await import('../core/state.js');
const thin = await import('./thin-lines.js');
const { renderPdfPage } = await import('./engine-router.js');
const pbc = await import('./page-bitmap-cache.js');
const tc = await import('./tile-cache.js');
const { invokeTileRegion } = await import('./progressive-render.js');

function setPref(on) { state.preferences.thinLines = on; }

test('thinLinesOn reads the preference, absent = off', () => {
  assert.equal(thin.thinLinesOn({ thinLines: true }), true);
  assert.equal(thin.thinLinesOn({ thinLines: false }), false);
  assert.equal(thin.thinLinesOn({}), false);
  assert.equal(thin.thinLinesOn(null), false);
});

test('withThinLines adds the flag without touching the other arguments', () => {
  const args = { path: 'a.pdf', pageIndex: 0 };
  assert.deepEqual(thin.withThinLines(args, true), { path: 'a.pdf', pageIndex: 0, thinLines: true });
  assert.deepEqual(args, { path: 'a.pdf', pageIndex: 0 });
  assert.notEqual(thin.thinLinesKey(true), thin.thinLinesKey(false));
});

test('a whole-page render sends the Thin Lines flag to Rust', async () => {
  calls.length = 0;
  setPref(true);
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  setPref(false);
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0 });
  assert.deepEqual(calls.map((c) => [c.cmd, c.args.thinLines]), [
    ['render_pdf_page', true],
    ['render_pdf_page', false],
  ]);
  // An explicit flag (captured when a render started) wins over the preference.
  calls.length = 0;
  await renderPdfPage({ path: 'a.pdf', pageIndex: 0, scale: 1, rotation: 0, thinLines: true });
  assert.equal(calls[0].args.thinLines, true);
});

test('a region (tile) render sends the Thin Lines flag to Rust', async () => {
  calls.length = 0;
  setPref(true);
  await invokeTileRegion({
    path: 'b.pdf', pageIndex: 0, scale: 2, rotation: 0,
    regionXPt: 0, regionYPt: 0, regionWPt: 10, regionHPt: 10,
  });
  setPref(false);
  const region = calls.find((c) => c.cmd === 'render_pdf_page_region');
  assert.ok(region, 'region render invoked');
  assert.equal(region.args.thinLines, true);
});

test('the page bitmap cache keeps both looks apart', async () => {
  pbc.clearAllBitmaps();
  calls.length = 0;
  setPref(false);
  const normal = await pbc.ensureBitmap('c.pdf', 1, 0, 1);
  assert.ok(normal);
  assert.equal(calls.at(-1).args.thinLines, false);
  assert.ok(pbc.getCachedBitmap('c.pdf', 1, 0, 1), 'hit in the same mode');

  setPref(true);
  assert.equal(pbc.getCachedBitmap('c.pdf', 1, 0, 1), null, 'no hit in the other mode');
  assert.equal(pbc.getBestAvailableBitmap('c.pdf', 1, 0, 1), null, 'no fallback from the other mode');
  calls.length = 0;
  const thinEntry = await pbc.ensureBitmap('c.pdf', 1, 0, 1);
  assert.equal(calls.length, 1, 'switching renders again');
  assert.equal(calls[0].args.thinLines, true);
  assert.notEqual(thinEntry, normal);

  // Switching back is a cache hit: the true-width bitmap is still there.
  setPref(false);
  calls.length = 0;
  assert.equal(await pbc.ensureBitmap('c.pdf', 1, 0, 1), normal);
  assert.equal(calls.length, 0);
  // Asking for the other look on purpose (seeding a progressive run).
  assert.equal(pbc.getBestAvailableBitmap('c.pdf', 1, 0, 1, true), thinEntry);
  pbc.clearAllBitmaps();
});

test('an externally built bitmap is filed under the mode it was rendered in', () => {
  pbc.clearAllBitmaps();
  setPref(false);
  const bmp = { close() {} };
  pbc.setCachedBitmapEntry('d.pdf', 1, 0, 1, bmp, 2, 1, 1, true);
  assert.equal(pbc.getCachedBitmap('d.pdf', 1, 0, 1), null);
  assert.equal(pbc.getCachedBitmap('d.pdf', 1, 0, 1, true).bitmap, bmp);
  pbc.clearAllBitmaps();
});

test('the tile cache keeps both looks apart', async () => {
  tc.tileCacheClearAll();
  setPref(false);
  const meta = { regionXpt: 0, regionYpt: 0, regionWpt: 100, regionHpt: 100, zoom: 2, renderScale: 2 };
  await tc.tileCacheSet('e.pdf', 1, 2, 0, '0,0', new ImageData(new Uint8ClampedArray(4), 1, 1), { ...meta, thinLines: false });
  const request = { regionXpt: 10, regionYpt: 10, regionWpt: 20, regionHpt: 20, requiredScale: 2 };
  assert.ok(tc.tileCacheGet('e.pdf', 1, 2, 0, '0,0'));
  assert.ok(tc.tileCacheFindCovering('e.pdf', 1, 0, request));

  setPref(true);
  assert.equal(tc.tileCacheGet('e.pdf', 1, 2, 0, '0,0'), null);
  assert.equal(tc.tileCacheFindCovering('e.pdf', 1, 0, request), null);
  // A tile is filed under the mode it was RENDERED in, not the mode at the
  // moment it arrives (the user may have switched while it rendered).
  await tc.tileCacheSet('e.pdf', 1, 2, 0, '0,0', new ImageData(new Uint8ClampedArray(4), 1, 1), { ...meta, thinLines: false });
  assert.equal(tc.tileCacheGet('e.pdf', 1, 2, 0, '0,0'), null);
  await tc.tileCacheSet('e.pdf', 1, 2, 0, '0,0', new ImageData(new Uint8ClampedArray(4), 1, 1), { ...meta, thinLines: true });
  assert.equal(tc.tileCacheGet('e.pdf', 1, 2, 0, '0,0').regionMeta.thinLines, true);
  assert.ok(tc.tileCacheFindCovering('e.pdf', 1, 0, request));
  setPref(false);
  tc.tileCacheClearAll();
});

test('toggling flips the preference, saves it and re-renders the page view once', () => {
  const prefs = { thinLines: false };
  let saved = 0;
  let refreshed = 0;
  const deps = { prefs, save: () => { saved++; }, refresh: () => { refreshed++; } };
  assert.equal(thin.toggleThinLines(deps), true);
  assert.equal(prefs.thinLines, true);
  assert.deepEqual([saved, refreshed], [1, 1]);
  assert.equal(thin.toggleThinLines(deps), false);
  assert.equal(prefs.thinLines, false);
  assert.deepEqual([saved, refreshed], [2, 2]);
});

test('setting the mode it is already in re-renders nothing', () => {
  const prefs = { thinLines: true };
  let refreshed = 0;
  assert.equal(thin.setThinLines(true, { prefs, save() {}, refresh: () => { refreshed++; } }), false);
  assert.equal(refreshed, 0);
});

test('vector replay strokes a hairline of one device pixel', () => {
  const log = [];
  const ctx = {
    lineWidth: 6,
    save() { log.push('save'); },
    restore() { log.push('restore'); },
    setTransform(...m) { log.push(`setTransform(${m.join(',')})`); },
    stroke() { log.push(`stroke@${this.lineWidth}`); },
  };
  thin.strokeCurrentPath(ctx, false);
  assert.deepEqual(log, ['stroke@6']);
  log.length = 0;
  thin.strokeCurrentPath(ctx, true);
  assert.deepEqual(log, ['save', 'setTransform(1,0,0,1,0,0)', 'stroke@1', 'restore']);
});

test('every Thin Lines switch in the UI goes through the shared toggle', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const file of ['../solid/components/ribbon/ViewTab.jsx', '../tools/keyboard-handlers.js']) {
    const src = read(file);
    assert.match(src, /toggleThinLines\(/, `${file} uses toggleThinLines`);
    assert.doesNotMatch(src, /thinLines\s*=\s*!/, `${file} does not flip the preference itself`);
  }
  assert.match(read('../solid/components/preferences/PreferencesDialog.jsx'), /refreshAfterThinLinesChange\(/);
});
