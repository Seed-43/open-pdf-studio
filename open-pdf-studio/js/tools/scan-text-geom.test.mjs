import assert from 'node:assert/strict';
import test from 'node:test';
import { woordKader, schatLettergrootte, ruimerKader, bemonsterKleuren, naarHex } from './scan-text-geom.js';

const dicht = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const YFLIP = [1, 0, 0, -1, 0, 842]; // paginahoogte 842, zonder draaiing

test('woordKader: OCR-woord (verankerd onderaan) naar app-ruimte met y-spiegeling', () => {
  // woord op x=45,1 y=638,4 (onderrand) met breedte 42,7 en hoogte 13,4 in PDF-ruimte
  const k = woordKader({ transform: [13.4, 0, 0, 13.4, 45.1, 638.4], width: 42.7, height: 13.4 }, YFLIP);
  assert.ok(dicht(k.x, 45.1) && dicht(k.width, 42.7) && dicht(k.height, 13.4));
  assert.ok(dicht(k.y, 842 - 638.4 - 13.4)); // bovenrand op het scherm
});

test('woordKader: 90 graden gedraaide pagina wisselt breedte en hoogte', () => {
  const k = woordKader({ transform: [10, 0, 0, 10, 100, 200], width: 40, height: 10 }, [0, 1, 1, 0, 0, 0]);
  assert.ok(dicht(k.width, 10) && dicht(k.height, 40));
});

test('lettergrootte en ruimer kader', () => {
  assert.equal(schatLettergrootte(13.4), 11);
  assert.equal(schatLettergrootte(3), 6);
  const r = ruimerKader({ x: 10, y: 20, width: 30, height: 12 }, 2, 1.5);
  assert.deepEqual(r, { x: 8, y: 18.5, width: 34, height: 15 });
});

function pagina(b, h, kleur) {
  const a = new Uint8ClampedArray(b * h * 4);
  for (let i = 0; i < b * h; i++) { a[i * 4] = kleur[0]; a[i * 4 + 1] = kleur[1]; a[i * 4 + 2] = kleur[2]; a[i * 4 + 3] = 255; }
  return a;
}
function verf(a, b, kader, kleur) {
  for (let y = kader.y; y < kader.y + kader.height; y++) {
    for (let x = kader.x; x < kader.x + kader.width; x++) {
      const i = (y * b + x) * 4; a[i] = kleur[0]; a[i + 1] = kleur[1]; a[i + 2] = kleur[2];
    }
  }
}

test('bemonsterKleuren: witte pagina met zwarte letters', () => {
  const b = 60; const h = 30;
  const px = pagina(b, h, [255, 255, 255]);
  verf(px, b, { x: 20, y: 12, width: 20, height: 3 }, [0, 0, 0]);
  const k = bemonsterKleuren(px, b, h, { x: 18, y: 8, width: 24, height: 12 });
  assert.equal(k.achtergrond, '#ffffff');
  assert.equal(k.inkt, '#000000');
});

test('bemonsterKleuren: gekleurd papier en blauwe inkt worden overgenomen', () => {
  const b = 60; const h = 30;
  const px = pagina(b, h, [250, 240, 200]);
  verf(px, b, { x: 20, y: 12, width: 20, height: 3 }, [20, 40, 200]);
  const k = bemonsterKleuren(px, b, h, { x: 18, y: 8, width: 24, height: 12 });
  assert.equal(k.achtergrond, naarHex(250, 240, 200));
  assert.equal(k.inkt, naarHex(20, 40, 200));
});

test('bemonsterKleuren: bijna-wit "inkt" (geen echte tekst) valt terug op zwart', () => {
  const px = pagina(40, 20, [255, 255, 255]);
  const k = bemonsterKleuren(px, 40, 20, { x: 10, y: 5, width: 15, height: 8 });
  assert.equal(k.inkt, '#000000');
});

test('bemonsterKleuren houdt rekening met de paginarand', () => {
  const px = pagina(20, 20, [255, 255, 255]);
  const k = bemonsterKleuren(px, 20, 20, { x: -5, y: -5, width: 12, height: 12 });
  assert.equal(k.achtergrond, '#ffffff');
});
