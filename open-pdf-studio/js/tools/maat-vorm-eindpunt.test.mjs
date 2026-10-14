// Getypte maten voor een vorm (shape-tool.js): dezelfde regels als de lijn.
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCoordBuffer, beperkEindpunt, maatVormEindpunt } from './coord-invoer.js';

const eind = (buf, cursor = { x: 50, y: 30 }, ppu = 1) =>
  maatVormEindpunt(parseCoordBuffer(buf), 0, 0, cursor.x, cursor.y, ppu);
const bijna = (p, x, y) => {
  assert.ok(p, 'een eindpunt');
  assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6, `(${p.x}, ${p.y}) ≠ (${x}, ${y})`);
};

test('polair: dezelfde hoekrichting als de lijn-tool (positief = linksom op het scherm)', () => {
  const p = eind('100<45');
  bijna(p, 70.71067811865476, -70.71067811865476);
  const lijn = beperkEindpunt(parseCoordBuffer('100<45'), 0, 0, 50, 30, 1);
  bijna(p, lijn.x, lijn.y);
});

test('cartesisch: breedte en hoogte in meeteenheden', () => {
  bijna(eind('500,300', undefined, 2), 1000, 600);
});

test('half ingevuld valt terug op de cursor, niet op de oorsprong of hoogte nul', () => {
  bijna(eind('='), 50, 30);
  bijna(eind('500,'), 500, 30);
  bijna(eind('=120,'), 120, 30);
  bijna(eind('=120,80'), 120, 80);
});

test('één getal: vierkant / diameter in het kwadrant van de cursor', () => {
  bijna(eind('240', { x: 10, y: 5 }), 240, 240);
  bijna(eind('240', { x: -10, y: 5 }), -240, 240);
  bijna(eind('240', { x: -10, y: -5 }), -240, -240);
});

test('geen bruikbare invoer: geen eindpunt', () => {
  assert.equal(eind(''), null);
  assert.equal(eind('abc'), null);
  assert.equal(eind('0'), null);
  assert.equal(eind('-5'), null);
});
