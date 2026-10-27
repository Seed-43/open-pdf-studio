// Callout plaatsen in twee klikken (#613): klik 1 = de punt, klik 2 = waar het
// tekstvak komt. Een sleep plaatst hem zoals altijd in één gebaar.

import assert from 'node:assert/strict';
import test from 'node:test';

import { maakCalloutPlaatsing } from './callout-plaatsing.js';

const p = (x, y) => ({ x, y });

test('klik 1 onthoudt de punt en maakt nog niets, klik 2 plaatst', () => {
  const pl = maakCalloutPlaatsing();
  assert.equal(pl.actief, false);
  assert.deepEqual(pl.loslaten({ start: p(100, 100), eind: p(100.5, 100), klik: true, pagina: 1 }), { soort: 'punt' });
  assert.equal(pl.actief, true);
  assert.deepEqual(pl.punt, { x: 100, y: 100, pagina: 1 });
  // Klik 2: de muis ging op het nieuwe punt omlaag en weer omhoog.
  const r = pl.loslaten({ start: p(300, 220), eind: p(300, 220), klik: true, pagina: 1 });
  assert.deepEqual(r, { soort: 'plaats', punt: p(100, 100), notitie: p(300, 220) });
  assert.equal(pl.actief, false, 'na het plaatsen begint een nieuwe callout weer bij klik 1');
});

test('een sleep zonder openstaande punt plaatst zoals altijd in één gebaar', () => {
  const pl = maakCalloutPlaatsing();
  assert.deepEqual(pl.loslaten({ start: p(100, 100), eind: p(300, 220), klik: false, pagina: 1 }),
    { soort: 'plaats', punt: p(100, 100), notitie: p(300, 220) });
  assert.equal(pl.actief, false);
});

test('klik 2 als sleep: het tekstvak komt waar de muis loslaat', () => {
  const pl = maakCalloutPlaatsing();
  pl.loslaten({ start: p(100, 100), eind: p(100, 100), klik: true, pagina: 1 });
  assert.deepEqual(pl.loslaten({ start: p(200, 200), eind: p(320, 260), klik: false, pagina: 1 }),
    { soort: 'plaats', punt: p(100, 100), notitie: p(320, 260) });
});

test('Esc of een andere tool: de punt vervalt, de volgende klik is weer klik 1', () => {
  const pl = maakCalloutPlaatsing();
  pl.loslaten({ start: p(100, 100), eind: p(100, 100), klik: true, pagina: 1 });
  pl.stop();
  assert.equal(pl.actief, false);
  assert.deepEqual(pl.loslaten({ start: p(300, 220), eind: p(300, 220), klik: true, pagina: 1 }), { soort: 'punt' });
  assert.deepEqual(pl.punt, { x: 300, y: 220, pagina: 1 });
});

test('klik 2 op een andere pagina begint opnieuw: punt en tekstvak horen op één pagina', () => {
  const pl = maakCalloutPlaatsing();
  pl.loslaten({ start: p(100, 100), eind: p(100, 100), klik: true, pagina: 1 });
  assert.deepEqual(pl.loslaten({ start: p(50, 60), eind: p(50, 60), klik: true, pagina: 2 }), { soort: 'punt' });
  assert.deepEqual(pl.punt, { x: 50, y: 60, pagina: 2 });
});

test('een punt met een ongeldige coördinaat wordt niet onthouden', () => {
  const pl = maakCalloutPlaatsing();
  assert.deepEqual(pl.loslaten({ start: p(NaN, 100), eind: p(NaN, 100), klik: true, pagina: 1 }), { soort: 'niets' });
  assert.equal(pl.actief, false);
});
