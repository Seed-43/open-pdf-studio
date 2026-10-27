// Decoded 3D models (#599): at most two kept, most recently used first out
// last, and those of closed documents dropped.
import assert from 'node:assert/strict';
import test from 'node:test';

import { decodedKey, getDecoded, putDecoded, pruneDecoded, decodedCount } from './decoded-cache.js';

test('keeps the two most recently used models and drops closed documents', () => {
  const a = { page: 1, rect: [0, 0, 10, 10] }, b = { page: 2, rect: null };
  assert.equal(decodedKey('d1', a), 'd1:1:0,0,10,10');
  assert.equal(decodedKey('d1', b), 'd1:2:');
  putDecoded('k1', 'd1', 'one');
  putDecoded('k2', 'd2', 'two');
  assert.equal(getDecoded('k1'), 'one'); // k1 is now the most recent
  putDecoded('k3', 'd3', 'three');
  assert.equal(getDecoded('k2'), null);
  assert.equal(decodedCount(), 2);
  pruneDecoded(['d3']);
  assert.equal(getDecoded('k1'), null);
  assert.equal(getDecoded('k3'), 'three');
  pruneDecoded([]);
  assert.equal(decodedCount(), 0);
});
