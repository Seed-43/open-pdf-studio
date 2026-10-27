// Het paginanummer in XFDF telt vanaf 0 (de export schrijft page - 1). Het
// importeren las het als paginanummer vanaf 1, waardoor alles vanaf pagina 2
// een pagina te vroeg terugkwam (#383: importeren vanuit het paneel).

import assert from 'node:assert/strict';
import test from 'node:test';

import { paginaUitXfdf } from './xfdf-pagina.js';

test('page telt vanaf 0', () => {
  assert.equal(paginaUitXfdf('0'), 1);
  assert.equal(paginaUitXfdf('1'), 2);
  assert.equal(paginaUitXfdf('41'), 42);
});

test('zonder of met een onbruikbaar attribuut: pagina 1', () => {
  assert.equal(paginaUitXfdf(null), 1);
  assert.equal(paginaUitXfdf(''), 1);
  assert.equal(paginaUitXfdf('abc'), 1);
  assert.equal(paginaUitXfdf('-1'), 1);
});
