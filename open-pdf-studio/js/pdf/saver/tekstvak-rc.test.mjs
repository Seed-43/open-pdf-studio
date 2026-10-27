// Opmaak van een tekstvak in /DS en /RC (#619): zie tekstvak-rc.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { tekstvakRc, dsTekstDecoratie } from './tekstvak-rc.js';

const stijl = { fontSize: 12, fontFamily: 'Arial', color: '#000000' };

test('dsTekstDecoratie: onderstreept, doorgehaald of beide', () => {
  assert.equal(dsTekstDecoratie({}), '');
  assert.equal(dsTekstDecoratie({ fontUnderline: true }), 'text-decoration:underline;');
  assert.equal(dsTekstDecoratie({ fontStrikethrough: true }), 'text-decoration:line-through;');
  assert.equal(dsTekstDecoratie({ fontUnderline: true, fontStrikethrough: true }), 'text-decoration:underline line-through;');
});

test('zonder opmaak per stuk tekst geen /RC', () => {
  assert.equal(tekstvakRc({ text: 'gewoon' }, stijl), null);
  assert.equal(tekstvakRc({ text: 'vet', fontBold: true }, stijl), null);
});

test('een onderstreept vak krijgt de decoratie in een span', () => {
  const rc = tekstvakRc({ text: 'a\nb', fontUnderline: true }, stijl);
  assert.match(rc, /<p><span style="text-decoration:underline">a<\/span><\/p><p><span style="text-decoration:underline">b<\/span><\/p>/);
  assert.match(rc, /style="font:12pt Arial;color:#000000"/);
});

test('runs houden vet, cursief, kleur en decoratie; vet en cursief staan als voorheen', () => {
  const rc = tekstvakRc({
    text: 'een twee drie',
    textRuns: [[
      { text: 'een ', bold: true, italic: true },
      { text: 'twee', strikethrough: true, color: '#ff0000' },
      { text: ' drie' },
    ]],
  }, stijl);
  assert.match(rc, /<p><b><i>een <\/i><\/b><span style="text-decoration:line-through;color:#ff0000">twee<\/span> drie<\/p>/);
});

test('tekens die XML breken worden ontsnapt, een lege regel blijft een regel', () => {
  const rc = tekstvakRc({ text: 'a<b&c\n', fontStrikethrough: true }, stijl);
  assert.match(rc, /a&lt;b&amp;c/);
  assert.match(rc, /<p>&#160;<\/p><\/body>$/);
});
