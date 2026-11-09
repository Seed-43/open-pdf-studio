import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOnleesbareTekst, isOnleesbareTekstlaag, ONLEESBAAR_AANDEEL } from './pagina-labels.js';

// Lettertypen zonder /ToUnicode: pdf.js geeft glyph-codes in plaats van
// letters. Zo'n vak is niet leeg maar moet toch met OCR gelezen worden.

test('isOnleesbareTekst: stuurtekens, privegebied en U+FFFD', () => {
  assert.equal(isOnleesbareTekst('%5\u0015'), true);
  assert.equal(isOnleesbareTekst('\u0014\u001c\u0017\u0013'), true);
  assert.equal(isOnleesbareTekst('A'), true);
  assert.equal(isOnleesbareTekst('S�01'), true);
});

test('isOnleesbareTekst: gewone bladnamen blijven leesbaar', () => {
  for (const t of ['S-101', 'E907 Rev B', 'Blad 3\nvan 12', 'Ø200 – 45°', 'ﬁnal', 'Ü', '']) {
    assert.equal(isOnleesbareTekst(t), false, t);
  }
});

test('isOnleesbareTekstlaag: aandeel over de hele pagina', () => {
  const item = (str) => ({ str });
  assert.equal(isOnleesbareTekstlaag([item('%5\u0015'), item('%%'), item('$\u0014')]), true);
  assert.equal(isOnleesbareTekstlaag([item('GENERAL NOTES'), item('S-101'), item('Scale 1:100')]), false);
  // Een enkel los stuurteken op een verder gewone pagina wantrouwt de pagina niet.
  assert.equal(isOnleesbareTekstlaag([item('GENERAL NOTES AND SPECIFICATION'), item('\u0003')]), false);
  assert.equal(isOnleesbareTekstlaag([]), false);
  assert.ok(ONLEESBAAR_AANDEEL > 0 && ONLEESBAAR_AANDEEL < 1);
});

test('verbeterOcrTekst: $ in een code wordt S', async () => {
  const { verbeterOcrTekst, ocrLezing } = await import('./pagina-labels.js');
  assert.equal(verbeterOcrTekst('$101'), 'S101');
  assert.equal(verbeterOcrTekst('$-101 GENERAL NOTE$'), 'S-101 GENERAL NOTES');
  assert.equal(verbeterOcrTekst('E$01'), 'ES01');
  assert.equal(verbeterOcrTekst('Cost $ 100'), 'Cost $ 100');
  assert.equal(verbeterOcrTekst(''), '');
  const w = { text: '$201', left: 0, top: 0, width: 10, height: 5, confidence: 90 };
  assert.equal(ocrLezing([w], { x: 0, y: 0, width: 20, height: 10 }).tekst, 'S201');
});
