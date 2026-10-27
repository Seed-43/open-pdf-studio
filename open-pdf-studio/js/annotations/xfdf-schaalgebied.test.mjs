// Schaalgebied in XFDF (#611): vulkleur, vul-doorzichtigheid en
// doorzichtigheid gaan heen en terug; een standaardgebied blijft ongewijzigd.

import assert from 'node:assert/strict';
import test from 'node:test';

import { schaalgebiedXfdfAttributen, schaalgebiedUitXfdf } from './xfdf-schaalgebied.js';

const lezer = (xml) => (naam) => {
  const m = new RegExp(`\\s${naam}="([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

test('een standaard-schaalgebied krijgt geen extra attributen en leest terug als standaard', () => {
  assert.equal(schaalgebiedXfdfAttributen({ type: 'scaleRegion', opacity: 1 }), '');
  assert.deepEqual(schaalgebiedUitXfdf(lezer('')), { opacity: 1, fillColor: undefined, fillOpacity: undefined });
});

test('vulling en doorzichtigheid heen en terug', () => {
  const ann = { type: 'scaleRegion', opacity: 0.5, fillColor: '#00aa00', fillOpacity: 0 };
  const attrs = schaalgebiedXfdfAttributen(ann);
  assert.equal(attrs, ' opacity="0.5" interior-color="#00AA00" opsfillopacity="0"');
  assert.deepEqual(schaalgebiedUitXfdf(lezer(attrs)), { opacity: 0.5, fillColor: '#00AA00', fillOpacity: 0 });
});

test('opacity 0 blijft 0; onzin valt terug', () => {
  assert.equal(schaalgebiedUitXfdf(lezer(' opacity="0"')).opacity, 0);
  assert.equal(schaalgebiedUitXfdf(lezer(' opacity="x" opsfillopacity="7"')).opacity, 1);
  assert.equal(schaalgebiedUitXfdf(lezer(' opsfillopacity="7"')).fillOpacity, undefined);
  assert.equal(schaalgebiedXfdfAttributen({ fillColor: 'none' }), '');
});
