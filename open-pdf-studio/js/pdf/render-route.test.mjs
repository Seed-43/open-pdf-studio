import assert from 'node:assert/strict';
import test from 'node:test';

import { pdfjsFallbackNodig, rustRenderPadBeschikbaar } from './render-route.js';

test('bureaublad met bestandspad: PDFium tekent, PDF.js blijft eraf', () => {
  assert.equal(
    pdfjsFallbackNodig({ inTauri: true, hasFilePath: true }),
    false,
  );
});

test('webversie: bestandsNAAM zonder Tauri moet door PDF.js getekend worden (#355)', () => {
  // De browser-bestandskiezer levert "Contract.pdf" als pad. hasFilePath is
  // dus waar, maar zonder Tauri kan PDFium er niets mee.
  assert.equal(
    pdfjsFallbackNodig({ inTauri: false, hasFilePath: true }),
    true,
  );
});

test('leeg document in de bureaubladversie: geen pad, dus PDF.js', () => {
  // Bestand → Nieuw maakt een document zonder pad op schijf.
  assert.equal(
    pdfjsFallbackNodig({ inTauri: true, hasFilePath: false }),
    true,
  );
});

test('webversie zonder pad: ook PDF.js', () => {
  assert.equal(
    pdfjsFallbackNodig({ inTauri: false, hasFilePath: false }),
    true,
  );
});

test('viewport-pad heeft de pagina geclaimd: PDF.js blijft eraf', () => {
  // Twee tekenaars op hetzelfde canvas geeft geflikker; de RAF-lus wint.
  for (const inTauri of [true, false]) {
    for (const hasFilePath of [true, false]) {
      assert.equal(
        pdfjsFallbackNodig({ inTauri, hasFilePath, viewportNamHetOver: true }),
        false,
        `viewport-claim genegeerd bij inTauri=${inTauri} hasFilePath=${hasFilePath}`,
      );
    }
  }
});

test('Android/iOS: Tauri met bestandspad, maar geen PDFium, dus PDF.js (#593)', () => {
  // De APK bevat alleen libapp_lib.so en het pad is een content://-URI: elke
  // Rust-render faalt. Zonder deze regel bleef de pagina wit.
  assert.equal(
    pdfjsFallbackNodig({ inTauri: true, hasFilePath: true, mobiel: true }),
    true,
  );
  assert.equal(
    pdfjsFallbackNodig({ inTauri: true, hasFilePath: false, mobiel: true }),
    true,
  );
});

test('mobiel en viewport-claim: de RAF-lus blijft de enige tekenaar', () => {
  assert.equal(
    pdfjsFallbackNodig({ inTauri: true, hasFilePath: true, mobiel: true, viewportNamHetOver: true }),
    false,
  );
});

test('Rust-renderpad alleen in de bureaubladschil (#593)', () => {
  assert.equal(rustRenderPadBeschikbaar({ inTauri: true }), true);
  assert.equal(rustRenderPadBeschikbaar({ inTauri: true, mobiel: false }), true);
  assert.equal(rustRenderPadBeschikbaar({ inTauri: true, mobiel: true }), false);
  assert.equal(rustRenderPadBeschikbaar({ inTauri: false }), false);
  assert.equal(rustRenderPadBeschikbaar({ inTauri: false, mobiel: true }), false);
});
