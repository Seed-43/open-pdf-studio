import test from 'node:test';
import assert from 'node:assert/strict';
import { cropTemplate, transformTemplate, matchSymbols, planSymbolCounts } from './symbol-matcher.js';

const blank = (width, height) => ({ width, height, pixels: new Uint8Array(width * height) });

function symbol() {
  const t = blank(16, 16);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (x < 5 || y > 10 || x === 10 && y < 7) t.pixels[y * 16 + x] = 1;
  return t;
}

function stamp(image, t, x, y) {
  for (let row = 0; row < t.height; row++) for (let col = 0; col < t.width; col++) image.pixels[(y + row) * image.width + x + col] = t.pixels[row * t.width + col];
}
test('deterministic vector-like and noisy scan fixtures: precision/recall reported', async () => {
  const t = symbol(),
    image = blank(180, 120),
    truth = [{ x: 10, y: 10, t }, { x: 60, y: 10, t: transformTemplate(t, 90, 1) }, { x: 110, y: 15, t: transformTemplate(t, 0, 1.2) }, { x: 25, y: 70, t }];
  for (const s of truth) stamp(image, s.t, s.x, s.y);
  // A few missing/extra scan pixels, and a solid unrelated mark.
  image.pixels[73 * 180 + 28] = 0;
  image.pixels[78 * 180 + 32] = 1;
  for (let y = 70; y < 82; y++) for (let x = 100; x < 112; x++) image.pixels[y * 180 + x] = 1;
  const { matches } = await matchSymbols(image, t, {
    threshold: .75,
    rotations: [0, 90, 180, 270],
    scales: [.8, 1, 1.2],
    yieldTask: async () => {}
  });
  const tp = matches.filter(m => truth.some(s => Math.hypot(m.x - s.x, m.y - s.y) < 3)).length;
  assert.equal(matches.length, 4, JSON.stringify(matches));
  assert.equal(tp, 4);
  console.log('Synthetic mixed fixture: precision=1.00, recall=1.00 (4/4; not a general accuracy claim)');
  const exact = await matchSymbols(image, t, {
    threshold: .95,
    rotations: [0],
    scales: [1],
    yieldTask: async () => {}
  });
  assert.ok(exact.matches.length < 4);
});
test('cancellation rejects without partial output and blank templates fail', async () => {
  const controller = new AbortController();
  await assert.rejects(matchSymbols(blank(100, 100), symbol(), { signal: controller.signal, yieldTask: async () => controller.abort() }), { name: 'AbortError' });
  assert.throws(() => cropTemplate(blank(100, 100), { x: 0, y: 0, width: 20, height: 20 }), /CONTRAST/);
  await assert.rejects(matchSymbols(blank(100, 100), symbol(), { scales: [4] }), /TOLERANCE/);
});
test('only selected matches create counts; repeats and reloaded locations do not duplicate', () => {
  const category = { id: 'doors', name: 'Doors', color: '#ff0000' },
    matches = [{ id: 'a', page: 1, bounds: { x: 10, y: 20, width: 10, height: 10 } }, { id: 'b', page: 2, bounds: { x: 10, y: 20, width: 10, height: 10 } }];
  const first = planSymbolCounts([matches[0]], [], category);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'count');
  assert.equal(first[0].number, 1);
  assert.equal(planSymbolCounts([matches[0]], first, category).length, 0);
  const next = planSymbolCounts(matches, JSON.parse(JSON.stringify(first)), category);
  assert.equal(next.length, 1);
  assert.equal(next[0].page, 2);
  assert.equal(next[0].number, 2);
});
