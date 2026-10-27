// Plaatsing van een ribbon-popup met position: fixed (#617).

import assert from 'node:assert/strict';
import test from 'node:test';

import { berekenPopupPlek } from './ribbon-popup.js';

const venster = { breedte: 1200, hoogte: 800 };
const knop = { left: 500, right: 540, top: 100, bottom: 122 };

test('onder de knop, links uitgelijnd', () => {
  assert.deepEqual(berekenPopupPlek({ knop, breedte: 200, hoogte: 150, venster }), { left: 500, top: 122 });
});

test('rechts uitgelijnd met de knop', () => {
  assert.deepEqual(berekenPopupPlek({ knop, breedte: 300, hoogte: 150, venster, rechts: true }), { left: 240, top: 122 });
});

test('blijft binnen het venster aan de rechterrand en de linkerrand', () => {
  const rechtsBuiten = { left: 1150, right: 1190, top: 100, bottom: 122 };
  assert.equal(berekenPopupPlek({ knop: rechtsBuiten, breedte: 300, hoogte: 150, venster }).left, 1200 - 300 - 4);
  const linksBuiten = { left: 10, right: 50, top: 100, bottom: 122 };
  assert.equal(berekenPopupPlek({ knop: linksBuiten, breedte: 300, hoogte: 150, venster, rechts: true }).left, 4);
});

test('past hij er onder niet, dan boven de knop', () => {
  const laag = { left: 500, right: 540, top: 700, bottom: 722 };
  assert.deepEqual(berekenPopupPlek({ knop: laag, breedte: 200, hoogte: 150, venster }), { left: 500, top: 550 });
});

test('breder of hoger dan het venster: aan de linker- en bovenrand', () => {
  assert.deepEqual(
    berekenPopupPlek({ knop: { left: 500, right: 540, top: 700, bottom: 722 }, breedte: 2000, hoogte: 900, venster }),
    { left: 4, top: 4 });
});

test('gehele pixels', () => {
  const p = berekenPopupPlek({ knop: { left: 10.4, right: 50.6, top: 20.2, bottom: 41.7 }, breedte: 100, hoogte: 50, venster });
  assert.deepEqual(p, { left: 10, top: 42 });
});
