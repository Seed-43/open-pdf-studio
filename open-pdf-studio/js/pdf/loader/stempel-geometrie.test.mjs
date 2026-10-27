// Vak en draaiing van een stempel uit zijn appearance (stempel-geometrie.js),
// en de appearance die de saver ervoor schrijft (saver/stempel-draaiing.js).
// Zonder bestanden: de gegevens van -CP-21 Constructieoverzicht.pdf staan
// hier als getallen.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyseerInhoud, stempelGeometrie, isSchermBeeldOpGedraaidBlad, appearanceNaarPagina, vultBBox,
  kiesStempelWeergave, oudeStempelDraaiing,
} from './stempel-geometrie.js';
import { stempelAppearance, stempelRect } from '../saver/stempel-draaiing.js';

const dichtbij = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} i.p.v. ${b}`);

test('analyseerInhoud: CTM bij Do en bij de eerste re, met q/Q en strings', () => {
  const a = analyseerInhoud('q (een (geneste) string\\) cm) Tj 2 0 0 3 10 20 cm /Img Do Q 0 0 5 6 re W n');
  assert.deepEqual(a.beeldDo, [{ naam: 'Img', ctm: [2, 0, 0, 3, 10, 20] }]);
  assert.deepEqual(a.eersteRe, { ctm: [1, 0, 0, 1, 0, 0], x: 0, y: 0, w: 5, h: 6 });
  assert.deepEqual(a.eersteVerfCtm, [2, 0, 0, 3, 10, 20]);
  // cm's stapelen: de laatste werkt eerst.
  const b = analyseerInhoud('1 0 0 1 50 0 cm 0 1 -1 0 0 0 cm 4 0 0 2 0 0 cm /X Do');
  assert.deepEqual(b.beeldDo[0].ctm, [0, 4, -2, 0, 50, 0]);
  // Onzin geeft lege velden, geen fout.
  assert.deepEqual(analyseerInhoud('<<'), { beeldDo: [], eersteRe: null, eersteVerfCtm: null });
  assert.deepEqual(analyseerInhoud(null).beeldDo, []);
});

test('appearanceNaarPagina: /BBox door /Matrix, omhullende op /Rect', () => {
  // Een Matrix van een kwartslag: de /BBox 200 × 100 wordt 100 × 200 en past op /Rect.
  const m = appearanceNaarPagina([10, 20, 110, 220], [0, 0, 200, 100], [0, 1, -1, 0, 0, 0]);
  const p = (x, y) => ({ x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] });
  assert.deepEqual(p(0, 0), { x: 110, y: 20 });
  assert.deepEqual(p(200, 100), { x: 10, y: 220 });
  assert.equal(appearanceNaarPagina([0, 0, 0, 10], [0, 0, 1, 1], null), null);
});

// De zes schermafdrukken op het /Rotate-90-blad van CP-21: /Rect-maat in
// PDF-ruimte en de pixelmaat van de bitmap.
const CP21 = [
  { rect: [84.560489, 474.66578], px: [1306, 232] },
  { rect: [201.25366, 474.66529], px: [1141, 484] },
  { rect: [139.4638, 213.3713], px: [682, 446] },
  { rect: [129.51679, 260.0494], px: [683, 341] },
  { rect: [326.96708, 474.66627], px: [1138, 784] },
  { rect: [109.92853, 474.66548], px: [1308, 303] },
];

test('CP-21: elke schermafdruk is een oude schermafdruk en komt rechtop, vullend in het schermvak', () => {
  for (const { rect: [bw, bh], px: [pw, ph] } of CP21) {
    const rect = [100, 100, 100 + bw, 100 + bh];
    const ap = { bbox: [0, 0, bw, bh], matrix: null, beeld: { ctm: [bw, 0, 0, bh, 0, 0], pixelW: pw, pixelH: ph } };
    const g = stempelGeometrie({ rect, paginaRotatie: 90, ap, soort: 'beeld' });
    assert.equal(g.schermBeeld, true, `${pw}×${ph}`);
    assert.equal(g.eigenAp, false);
    // /OPS_Rotation -90 draait een oude schermafdruk niet: rechtop in de /Rect.
    assert.deepEqual(kiesStempelWeergave({ geometrie: g, paginaRotatie: 90, opsRotation: -90 }), { rotation: 0, vak: 'rect' });
  }
});

test('kiesStempelWeergave: zoals getekend, behalve een oude /OPS_Rotation en oude schermafdrukken', () => {
  const geo = (o) => ({ rotation: 0, beeldHoek: 0, schermBeeld: false, eigenAp: false, ...o });
  // Eigen saver, geen /OPS_Rotation: precies de appearance.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90, eigenAp: true }), paginaRotatie: 90 }), { rotation: 90, vak: 'ap' });
  // Gedraaid blad, appearance draait de bitmap niet (zoals VO Constructie):
  // zoals getekend, met de pagina mee gedraaid, niet in de staande /Rect geperst.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90 }), paginaRotatie: 90 }), { rotation: 90, vak: 'ap' });
  // ... met een oude /OPS_Rotation (vrijwel vierkant, geen schermafdruk): die draaiing.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90 }), paginaRotatie: 90, opsRotation: -90 }), { rotation: -90, vak: 'rect' });
  // Oude schermafdruk (CP-21): rechtop, de oude /OPS_Rotation telt niet.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90, schermBeeld: true }), paginaRotatie: 90, opsRotation: -90 }), { rotation: 0, vak: 'rect' });
  // Ongedraaid blad, oude /OPS_Rotation (-CP-21-3/-4).
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo(), paginaRotatie: 0, opsRotation: 45 }), { rotation: 45, vak: 'rect' });
  // Oude save op een gedraaid blad: de cm compenseert alleen de pagina.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ beeldHoek: 90 }), paginaRotatie: 90, opsRotation: 30 }), { rotation: 30, vak: 'rect' });
  // /Matrix van een ander programma (-CP-21-2): zoals getekend.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 45, beeldHoek: -45 }), paginaRotatie: 0, matrixHoek: -45 }), { rotation: 45, vak: 'ap' });
  // Een /OPS_Rotation van 0 is geen draaiing: zoals getekend.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90 }), paginaRotatie: 90, opsRotation: 0 }), { rotation: 90, vak: 'ap' });
  // Een eigen appearance mét /OPS_Rotation is een oudere save: oude regels.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ eigenAp: true }), paginaRotatie: 0, opsRotation: 30 }), { rotation: 30, vak: 'rect' });
  assert.equal(kiesStempelWeergave({ geometrie: null }), null);
});

test('kiesStempelWeergave: valt het getekende vak samen met de /Rect op het scherm, dan blijft de /Rect', () => {
  const geo = (o) => ({ rotation: 0, beeldHoek: 0, schermBeeld: false, eigenAp: false, ...o });
  // /Rotate 0: vak 52,86 × 101,38 om (441,24 ; 1022,99), /Rect 52,84 × 101,39 (-CP-21-2).
  const rect = [414.82, 972.3, 467.66, 1073.69];
  const midden = { x: 441.24, y: 1023.0 };
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ breedte: 52.86, hoogte: 101.38, midden }), rect }), { rotation: 0, vak: 'rect' });
  // Een duidelijk ander vak, of een andere draaiing: zoals getekend.
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ breedte: 50, hoogte: 101.38, midden }), rect }), { rotation: 0, vak: 'ap' });
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ breedte: 52.86, hoogte: 101.38, midden: { x: 445, y: 1023 } }), rect }), { rotation: 0, vak: 'ap' });
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 180, breedte: 52.86, hoogte: 101.38, midden }), rect }), { rotation: 180, vak: 'ap' });
  // /Rotate 90: de /Rect staat op het scherm met omgewisselde maten.
  const vo = [56.85, 623.2, 565.32, 862.47]; // 508,47 × 239,27 in PDF-ruimte
  const voMidden = { x: 311.08, y: 742.84 };
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ rotation: 90, breedte: 508.47, hoogte: 239.27, midden: voMidden }), paginaRotatie: 90, rect: vo }),
    { rotation: 90, vak: 'ap' }, 'VO: liggend vak met de pagina mee gedraaid is niet het staande schermvak');
  assert.deepEqual(kiesStempelWeergave({ geometrie: geo({ breedte: 239.27, hoogte: 508.47, midden: voMidden }), paginaRotatie: 90, rect: vo }),
    { rotation: 0, vak: 'rect' }, 'rechtop getekend in het schermvak: hetzelfde');
});

test('oudeStempelDraaiing: /OPS_Rotation, anders /Matrix min de pagina-/Rotate', () => {
  assert.equal(oudeStempelDraaiing({ opsRotation: 30.4 }), 30);
  assert.equal(oudeStempelDraaiing({ opsRotation: 0, matrixHoek: -90, paginaRotatie: 0 }), 90);
  assert.equal(oudeStempelDraaiing({ matrixHoek: 90, paginaRotatie: 90 }), 0);
  assert.equal(oudeStempelDraaiing({ matrixHoek: -90, paginaRotatie: 90 }), 180);
  assert.equal(oudeStempelDraaiing({ matrixHoek: 0.0117, paginaRotatie: 90 }), 0, 'ruis in /Matrix');
  assert.equal(oudeStempelDraaiing({}), 0);
});

test('stempelGeometrie: een clip op precies het beeldvak is een appearance van de eigen saver', () => {
  const p = stempelAppearance({ w: 40, h: 120, paginaRotatie: 90, rotatie: 30 });
  const rect = stempelRect([300, 300, 340, 420], p);
  const a = analyseerInhoud(`q\n${p.prefix}${p.clip}${p.visW} 0 0 ${p.visH} 0 0 cm\n/Img Do\nQ\n`);
  const ap = { bbox: [0, 0, p.bboxW, p.bboxH], beeld: { ctm: a.beeldDo[0].ctm, pixelW: 120, pixelH: 40 }, eersteRe: a.eersteRe };
  assert.equal(stempelGeometrie({ rect, paginaRotatie: 90, ap }).eigenAp, true);
  // Zonder clip, of met een clip op iets anders: niet.
  assert.equal(stempelGeometrie({ rect, paginaRotatie: 90, ap: { ...ap, eersteRe: null } }).eigenAp, false);
  assert.equal(stempelGeometrie({ rect, paginaRotatie: 90, ap: { ...ap, eersteRe: { ...a.eersteRe, w: 10 } } }).eigenAp, false);
});

test('oude schermafdruk: alleen met een duidelijke marge, alleen op een kwartslag gedraaid blad', () => {
  const basis = { paginaRotatie: 90, beeldHoek: 0, pixelW: 1138, pixelH: 784, vakW: 326.97, vakH: 474.67 };
  assert.equal(isSchermBeeldOpGedraaidBlad(basis), true);
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, paginaRotatie: 270 }), true);
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, paginaRotatie: 0 }), false, 'ongedraaid blad');
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, paginaRotatie: 180 }), false, 'halve slag');
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, beeldHoek: 90 }), false, 'appearance draait zelf');
  // Pixels passen bij het ongedraaide vak: gewoon PDF-ruimte.
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, pixelW: 784, pixelH: 1138 }), false);
  // Vrijwel vierkant: niet te onderscheiden, blijft zoals de appearance tekent.
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, pixelW: 100, pixelH: 96, vakW: 200, vakH: 204 }), false);
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, pixelW: 343, pixelH: 328, vakW: 45.4, vakH: 47.48 }), false);
  // Past bij geen van beide: niet raden.
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, pixelW: 3000, pixelH: 784 }), false);
  // Onbekende pixelmaat.
  assert.equal(isSchermBeeldOpGedraaidBlad({ ...basis, pixelW: 0 }), false);
});

test('stempelGeometrie: /Matrix-draaiing van een ander programma geeft draaiing en het ongedraaide vak', () => {
  // -CP-21 Constructieoverzicht-2.pdf: /Rotate 0, /Matrix [0 -1 1 0 0 257.25],
  // /BBox 257,25 × 246, /Rect 45,4 × 47,48 (op schaal).
  const s = 45.4 / 246;
  const rect = [505.33, 141.86, 505.33 + 45.4, 141.86 + 257.25 * s];
  const ap = { bbox: [0, 0, 257.25, 246], matrix: [0, -1, 1, 0, 0, 257.25], beeld: { ctm: [257.25, 0, 0, 246, 0, 0], pixelW: 343, pixelH: 328 } };
  const g = stempelGeometrie({ rect, paginaRotatie: 0, ap });
  assert.equal(g.rotation, 90);
  dichtbij(g.breedte, 257.25 * s, 1e-6, 'breedte langs de beeldas');
  dichtbij(g.hoogte, 45.4, 1e-6, 'hoogte langs de beeldas');
});

test('stempelGeometrie: gespiegeld, scheef of zonder afbeelding is geen eenduidig vak', () => {
  const rect = [0, 0, 100, 50];
  const bbox = [0, 0, 100, 50];
  assert.equal(stempelGeometrie({ rect, ap: { bbox, beeld: { ctm: [100, 0, 0, -50, 0, 50] } } }), null, 'gespiegeld');
  assert.equal(stempelGeometrie({ rect, ap: { bbox, beeld: { ctm: [100, 0, 20, 50, 0, 0] } } }), null, 'scheef');
  assert.equal(stempelGeometrie({ rect, ap: { bbox, beeld: null } }), null, 'geen afbeelding');
  assert.equal(stempelGeometrie({ rect, ap: null }), null);
  assert.equal(stempelGeometrie({ rect, ap: { bbox }, soort: 'tekst' }), null, 'tekst zonder re');
});

test('stempelGeometrie: een afbeelding die maar een deel van de appearance vult, geeft geen vak', () => {
  // Zoals een momentopname-stempel in B3 K-1-1B-e: een tekening met daarin een
  // smalle strook als afbeelding. Dat is niet het vak van de stempel.
  const ap = { bbox: [0, 0, 150, 145], beeld: { ctm: [150, 0, 0, 12, 0, 60], pixelW: 1500, pixelH: 120 } };
  assert.equal(stempelGeometrie({ rect: [0, 0, 150, 145], ap }), null);
  assert.equal(vultBBox([150, 0, 0, 145, 0, 0], [0, 0, 150, 145]), true);
  assert.equal(vultBBox([140, 0, 0, 140, 5, 2], [0, 0, 150, 145]), true, '90 % gedekt');
  assert.equal(vultBBox([150, 0, 0, 12, 0, 60], [0, 0, 150, 145]), false);
});

test('stempelGeometrie: bijgesneden afbeelding geeft het zichtbare venster als vak', () => {
  // Saver: clip 0 0 80 40, beeld 100 × 80 verschoven met -10, -20.
  const ap = { bbox: [0, 0, 80, 40], beeld: { ctm: [100, 0, 0, 80, -10, -20], pixelW: 10, pixelH: 8 } };
  const g = stempelGeometrie({ rect: [0, 0, 80, 40], ap, crop: { left: 0.1, right: 0.1, bottom: 0.25, top: 0.25 } });
  dichtbij(g.breedte, 80, 1e-9, 'breedte');
  dichtbij(g.hoogte, 40, 1e-9, 'hoogte');
  dichtbij(g.midden.x, 40, 1e-9, 'midden x');
  dichtbij(g.midden.y, 20, 1e-9, 'midden y');
});

test('saver en lader zijn elkaars omgekeerde, op elk blad en bij elke draaiing', () => {
  for (const paginaRotatie of [0, 90, 180, 270]) {
    for (const rotatie of [0, 15, 30, 45, 90, 135, 180, -60, -90]) {
      // Ongedraaid vak in de ongedraaide paginaruimte (na het omrekenen).
      const omgewisseld = paginaRotatie === 90 || paginaRotatie === 270;
      const [w, h] = omgewisseld ? [40, 120] : [120, 40];
      const p = stempelAppearance({ w, h, paginaRotatie, rotatie });
      const rect = stempelRect([300, 300, 300 + w, 300 + h], p);
      const inhoud = `q\n${p.prefix}${p.visW} 0 0 ${p.visH} 0 0 cm\n/Img Do\nQ\n`;
      const a = analyseerInhoud(inhoud);
      const g = stempelGeometrie({
        rect, paginaRotatie,
        ap: { bbox: [0, 0, p.bboxW, p.bboxH], matrix: null, beeld: { ctm: a.beeldDo[0].ctm, pixelW: 120, pixelH: 40 } },
      });
      const wat = `/Rotate ${paginaRotatie}, draaiing ${rotatie}`;
      dichtbij(g.rotation, rotatie, 0.01, `${wat}: draaiing`);
      dichtbij(g.breedte, 120, 1e-6, `${wat}: breedte`);
      dichtbij(g.hoogte, 40, 1e-6, `${wat}: hoogte`);
      dichtbij(g.midden.x, 300 + w / 2, 1e-6, `${wat}: midden x`);
      dichtbij(g.midden.y, 300 + h / 2, 1e-6, `${wat}: midden y`);
      assert.equal(g.schermBeeld, false, `${wat}: geen oude schermafdruk`);
    }
  }
});

test('stempelAppearance: zonder draaiing dezelfde draai-cm als de oude pagina-compensatie', () => {
  assert.deepEqual(stempelAppearance({ w: 120, h: 40, paginaRotatie: 0 }),
    { prefix: '', clip: '0 0 120 40 re W n\n', visW: 120, visH: 40, bboxW: 120, bboxH: 40, gedraaid: false });
  const p90 = stempelAppearance({ w: 40, h: 120, paginaRotatie: 90 });
  assert.equal(p90.prefix, '1 0 0 1 20 60 cm\n0 1 -1 0 0 0 cm\n1 0 0 1 -60 -20 cm\n');
  assert.deepEqual([p90.visW, p90.visH, p90.bboxW, p90.bboxH], [120, 40, 40, 120]);
  assert.equal(stempelAppearance({ w: 120, h: 40, paginaRotatie: 180 }).prefix,
    '1 0 0 1 60 20 cm\n-1 0 0 -1 0 0 cm\n1 0 0 1 -60 -20 cm\n');
  assert.equal(stempelAppearance({ w: 40, h: 120, paginaRotatie: 270 }).prefix,
    '1 0 0 1 20 60 cm\n0 -1 1 0 0 0 cm\n1 0 0 1 -60 -20 cm\n');
  // Rauwe PDF-pixels zonder draaiing: ongedraaid en zonder clip terug.
  assert.deepEqual(stempelAppearance({ w: 40, h: 120, paginaRotatie: 90, ruimte: 'pdf' }),
    { prefix: '', clip: '', visW: 40, visH: 120, bboxW: 40, bboxH: 120, gedraaid: false });
  // Geen exponent-notatie in de cm.
  assert.doesNotMatch(stempelAppearance({ w: 120, h: 40, paginaRotatie: 0, rotatie: 89.9999999 }).prefix, /e-/);
});

test('stempelRect: zonder draaiing precies de oude /Rect, met draaiing de omhullende om hetzelfde midden', () => {
  const r = [10.123456789, 20, 130.987654321, 60];
  assert.equal(stempelRect(r, stempelAppearance({ w: r[2] - r[0], h: 40, paginaRotatie: 90 })), r);
  const p = stempelAppearance({ w: 120, h: 40, paginaRotatie: 0, rotatie: 90 });
  assert.deepEqual(stempelRect([0, 0, 120, 40], p), [40, -40, 80, 80]);
});
