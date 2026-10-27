// Een getekende veelhoek houdt zijn hoekpunten over opslaan → heropenen (#622).
//
// De veelhoek-tool plaatst hoek voor hoek; het model bewaart die punten. De
// opslag schrijft ze als /Vertices, de lader leest ze terug. Elk geval gaat
// twee keer door de echte saver en lader (rondgang.testhulp.mjs): dezelfde
// hoekpunten, één annotatie, ook op een gedraaide pagina en na het
// verschuiven van een hoekpunt van een gedraaide veelhoek.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFName } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import {
  veelhoekUitPunten, veelhoekPunten, veelhoekPuntenOpScherm, verplaatsVeelhoekHoekpunt,
} from '../annotations/veelhoek-punten.js';

async function rondgang(modellen, { keer = 2, rotatie = 0 } = {}) {
  let bytes = await leegBlad({ rotatie });
  let huidig = modellen;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig);
    huidig = await laad(bytes);
  }
  return { modellen: huidig, bytes };
}

const basis = {
  id: 'vh', type: 'polygon', page: 1, rotation: 0, color: '#ff0000', strokeColor: '#ff0000',
  fillColor: null, lineWidth: 2, borderStyle: 'solid', opacity: 1, author: 'User',
};

function zelfdePunten(werkelijk, verwacht, wat, tol = 0.02) {
  assert.equal(werkelijk.length, verwacht.length, `${wat}: aantal hoekpunten`);
  werkelijk.forEach((p, i) => {
    assert.ok(Math.abs(p.x - verwacht[i].x) <= tol && Math.abs(p.y - verwacht[i].y) <= tol,
      `${wat}, hoekpunt ${i}: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) i.p.v. (${verwacht[i].x}, ${verwacht[i].y})`);
  });
}

const vijfhoek = [
  { x: 120, y: 140 }, { x: 260, y: 120 }, { x: 300, y: 230 }, { x: 200, y: 320 }, { x: 110, y: 250 },
];
const driehoek = [{ x: 100, y: 400 }, { x: 250, y: 400 }, { x: 160, y: 300 }];

for (const rotatie of [0, 90]) {
  test(`vijf hoekpunten komen terug waar ze geplaatst zijn (pagina ${rotatie}°)`, async () => {
    const { modellen, bytes } = await rondgang([{ ...basis, ...veelhoekUitPunten(vijfhoek) }], { rotatie });
    assert.equal(modellen.length, 1, 'één annotatie, geen dubbeling');
    const [m] = modellen;
    assert.equal(m.type, 'polygon');
    assert.equal(m.sides, 5);
    zelfdePunten(veelhoekPunten(m), vijfhoek, `pagina ${rotatie}°`);
    // In het bestand: vijf hoekpunten, niet de zes van een regelmatige zeshoek.
    const [{ dict }] = await woordenboeken(bytes);
    assert.equal(dict.get(PDFName.of('Vertices')).size(), 10);
  });
}

test('een driehoek: drie hoekpunten in /Vertices en terug', async () => {
  const { modellen } = await rondgang([{ ...basis, ...veelhoekUitPunten(driehoek) }]);
  assert.equal(modellen.length, 1);
  zelfdePunten(veelhoekPunten(modellen[0]), driehoek, 'driehoek');
});

for (const rotatie of [0, 90]) {
  test(`een verschoven hoekpunt van een gedraaide veelhoek blijft staan (pagina ${rotatie}°)`, async () => {
    const getekend = { ...basis, ...veelhoekUitPunten(vijfhoek), rotation: 30 };
    const bewerkt = { ...getekend, ...verplaatsVeelhoekHoekpunt(getekend, 2, 25, 40) };
    const opScherm = veelhoekPuntenOpScherm(bewerkt);
    const { modellen } = await rondgang([bewerkt], { rotatie });
    assert.equal(modellen.length, 1);
    assert.equal(modellen[0].rotation, 30);
    zelfdePunten(veelhoekPuntenOpScherm(modellen[0]), opScherm, `gedraaid, pagina ${rotatie}°`);
  });
}

test('een veelhoek die via zijn vak breder werd, wordt ook zo opgeslagen', async () => {
  // Het vak verandert (maatbadge, paneel), de punten niet: het scherm rekt de
  // punten mee. De opslag schreef tot nu toe de oude punten, zodat de nieuwe
  // maat na heropenen weg was.
  const getekend = { ...basis, ...veelhoekUitPunten(vijfhoek) };
  const breder = { ...getekend, width: getekend.width * 1.5 };
  const { modellen } = await rondgang([breder]);
  zelfdePunten(veelhoekPunten(modellen[0]), veelhoekPunten(breder), 'breder vak');
});

test('een veelhoek met alleen een zijdenaantal blijft de regelmatige n-hoek van zijn vak', async () => {
  const oud = { ...basis, x: 100, y: 100, width: 200, height: 100, sides: 6 };
  const { modellen } = await rondgang([oud]);
  assert.equal(modellen.length, 1);
  const [m] = modellen;
  assert.equal(m.sides, 6);
  // Hoekpunt 0 bovenaan het midden, hoekpunt 3 onderaan.
  const p = veelhoekPunten(m);
  assert.ok(Math.abs(p[0].x - 200) < 0.02 && Math.abs(p[0].y - 100) < 0.02);
  assert.ok(Math.abs(p[3].x - 200) < 0.02 && Math.abs(p[3].y - 200) < 0.02);
});
