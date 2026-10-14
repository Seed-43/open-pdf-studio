// De testhulp voor synthetische .oppx-pakketten (#550): een geldig,
// ongecomprimeerd ZIP met een eigen CRC32, ook op Node 20.

import assert from 'node:assert/strict';
import test from 'node:test';

import { crc32, maakZip, maakOppx, leesZip } from './oppx-testpakket.mjs';

test('CRC32 volgens de standaard', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('een ZIP met bestanden en een map is terug te lezen, met kloppende CRC', () => {
  const zip = maakZip([{ naam: 'a.txt', inhoud: 'hallo' }, { naam: 'map/' }, { naam: 'map/b.txt', inhoud: 'wereld é' }]);
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const items = leesZip(zip);
  assert.deepEqual(items.map((i) => i.naam), ['a.txt', 'map/', 'map/b.txt']);
  assert.equal(new TextDecoder().decode(items[2].data), 'wereld é');
  for (const i of items) assert.equal(i.crc, crc32(i.data));
});

test('een .oppx heeft plugin.json en index.js in de wortel; onveilige namen kunnen voor tests', () => {
  const oppx = maakOppx({ id: 'nl.voorbeeld.kozijnen', version: '1.0.0', code: 'export function activate() {}',
    extra: [{ naam: '../buiten.txt', inhoud: 'x' }] });
  const items = leesZip(oppx);
  assert.deepEqual(items.map((i) => i.naam), ['plugin.json', 'index.js', '../buiten.txt']);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(items[0].data)), { id: 'nl.voorbeeld.kozijnen', name: 'nl.voorbeeld.kozijnen', version: '1.0.0' });
});
