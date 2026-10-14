// Toetsenbordbediening van de tabstrook en de verdeling van extensietabbladen
// over strook en overloopmenu (#551). Zuivere functies.

import assert from 'node:assert/strict';
import test from 'node:test';

import { volgendeTab, verdeelTabbladen, MEER_KNOP_BREEDTE } from './ribbon-toetsenbord.js';

const TABS = ['home', 'view', 'drawing', 'nl.a.main'];

test('pijl rechts en links, met omloop', () => {
  assert.equal(volgendeTab(TABS, 'home', 'ArrowRight', false), 'view');
  assert.equal(volgendeTab(TABS, 'nl.a.main', 'ArrowRight', false), 'home');
  assert.equal(volgendeTab(TABS, 'home', 'ArrowLeft', false), 'nl.a.main');
  assert.equal(volgendeTab(TABS, 'drawing', 'ArrowLeft', false), 'view');
});

test('Home en End', () => {
  assert.equal(volgendeTab(TABS, 'drawing', 'Home', false), 'home');
  assert.equal(volgendeTab(TABS, 'view', 'End', false), 'nl.a.main');
});

test('RTL spiegelt links en rechts, niet Home en End', () => {
  assert.equal(volgendeTab(TABS, 'home', 'ArrowLeft', true), 'view');
  assert.equal(volgendeTab(TABS, 'home', 'ArrowRight', true), 'nl.a.main');
  assert.equal(volgendeTab(TABS, 'view', 'Home', true), 'home');
});

test('andere toetsen, een lege lijst of een onbekend huidig tabblad', () => {
  assert.equal(volgendeTab(TABS, 'home', 'Enter', false), null);
  assert.equal(volgendeTab([], 'home', 'ArrowRight', false), null);
  assert.equal(volgendeTab(TABS, 'weg', 'ArrowRight', false), 'home');
  assert.equal(volgendeTab(TABS, 'weg', 'ArrowLeft', false), 'nl.a.main');
});

test('verdeelTabbladen: alles past', () => {
  assert.deepEqual(verdeelTabbladen([50, 60, 70], 200, 0), { zichtbaar: [0, 1, 2], verborgen: [] });
  assert.deepEqual(verdeelTabbladen([], 200, -1), { zichtbaar: [], verborgen: [] });
});

test('verdeelTabbladen: de achterste gaan naar het menu, met ruimte voor de »-knop', () => {
  const r = verdeelTabbladen([50, 60, 70], 120, -1);
  assert.deepEqual(r, { zichtbaar: [0], verborgen: [1, 2] });
  assert.ok(50 + MEER_KNOP_BREEDTE <= 120);
  assert.ok(50 + 60 + MEER_KNOP_BREEDTE > 120);
});

test('verdeelTabbladen: het actieve tabblad blijft altijd zichtbaar, in volgorde', () => {
  assert.deepEqual(verdeelTabbladen([50, 60, 70], 120, 2), { zichtbaar: [2], verborgen: [0, 1] });
  assert.deepEqual(verdeelTabbladen([40, 40, 40, 40], 130, 3), { zichtbaar: [0, 3], verborgen: [1, 2] });
  assert.deepEqual(verdeelTabbladen([40, 40, 40, 40], 150, 3), { zichtbaar: [0, 1, 3], verborgen: [2] });
  // Ook als zelfs het actieve tabblad niet past.
  assert.deepEqual(verdeelTabbladen([300, 60], 100, 0), { zichtbaar: [0], verborgen: [1] });
});
