// Hoekpunten van een veelhoek (#622).
//
// Een veelhoek draagt zijn hoekpunten in `points` (de ongedraaide vorm) met
// het vak (x/y/breedte/hoogte) en de draaiing ernaast. Deze functies zijn de
// ene plek waar tekenen, raken, grepen, snappen en opslaan de punten vandaan
// halen; zie veelhoek-punten.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heeftVeelhoekPunten,
  isBewerkbareVeelhoek,
  veelhoekUitPunten,
  regelmatigeVeelhoekPunten,
  veelhoekPunten,
  veelhoekPuntenOpScherm,
  zetVeelhoekOpScherm,
  verplaatsVeelhoekHoekpunt,
  verwijderVeelhoekHoekpunt,
  voegVeelhoekHoekpuntIn,
  veelhoekDeelBij,
  ruimTekenPuntenOp,
  spiegelVeelhoek,
} from './veelhoek-punten.js';

const bijna = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
function puntenGelijk(werkelijk, verwacht, tol = 1e-6) {
  assert.equal(werkelijk.length, verwacht.length, 'aantal punten');
  werkelijk.forEach((p, i) => {
    assert.ok(bijna(p.x, verwacht[i].x, tol) && bijna(p.y, verwacht[i].y, tol),
      `punt ${i}: (${p.x}, ${p.y}) ≠ (${verwacht[i].x}, ${verwacht[i].y})`);
  });
}

const vijfhoek = [
  { x: 100, y: 100 }, { x: 220, y: 90 }, { x: 260, y: 180 }, { x: 170, y: 250 }, { x: 90, y: 190 },
];

test('veelhoekUitPunten: de punten zoals gegeven, het vak en het aantal zijden volgen eruit', () => {
  const v = veelhoekUitPunten(vijfhoek);
  puntenGelijk(v.points, vijfhoek);
  assert.notEqual(v.points, vijfhoek, 'een kopie, geen gedeelde lijst');
  assert.deepEqual({ x: v.x, y: v.y, width: v.width, height: v.height }, { x: 90, y: 90, width: 170, height: 160 });
  assert.equal(v.sides, 5);
});

test('heeftVeelhoekPunten: alleen een veelhoek met drie of meer bruikbare punten', () => {
  assert.equal(heeftVeelhoekPunten({ type: 'polygon', points: vijfhoek }), true);
  assert.equal(heeftVeelhoekPunten({ type: 'polygon', sides: 6, x: 0, y: 0, width: 10, height: 10 }), false);
  assert.equal(heeftVeelhoekPunten({ type: 'polygon', points: vijfhoek.slice(0, 2) }), false);
  assert.equal(heeftVeelhoekPunten({ type: 'polygon', points: [...vijfhoek.slice(0, 2), { x: NaN, y: 1 }] }), false);
  assert.equal(heeftVeelhoekPunten({ type: 'cloud', points: vijfhoek }), false);
});

test('een telling van een ander programma is geen bewerkbare veelhoek', () => {
  const telling = { type: 'polygon', points: vijfhoek, pdfRaw: { sleutels: { IT: { n: 'PolygonCount' } } } };
  assert.equal(heeftVeelhoekPunten(telling), true);
  assert.equal(isBewerkbareVeelhoek(telling), false);
  assert.equal(isBewerkbareVeelhoek({ type: 'polygon', points: vijfhoek }), true);
});

test('regelmatigeVeelhoekPunten: de ingeschreven n-hoek van het vak, hoekpunt 0 bovenaan', () => {
  const zes = regelmatigeVeelhoekPunten({ x: 0, y: 0, width: 200, height: 100 }, 6);
  assert.equal(zes.length, 6);
  assert.ok(bijna(zes[0].x, 100) && bijna(zes[0].y, 0));
  assert.ok(bijna(zes[3].x, 100) && bijna(zes[3].y, 100));
  const vier = regelmatigeVeelhoekPunten({ x: 10, y: 10, width: 20, height: 20 }, 4);
  assert.equal(vier.length, 4);
});

test('veelhoekPunten: de punten door het vak, zoals het scherm ze tekent', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek) };
  puntenGelijk(veelhoekPunten(v), vijfhoek);
  // Vak twee keer zo breed (greep of paneel): de punten rekken mee.
  const breed = { ...v, width: v.width * 2 };
  const p = veelhoekPunten(breed);
  assert.ok(bijna(p[0].x, 90 + (100 - 90) * 2) && bijna(p[0].y, 100));
  assert.ok(bijna(p[2].x, 90 + (260 - 90) * 2));
  assert.equal(veelhoekPunten({ type: 'polygon', sides: 6, x: 0, y: 0, width: 10, height: 10 }), null);
});

test('veelhoekPuntenOpScherm: om het midden van het vak gedraaid', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]), rotation: 90 };
  const s = veelhoekPuntenOpScherm(v);
  // Midden (50, 25); (0,0) gaat over 90° met de klok mee (y omlaag) naar (75, -25).
  assert.ok(bijna(s[0].x, 75) && bijna(s[0].y, -25), `${s[0].x},${s[0].y}`);
  assert.ok(bijna(s[1].x, 75) && bijna(s[1].y, 75), `${s[1].x},${s[1].y}`);
});

test('zetVeelhoekOpScherm: terug naar ongedraaide punten die op het scherm precies zo staan', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek), rotation: 33 };
  const scherm = veelhoekPuntenOpScherm(v);
  scherm[2] = { x: scherm[2].x + 40, y: scherm[2].y + 25 };
  const nieuw = { ...v, ...zetVeelhoekOpScherm(v, scherm) };
  puntenGelijk(veelhoekPuntenOpScherm(nieuw), scherm, 1e-6);
  assert.equal(nieuw.rotation, 33, 'de hoek blijft');
  // Het vak is de omhullende van de nieuwe punten.
  const xs = nieuw.points.map((p) => p.x), ys = nieuw.points.map((p) => p.y);
  assert.ok(bijna(nieuw.x, Math.min(...xs)) && bijna(nieuw.width, Math.max(...xs) - Math.min(...xs)));
  assert.ok(bijna(nieuw.y, Math.min(...ys)) && bijna(nieuw.height, Math.max(...ys) - Math.min(...ys)));
});

test('verplaatsVeelhoekHoekpunt: alleen dat hoekpunt verschuift, de rest blijft op het scherm staan', () => {
  for (const rotation of [0, 90, 47]) {
    const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek), rotation };
    const voor = veelhoekPuntenOpScherm(v);
    const nieuw = { ...v, ...verplaatsVeelhoekHoekpunt(v, 1, 30, -12) };
    const na = veelhoekPuntenOpScherm(nieuw);
    na.forEach((p, i) => {
      const dx = i === 1 ? 30 : 0, dy = i === 1 ? -12 : 0;
      assert.ok(bijna(p.x, voor[i].x + dx, 1e-6) && bijna(p.y, voor[i].y + dy, 1e-6),
        `rotatie ${rotation}, punt ${i}`);
    });
    assert.equal(nieuw.sides, 5);
  }
});

test('verplaatsVeelhoekHoekpunt met Shift: de verschuiving op een veelvoud van 45°', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek) };
  const nieuw = { ...v, ...verplaatsVeelhoekHoekpunt(v, 0, 50, 4, { shift: true }) };
  assert.ok(bijna(nieuw.points[0].y, 100), 'horizontaal');
});

test('verplaatsVeelhoekHoekpunt lijnt uit op een ander hoekpunt binnen de marge', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek) };
  // Hoekpunt 4 (90,190) naar x ≈ 99 → uitgelijnd op hoekpunt 0 (x = 100).
  const nieuw = { ...v, ...verplaatsVeelhoekHoekpunt(v, 4, 9, 0, { uitlijnTol: 2 }) };
  assert.ok(bijna(veelhoekPunten(nieuw)[4].x, 100));
});

test('verwijderVeelhoekHoekpunt: weigert onder de drie hoekpunten', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek), rotation: 20 };
  const voor = veelhoekPuntenOpScherm(v);
  const vier = { ...v, ...verwijderVeelhoekHoekpunt(v, 2) };
  assert.equal(vier.points.length, 4);
  assert.equal(vier.sides, 4);
  puntenGelijk(veelhoekPuntenOpScherm(vier), [voor[0], voor[1], voor[3], voor[4]]);
  const drie = { type: 'polygon', ...veelhoekUitPunten(vijfhoek.slice(0, 3)) };
  assert.equal(verwijderVeelhoekHoekpunt(drie, 0), null);
});

test('voegVeelhoekHoekpuntIn: een nieuw hoekpunt op de zijde, op het aangegeven punt', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek) };
  const zes = { ...v, ...voegVeelhoekHoekpuntIn(v, 4, { x: 95, y: 150 }) };
  assert.equal(zes.points.length, 6);
  assert.deepEqual(zes.points[5], { x: 95, y: 150 });
  // Zonder punt: het midden van de zijde.
  const midden = { ...v, ...voegVeelhoekHoekpuntIn(v, 0) };
  assert.deepEqual(midden.points[1], { x: 160, y: 95 });
});

test('veelhoekDeelBij: hoekpunt, zijde of niets, op het scherm', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten(vijfhoek) };
  assert.deepEqual(veelhoekDeelBij(v, 101, 101, 4), { kind: 'vertex', nodeIndex: 0 });
  const zijde = veelhoekDeelBij(v, 160, 96, 4);
  assert.equal(zijde.kind, 'edge');
  assert.equal(zijde.edgeIndex, 0);
  // Het punt ligt OP de zijde (loodrecht onder de klik).
  const t = (zijde.punt.x - 100) / 120;
  assert.ok(bijna(zijde.punt.y, 100 - 10 * t, 1e-9) && bijna(zijde.punt.x, 160, 1));
  // De sluitende zijde (laatste → eerste) telt mee.
  assert.equal(veelhoekDeelBij(v, 95, 145, 4)?.edgeIndex, 4);
  assert.equal(veelhoekDeelBij(v, 170, 170, 4), null);
});

test('ruimTekenPuntenOp: dubbele punten van een dubbelklik en een herhaald eerste punt vallen weg', () => {
  const p = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 10.2, y: 10.1 }, { x: 0.1, y: 0 }];
  assert.deepEqual(ruimTekenPuntenOp(p, 0.5), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
});

test('spiegelVeelhoek: de punten gespiegeld in het vak, het vak blijft', () => {
  const v = { type: 'polygon', ...veelhoekUitPunten([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 20, y: 50 }]) };
  const h = { ...v, ...spiegelVeelhoek(v, 'x') };
  puntenGelijk(h.points, [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 50 }]);
  assert.deepEqual([h.x, h.y, h.width, h.height], [v.x, v.y, v.width, v.height]);
  const vert = { ...v, ...spiegelVeelhoek(v, 'y') };
  puntenGelijk(vert.points, [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 20, y: 0 }]);
});
