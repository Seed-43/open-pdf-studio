// Appearance van een schaalgebied (#611): vulling en rand met de alfa's die
// het scherm ook gebruikt.

import assert from 'node:assert/strict';
import test from 'node:test';

import { schaalgebiedAppearance } from './scale-region-ap.js';

const basis = { type: 'scaleRegion', x: 10, y: 20, width: 200, height: 150, color: '#ff9800', lineWidth: 1.5 };

test('standaard: vulling op 10 % en rand op 100 %, oranje, gestreept zoals het scherm', () => {
  const ap = schaalgebiedAppearance({ ...basis, opacity: 1 });
  assert.deepEqual(ap.bbox, [0, 0, 200, 150]);
  assert.deepEqual(ap.extGState, { GSv: { ca: 0.1 }, GSr: { CA: 1 } });
  assert.match(ap.inhoud, /\/GSv gs\n1 0\.5961 0 rg\n0 0 200 150 re f/);
  assert.match(ap.inhoud, /\/GSr gs\n1\.5 w\n\[6 3\] 0 d\n1 0\.5961 0 RG\n0 0 200 150 re S/);
  // Vulling vóór de rand, zoals op het scherm.
  assert.ok(ap.inhoud.indexOf(' re f') < ap.inhoud.indexOf(' re S'));
});

test('de vul-doorzichtigheid komt als /ca in de appearance, de doorzichtigheid als /CA', () => {
  const ap = schaalgebiedAppearance({ ...basis, opacity: 0.5, fillOpacity: 0.5 });
  assert.equal(ap.extGState.GSv.ca, 0.5);
  assert.equal(ap.extGState.GSr.CA, 0.5);
  const vol = schaalgebiedAppearance({ ...basis, opacity: 1, fillOpacity: 1 });
  assert.equal(vol.extGState.GSv.ca, 1);
});

test('eigen vulkleur in de vulling, randkleur in de rand', () => {
  const ap = schaalgebiedAppearance({ ...basis, color: '#0000ff', fillColor: '#00ff00' });
  assert.match(ap.inhoud, /0 1 0 rg/);
  assert.match(ap.inhoud, /0 0 1 RG/);
});

test('vul-doorzichtigheid 0: geen vulling; alles 0: bewust leeg (geen verzonnen rand)', () => {
  const zonderVulling = schaalgebiedAppearance({ ...basis, fillOpacity: 0 });
  assert.ok(!zonderVulling.extGState.GSv);
  assert.ok(!/ re f/.test(zonderVulling.inhoud));
  assert.match(zonderVulling.inhoud, / re S/);

  const leeg = schaalgebiedAppearance({ ...basis, opacity: 0 });
  assert.deepEqual(leeg.extGState, {});
  assert.equal(leeg.inhoud, '0 0 200 150 re n\n');
});

test('zonder maat geen appearance', () => {
  assert.equal(schaalgebiedAppearance({ ...basis, width: 0 }), null);
  assert.equal(schaalgebiedAppearance(null), null);
});
