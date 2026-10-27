// Foutmeldingen tonen ook een reden als de fout een string is (#596).
import assert from 'node:assert/strict';
import test from 'node:test';

import { foutBericht } from './fout-bericht.js';

test('een string uit Tauri komt ongewijzigd in de melding', () => {
  assert.equal(foutBericht('Command plugin:fs|read_file not allowed by ACL'),
    'Command plugin:fs|read_file not allowed by ACL');
});

test('een Error geeft zijn message', () => {
  assert.equal(foutBericht(new TypeError('undefined is not a function')), 'undefined is not a function');
});

test('een object met detail of code geeft die tekst', () => {
  assert.equal(foutBericht({ code: 'bestand_weg', detail: 'Het bestand is weg' }), 'Het bestand is weg');
  assert.equal(foutBericht({ code: 'bestand_weg' }), 'bestand_weg');
});

test('nooit een lege melding', () => {
  for (const fout of [undefined, null, '', '   ', new Error(''), {}]) {
    const tekst = foutBericht(fout);
    assert.equal(typeof tekst, 'string');
    assert.ok(tekst.trim().length > 0, `lege tekst voor ${String(fout)}`);
  }
});
