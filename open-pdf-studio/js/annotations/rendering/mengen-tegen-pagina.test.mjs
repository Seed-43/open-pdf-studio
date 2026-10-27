// Een gemengde annotatie op de doorzichtige overlay (#614): de bijdrage die
// met gewoon 'source-over' over de pagina precies het gemengde beeld geeft.

import assert from 'node:assert/strict';
import test from 'node:test';

import { mengBijdrage } from './mengen-tegen-pagina.js';

const px = (...waarden) => new Uint8ClampedArray(waarden);

/** Wat het scherm laat zien: overlay (RGBA, niet-voorvermenigvuldigd) over de pagina. */
function opPagina(overlay, pagina) {
  const a = overlay[3] / 255;
  return [0, 1, 2].map((c) => overlay[c] * a + pagina[c] * (1 - a));
}

test('dekkend: de bijdrage is gewoon het gemengde beeld', () => {
  const achter = px(200, 100, 50, 255);
  const gemengd = px(200, 100, 0, 255); // vermenigvuldigen met geel
  const vorm = px(255, 255, 0, 255);
  const uit = new Uint8ClampedArray(4);
  mengBijdrage(achter, gemengd, vorm, uit);
  assert.deepEqual([...uit], [200, 100, 0, 255]);
});

test('halfdoorzichtig: over de pagina komt precies het gemengde beeld terug', () => {
  // Rood op 50% vermenigvuldigd met wit papier: B = rood, F = ½·rood + ½·wit.
  const achter = px(255, 255, 255, 255);
  const gemengd = px(255, 128, 128, 255);
  const vorm = px(255, 0, 0, 128);
  const uit = new Uint8ClampedArray(4);
  mengBijdrage(achter, gemengd, vorm, uit);
  assert.equal(uit[3], 128, 'de dekking van de annotatie');
  const scherm = opPagina(uit, [255, 255, 255]);
  scherm.forEach((v, c) => assert.ok(Math.abs(v - gemengd[c]) <= 1.5, `kanaal ${c}: ${v}`));
});

test('waar de annotatie niets tekent blijft de overlay leeg', () => {
  const uit = new Uint8ClampedArray([9, 9, 9, 9]);
  mengBijdrage(px(10, 20, 30, 255), px(10, 20, 30, 255), px(0, 0, 0, 0), uit);
  assert.deepEqual([...uit], [0, 0, 0, 0]);
});

test('afrondingsruis onder nul of boven de dekking wordt geklemd', () => {
  const uit = new Uint8ClampedArray(4);
  // F iets donkerder dan (1-α)·achter kan door 8-bits afronding: geen negatieve kleur.
  mengBijdrage(px(255, 255, 255, 255), px(126, 126, 126, 255), px(0, 0, 0, 128), uit);
  assert.deepEqual([...uit], [0, 0, 0, 128]);
});

test('willekeurige achtergronden: scherm = gemengd binnen één eenheid (meerdere pixels)', () => {
  // Achter = pagina met daarover al een eerdere annotatie; de bijdrage komt
  // boven op die overlay. Wat telt is wat het scherm toont.
  let zaad = 7;
  const r = () => { zaad = (zaad * 16807) % 2147483647; return zaad % 256; };
  const n = 200;
  const pagina = new Uint8ClampedArray(n * 4);
  const onder = new Uint8ClampedArray(n * 4);   // eerdere annotaties op de overlay
  const achter = new Uint8ClampedArray(n * 4);
  const gemengd = new Uint8ClampedArray(n * 4);
  const vorm = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    for (let c = 0; c < 3; c++) { pagina[i + c] = r(); onder[i + c] = r(); }
    pagina[i + 3] = 255;
    onder[i + 3] = r();
    const zicht = opPagina(onder.subarray(i, i + 4), pagina.subarray(i, i + 3));
    for (let c = 0; c < 3; c++) achter[i + c] = Math.round(zicht[c]);
    achter[i + 3] = 255;
    const as = r();
    vorm[i + 3] = as;
    // 'screen' met een willekeurige kleur, op dekking as.
    for (let c = 0; c < 3; c++) {
      const cs = r();
      vorm[i + c] = cs;
      const b = achter[i + c];
      const scr = cs + b - (cs * b) / 255;
      gemengd[i + c] = Math.round((as / 255) * scr + (1 - as / 255) * b);
    }
    gemengd[i + 3] = 255;
  }
  const uit = new Uint8ClampedArray(n * 4);
  mengBijdrage(achter, gemengd, vorm, uit);
  for (let i = 0; i < n * 4; i += 4) {
    // Overlay na de bijdrage = bijdrage over 'onder' (source-over).
    const ao = onder[i + 3] / 255;
    const ab = uit[i + 3] / 255;
    const an = ab + ao * (1 - ab);
    const overlay = [0, 1, 2].map((c) => (an > 0 ? (uit[i + c] * ab + onder[i + c] * ao * (1 - ab)) / an : 0));
    const scherm = [0, 1, 2].map((c) => overlay[c] * an + pagina[i + c] * (1 - an));
    scherm.forEach((v, c) => assert.ok(Math.abs(v - gemengd[i + c]) <= 2.5,
      `pixel ${i / 4} kanaal ${c}: ${v} vs ${gemengd[i + c]} (as ${vorm[i + 3]})`));
  }
});
