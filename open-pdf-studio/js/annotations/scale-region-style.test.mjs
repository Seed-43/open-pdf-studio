// Schaalgebied (#611): rand en vulling volgen de eigenschappen van de
// annotatie. Zonder eigen vul-doorzichtigheid blijft het oude uiterlijk (10 %
// van de doorzichtigheid), zodat bestaande documenten er hetzelfde uitzien.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  schaalgebiedStijl, SCHAALGEBIED_KLEUR, SCHAALGEBIED_VULFACTOR,
} from './scale-region-style.js';

test('standaard: oranje rand op 100 %, vulling 10 % in dezelfde kleur (het oude uiterlijk)', () => {
  const s = schaalgebiedStijl({ type: 'scaleRegion' });
  assert.equal(s.randKleur, SCHAALGEBIED_KLEUR);
  assert.equal(s.vulKleur, SCHAALGEBIED_KLEUR);
  assert.equal(s.randAlfa, 1);
  assert.equal(s.vulAlfa, SCHAALGEBIED_VULFACTOR);
  assert.equal(SCHAALGEBIED_VULFACTOR, 0.1);
});

test('zonder eigen vul-doorzichtigheid schaalt de vulling mee met de doorzichtigheid', () => {
  const s = schaalgebiedStijl({ color: '#00aa00', opacity: 0.5 });
  assert.equal(s.randAlfa, 0.5);
  assert.ok(Math.abs(s.vulAlfa - 0.05) < 1e-12);
  assert.equal(s.vulKleur, '#00aa00');
});

test('doorzichtigheid 0 is echt 0 (was: 0 || 1 = volledig zichtbaar)', () => {
  const s = schaalgebiedStijl({ opacity: 0 });
  assert.equal(s.randAlfa, 0);
  assert.equal(s.vulAlfa, 0);
});

test('een eigen vul-doorzichtigheid geldt absoluut, los van de rand', () => {
  for (const v of [0, 0.5, 1]) {
    const s = schaalgebiedStijl({ opacity: 1, fillOpacity: v });
    assert.equal(s.vulAlfa, v, `fillOpacity ${v}`);
    assert.equal(s.randAlfa, 1);
  }
  const half = schaalgebiedStijl({ opacity: 0.3, fillOpacity: 0.8 });
  assert.equal(half.vulAlfa, 0.8);
  assert.equal(half.randAlfa, 0.3);
});

test('waarden buiten 0..1 en onzin worden begrensd of vallen terug', () => {
  assert.equal(schaalgebiedStijl({ opacity: 3 }).randAlfa, 1);
  assert.equal(schaalgebiedStijl({ opacity: -1 }).randAlfa, 0);
  assert.equal(schaalgebiedStijl({ opacity: 'x' }).randAlfa, 1);
  assert.equal(schaalgebiedStijl({ fillOpacity: 2 }).vulAlfa, 1);
  assert.equal(schaalgebiedStijl({ fillOpacity: null, opacity: 1 }).vulAlfa, SCHAALGEBIED_VULFACTOR);
});

test('eigen vulkleur; zonder (of "geen") volgt de vulling de randkleur', () => {
  assert.equal(schaalgebiedStijl({ color: '#112233', fillColor: '#445566' }).vulKleur, '#445566');
  assert.equal(schaalgebiedStijl({ color: '#112233', fillColor: null }).vulKleur, '#112233');
  assert.equal(schaalgebiedStijl({ color: '#112233', fillColor: 'none' }).vulKleur, '#112233');
  assert.equal(schaalgebiedStijl({ color: '#112233', fillColor: 'transparent' }).vulKleur, '#112233');
  assert.equal(schaalgebiedStijl({ color: '', fillColor: undefined }).randKleur, SCHAALGEBIED_KLEUR);
});

// Het scherm: rendering.js wordt in node-tests als stub geladen, dus hier de
// bron. De schaalgebied-tak tekent met deze stijl en niet meer met de vaste
// 10 % of `opacity || 1` (waarmee 0 als 100 % werd getekend).
test('rendering.js tekent het schaalgebied met schaalgebiedStijl', async () => {
  const { readFileSync } = await import('node:fs');
  const bron = readFileSync(new URL('./rendering.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = bron.indexOf("case 'scaleRegion': {");
  assert.ok(start > 0);
  const tak = bron.slice(start, bron.indexOf('\n    case ', start + 10));
  assert.match(tak, /const srStijl = schaalgebiedStijl\(annotation\);/);
  assert.match(tak, /if \(srStijl\.vulAlfa > 0\) \{\s*ctx\.globalAlpha = srStijl\.vulAlfa;\s*ctx\.fillStyle = srStijl\.vulKleur;\s*ctx\.fillRect\(srX, srY, srW, srH\);/);
  assert.match(tak, /ctx\.globalAlpha = srStijl\.randAlfa;\s*ctx\.setLineDash\(\[6, 3\]\);/);
  assert.ok(!/0\.10 \*/.test(tak), 'geen vaste 10 % meer');
  assert.ok(!/annotation\.opacity \|\| 1/.test(tak), 'geen opacity || 1 meer');
});
