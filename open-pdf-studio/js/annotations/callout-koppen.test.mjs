// Koppen van de aanhaallijn van een callout (#612): de punt aan het einde van
// de lijn (End), de kop waar de lijn het tekstvak verlaat (Start). Scherm en
// opgeslagen appearance gebruiken dezelfde berekening.

import assert from 'node:assert/strict';
import test from 'node:test';

import { calloutLeiderKoppen } from './callout-koppen.js';

const bij = (a, b, wat) => assert.ok(Math.abs(a - b) < 1e-9, `${wat}: ${a} ≠ ${b}`);

const basis = { arm: { x: 200, y: 100 }, knie: { x: 170, y: 100 }, tip: { x: 100, y: 160 }, lineWidth: 1, headSize: 7 };

test('de punt wijst van de knie naar de punt, de start-kop van de knie naar het tekstvak', () => {
  const r = calloutLeiderKoppen({ ...basis, startHead: 'circle', endHead: 'diamond' });
  assert.equal(r.eind.stijl, 'diamond');
  bij(r.eind.x, 100, 'eind x'); bij(r.eind.y, 160, 'eind y');
  bij(r.eind.hoek, Math.atan2(60, -70), 'eindhoek');
  assert.equal(r.begin.stijl, 'circle');
  bij(r.begin.x, 200, 'begin x'); bij(r.begin.y, 100, 'begin y');
  bij(r.begin.hoek, 0, 'beginhoek (van de knie naar rechts)');
});

test('geen kop: geen kop en de lijn tot aan het punt', () => {
  const r = calloutLeiderKoppen({ ...basis, startHead: 'none', endHead: 'none' });
  assert.equal(r.begin, null);
  assert.equal(r.eind, null);
  assert.deepEqual(r.lijn, [basis.arm, basis.knie, basis.tip]);
});

test('een gevulde kop kort de lijn in tot in de kop, een open kop nauwelijks', () => {
  const r = calloutLeiderKoppen({ ...basis, arm: { x: 200, y: 100 }, knie: { x: 150, y: 100 }, tip: { x: 100, y: 100 },
    startHead: 'open', endHead: 'closed', headSize: 10, lineWidth: 4 });
  // Punt: dicht → half de kopgrootte terug (de driehoek is daar breed genoeg).
  bij(r.lijn[2].x, 105, 'lijn eindigt in de dichte punt');
  // Start: open → hoogstens een halve lijndikte, maximaal 1.
  bij(r.lijn[0].x, 199, 'lijn begint vlak bij de open kop');
  bij(r.lijn[1].x, 150, 'de knie blijft staan');
});

test('een holle dichte kop (headFill false) laat de lijn doorlopen als een open kop', () => {
  const r = calloutLeiderKoppen({ ...basis, knie: { x: 150, y: 160 }, endHead: 'closed', hol: true, lineWidth: 1 });
  bij(r.lijn[2].x, 100.5, 'een halve lijndikte');
});

test('knie op de punt (een /CL met twee punten): de richting komt van het tekstvak', () => {
  const r = calloutLeiderKoppen({ ...basis, knie: { x: 100, y: 160 }, startHead: 'square', endHead: 'closed' });
  bij(r.eind.hoek, Math.atan2(60, -100), 'eindhoek van arm naar punt');
  bij(r.begin.hoek, Math.atan2(-60, 100), 'beginhoek van punt naar arm');
  // De knie schuift met de ingekorte punt mee: de lijn stopt in de kop.
  assert.deepEqual(r.lijn[1], r.lijn[2]);
  assert.ok(Math.hypot(r.lijn[2].x - 100, r.lijn[2].y - 160) > 1);
});

test('ronde aanhaallijn: de koppen volgen de raaklijn van de kromme en de lijn blijft heel', () => {
  const r = calloutLeiderKoppen({ ...basis, startHead: 'closed', endHead: 'closed', gebogen: true });
  assert.deepEqual(r.lijn, [basis.arm, basis.knie, basis.tip]);
  assert.ok(Number.isFinite(r.eind.hoek) && Number.isFinite(r.begin.hoek));
  // Grofweg dezelfde richting als de rechte lijn.
  assert.ok(Math.cos(r.eind.hoek - Math.atan2(60, -70)) > 0.7);
  assert.ok(Math.cos(r.begin.hoek - 0) > 0.7);
});
