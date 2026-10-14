import assert from 'node:assert/strict';
import test from 'node:test';
import { sleepKader, HANDVATTEN } from './embedded-image-drag.js';

const orig = { x: 100, y: 100, width: 200, height: 100 };
const dicht = (a, b) => Math.abs(a - b) < 1e-9;
const gelijk = (k, v) => ['x', 'y', 'width', 'height'].every((s) => dicht(k[s], v[s]));

test('acht handvatten met unieke namen', () => {
  assert.equal(new Set(HANDVATTEN.map((h) => h.naam)).size, 8);
});

test('verplaatsen laat de maat staan', () => {
  assert.ok(gelijk(sleepKader(orig, 'move', 30, -20), { x: 130, y: 80, width: 200, height: 100 }));
});

test('zijkanten schalen vrij in een richting', () => {
  assert.ok(gelijk(sleepKader(orig, 'r', 50, 99), { x: 100, y: 100, width: 250, height: 100 }));
  assert.ok(gelijk(sleepKader(orig, 'l', -40, 0), { x: 60, y: 100, width: 240, height: 100 }));
  assert.ok(gelijk(sleepKader(orig, 'b', 7, 25), { x: 100, y: 100, width: 200, height: 125 }));
  assert.ok(gelijk(sleepKader(orig, 't', 0, -30), { x: 100, y: 70, width: 200, height: 130 }));
});

test('een hoek behoudt de verhouding en laat de tegenoverliggende hoek staan', () => {
  const k = sleepKader(orig, 'br', 100, 10);
  assert.ok(dicht(k.width / k.height, 2));
  assert.ok(dicht(k.x, 100) && dicht(k.y, 100));
  const l = sleepKader(orig, 'tl', -40, -5);
  assert.ok(dicht(l.width / l.height, 2));
  assert.ok(dicht(l.x + l.width, 300) && dicht(l.y + l.height, 200));
});

test('met vrij mag een hoek vervormen', () => {
  const k = sleepKader(orig, 'br', 100, 10, { vrij: true });
  assert.ok(gelijk(k, { x: 100, y: 100, width: 300, height: 110 }));
});

test('nooit omklappen of onder het minimum', () => {
  const k = sleepKader(orig, 'r', -500, 0, { min: 8 });
  assert.ok(k.width >= 8 - 1e-9 && k.x === 100);
  const h = sleepKader(orig, 'tl', 900, 900, { min: 8 });
  assert.ok(h.width >= 8 - 1e-9 && h.height >= 4 - 1e-9);
});
