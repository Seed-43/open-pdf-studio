// node --test js/pdf/host-versies.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { ordenVersies, aantalVersies, hostVersieLabel } from './host-versies.js';

test('het aantal versies: het hoogste nummer, anders de lengte van de lijst', () => {
  assert.equal(aantalVersies(ordenVersies([{ version: '1' }, { version: '3' }, { version: '2' }])), 3);
  assert.equal(aantalVersies(ordenVersies([{ version: 'b' }, { version: 'a' }])), 2);
  assert.equal(aantalVersies([]), null);
});

test('"Versie 3 van 5 – alleen-lezen" voor een oudere versie (#712)', () => {
  const t = (s, o) => `${s}:${JSON.stringify(o)}`;
  assert.equal(hostVersieLabel({ hostVersie: { versie: 3, totaal: 5 } }, t), 'hostVersionReadOnly:{"version":3,"total":5}');
  assert.equal(hostVersieLabel({ hostVersie: { versie: 3, totaal: null } }, t), 'hostVersionReadOnlyShort:{"version":3}');
  assert.equal(hostVersieLabel({}, t), null);
  assert.equal(hostVersieLabel(null, t), null);
});

test('versienummers: nieuwste eerst, de hoogste is de huidige', () => {
  const uit = ordenVersies([
    { version: '1', modified: '2026-10-01 08:00:00', author: 'beheer@klant.example' },
    { version: '10', modified: '2026-10-21 10:00:00', author: 'a@klant.example' },
    { version: 2, modified: '2026-10-20 09:00:00' },
  ]);
  assert.deepEqual(uit.map((v) => v.version), ['10', '2', '1']);
  assert.deepEqual(uit.map((v) => v.huidig), [true, false, false]);
  assert.equal(uit[1].author, null);
  assert.equal(uit[0].modified, '2026-10-21 10:00:00');
});

test('zonder nummers: volgorde van de site, geen huidige', () => {
  const uit = ordenVersies([{ version: 'b' }, { version: 'a' }]);
  assert.deepEqual(uit.map((v) => v.version), ['b', 'a']);
  assert.ok(uit.every((v) => !v.huidig));
});

test('rommel van de site valt weg', () => {
  assert.deepEqual(ordenVersies(null), []);
  assert.deepEqual(ordenVersies('x'), []);
  const uit = ordenVersies([null, 3, {}, { version: '' }, { version: null }, { version: '4', modified: 5, author: {} }]);
  assert.deepEqual(uit, [{ version: '4', modified: null, author: null, huidig: true }]);
});
