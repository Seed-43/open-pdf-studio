// De persoonlijke AI-sleutel komt als gast nooit in de browseropslag (#548):
// op een gedeelde oorsprong kan elk script van de site die lezen.

import assert from 'node:assert/strict';
import test from 'node:test';

const winkel = new Map();
globalThis.localStorage = {
  getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
  setItem: (k, v) => { winkel.set(k, String(v)); },
  removeItem: (k) => { winkel.delete(k); },
};
globalThis.window = {};

const { leesAiSleutel, bewaarAiSleutel } = await import('./ai-sleutel.js');
const { opslagSleutel } = await import('./opslag.js');

const SLEUTEL = opslagSleutel('opds-anthropic-key');

test('met een eigen oorsprong: bewaren, lezen en vergeten', () => {
  winkel.clear();
  assert.equal(bewaarAiSleutel('  sk-test  ', false), true);
  assert.equal(winkel.get(SLEUTEL), 'sk-test');
  assert.equal(leesAiSleutel(false), 'sk-test');
  bewaarAiSleutel('', false);
  assert.equal(winkel.has(SLEUTEL), false);
  assert.equal(leesAiSleutel(false), '');
});

test('een sleutel van vóór het voorvoegsel verhuist mee', () => {
  winkel.clear();
  winkel.set('opds-anthropic-key', 'sk-oud');
  assert.equal(leesAiSleutel(false), 'sk-oud');
  assert.equal(winkel.has('opds-anthropic-key'), false);
  assert.equal(winkel.get(SLEUTEL), 'sk-oud');
});

test('als gast: nooit schrijven, niets lezen en een achtergebleven sleutel weg', () => {
  winkel.clear();
  assert.equal(bewaarAiSleutel('sk-test', true), false);
  assert.equal(winkel.size, 0, 'niets geschreven');
  winkel.set(SLEUTEL, 'sk-achtergebleven');
  assert.equal(leesAiSleutel(true), '');
  assert.equal(winkel.has(SLEUTEL), false, 'opgeruimd');
});

test('het gastobject op de pagina is genoeg om gast te zijn', () => {
  winkel.clear();
  window.__OPDS_HOST__ = {};
  try {
    assert.equal(bewaarAiSleutel('sk-test'), false);
    assert.equal(winkel.size, 0);
  } finally {
    delete window.__OPDS_HOST__;
  }
});
