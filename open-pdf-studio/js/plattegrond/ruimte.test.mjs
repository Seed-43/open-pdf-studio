import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shoelace, vlak, omtrek, puntInPolygoon, labelPunt, binnenContour,
  overbrugSparingen, splitsOpAansluitingen, ruimtenUitWanden, ruimteBijZaad, ruimteLabel,
} from './ruimte.js';

const K = 0.5;                       // paginapunten per mm (zie sparing.test)
const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

/** Vier wanden rond een rechthoek van `bMm` x `hMm` (hartlijnen). */
function doos(bMm, hMm, dikteMm = 300, id = 'r') {
  const b = bMm * K, h = hMm * K;
  return [
    { id: `${id}-n`, startX: 0, startY: 0, endX: b, endY: 0, dikteMm },
    { id: `${id}-o`, startX: b, startY: 0, endX: b, endY: h, dikteMm },
    { id: `${id}-z`, startX: b, startY: h, endX: 0, endY: h, dikteMm },
    { id: `${id}-w`, startX: 0, startY: h, endX: 0, endY: 0, dikteMm },
  ];
}

test('oppervlakte, omtrek en het binnen/buiten van een ring', () => {
  const vierkant = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(shoelace(vierkant), 200);
  assert.equal(vlak(vierkant), 100);
  assert.equal(omtrek(vierkant), 40);
  assert.equal(puntInPolygoon({ x: 5, y: 5 }, vierkant), true);
  assert.equal(puntInPolygoon({ x: 15, y: 5 }, vierkant), false);
  assert.equal(puntInPolygoon({ x: 0, y: 5 }, vierkant), true, 'de rand telt mee');
});

test('het label staat altijd ín de ruimte, ook bij een L-vorm', () => {
  const vierkant = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.deepEqual(labelPunt(vierkant), { x: 50, y: 50 });

  // L-vorm waarvan het zwaartepunt in de inkeping valt.
  const el = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 },
    { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 },
  ];
  const zwaartepunt = { x: 0, y: 0 };
  const opp = shoelace(el);
  for (let i = 0; i < el.length; i++) {
    const a = el[i], b = el[(i + 1) % el.length];
    const k = a.x * b.y - b.x * a.y;
    zwaartepunt.x += (a.x + b.x) * k;
    zwaartepunt.y += (a.y + b.y) * k;
  }
  zwaartepunt.x /= 3 * opp; zwaartepunt.y /= 3 * opp;
  assert.equal(puntInPolygoon(zwaartepunt, el), false, 'het zwaartepunt valt hier buiten');
  assert.equal(puntInPolygoon(labelPunt(el), el), true, 'het labelpunt niet');
});

test('de binnencontour ligt een halve wanddikte naar binnen', () => {
  const hart = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const binnen = binnenContour(hart, [10, 10, 10, 10]);
  assert.deepEqual(binnen.map((p) => [p.x, p.y]), [[10, 10], [90, 10], [90, 90], [10, 90]]);
  // Ook als de wanden verschillend dik zijn.
  const ongelijk = binnenContour(hart, [10, 20, 5, 0]);
  assert.deepEqual(ongelijk.map((p) => [p.x, p.y]), [[0, 10], [80, 10], [80, 95], [0, 95]]);
});

test('een gesloten contour levert één ruimte met de netto oppervlakte', () => {
  // Hartlijnen 5000 x 4000 mm, wanden 300 mm → netto 4700 x 3700 = 17,39 m².
  const { ruimten, losseEinden } = ruimtenUitWanden(doos(5000, 4000), { pxPerMm: K });
  assert.equal(losseEinden.length, 0);
  assert.equal(ruimten.length, 1);
  bijna(ruimten[0].oppervlakteM2, 17.39, 1e-6, 'netto oppervlakte');
  bijna(ruimten[0].omtrekM, 16.8, 1e-6, 'netto omtrek');
  assert.equal(ruimten[0].wandIds.length, 4);
  assert.deepEqual(ruimten[0].labelPunt, { x: 1250, y: 1000 });
});

test('de oppervlakte verandert mee als een wand verschuift', () => {
  const wanden = doos(5000, 4000);
  const voor = ruimtenUitWanden(wanden, { pxPerMm: K }).ruimten[0].oppervlakteM2;
  // De oostgevel een meter naar buiten: 6000 x 4000 hart → 5700 x 3700.
  const verschoven = wanden.map((w) => ({
    ...w,
    startX: w.startX === 2500 ? 3000 : w.startX,
    endX: w.endX === 2500 ? 3000 : w.endX,
  }));
  const na = ruimtenUitWanden(verschoven, { pxPerMm: K }).ruimten[0].oppervlakteM2;
  bijna(voor, 17.39, 1e-6, 'voor');
  bijna(na, 21.09, 1e-6, 'na het verschuiven');
});

test('twee ruimten naast elkaar met een gedeelde binnenwand', () => {
  const b = 8000 * K, h = 4000 * K, m = 5000 * K;
  const wanden = [
    { id: 'n1', startX: 0, startY: 0, endX: m, endY: 0, dikteMm: 300 },
    { id: 'n2', startX: m, startY: 0, endX: b, endY: 0, dikteMm: 300 },
    { id: 'o', startX: b, startY: 0, endX: b, endY: h, dikteMm: 300 },
    { id: 'z2', startX: b, startY: h, endX: m, endY: h, dikteMm: 300 },
    { id: 'z1', startX: m, startY: h, endX: 0, endY: h, dikteMm: 300 },
    { id: 'w', startX: 0, startY: h, endX: 0, endY: 0, dikteMm: 300 },
    { id: 'binnen', startX: m, startY: 0, endX: m, endY: h, dikteMm: 100 },
  ];
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: K });
  assert.equal(losseEinden.length, 0);
  assert.equal(ruimten.length, 2);
  // Links: 5000 hart − 150 (buiten) − 50 (binnen) = 4800 x 3700 = 17,76 m².
  bijna(ruimten[0].oppervlakteM2, 17.76, 1e-6, 'grootste ruimte');
  // Rechts: 3000 − 50 − 150 = 2800 x 3700 = 10,36 m².
  bijna(ruimten[1].oppervlakteM2, 10.36, 1e-6, 'kleinste ruimte');
  assert.ok(ruimten[0].wandIds.includes('binnen'));
  assert.ok(ruimten[1].wandIds.includes('binnen'));
});

test('een deuropening onderbreekt de ruimte niet', () => {
  // De noordgevel opgeknipt door een deur van 900 mm rond hart 2000 mm.
  const b = 5000 * K, h = 4000 * K;
  const wanden = [
    { id: 'n-a', startX: 0, startY: 0, endX: 1550 * K, endY: 0, dikteMm: 300 },
    { id: 'n-b', startX: 2450 * K, startY: 0, endX: b, endY: 0, dikteMm: 300 },
    { id: 'o', startX: b, startY: 0, endX: b, endY: h, dikteMm: 300 },
    { id: 'z', startX: b, startY: h, endX: 0, endY: h, dikteMm: 300 },
    { id: 'w', startX: 0, startY: h, endX: 0, endY: 0, dikteMm: 300 },
  ];
  const bruggen = overbrugSparingen(wanden, { maxGatPt: 900 * K });
  assert.equal(bruggen.length, 1, 'het gat van de deur wordt overbrugd');
  assert.equal(bruggen[0].dikteMm, 300);

  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: K });
  assert.equal(losseEinden.length, 0, 'een dagkant is geen los einde');
  assert.equal(ruimten.length, 1);
  bijna(ruimten[0].oppervlakteM2, 17.39, 1e-6, 'even groot als zonder deur');
});

test('een binnenwand die halverwege aansluit knipt de gevel op', () => {
  const ribben = [
    { id: 'gevel', startX: 0, startY: 0, endX: 1000, endY: 0, dikteMm: 300 },
    { id: 'binnen', startX: 400, startY: 0, endX: 400, endY: 500, dikteMm: 100 },
  ];
  const uit = splitsOpAansluitingen(ribben, 1.5);
  assert.equal(uit.length, 3);
  const gevel = uit.filter((r) => r.id === 'gevel');
  assert.deepEqual(gevel.map((r) => [r.startX, r.endX]), [[0, 400], [400, 1000]]);
  assert.equal(gevel[0].dikteMm, 300, 'de deelribben houden hun wand');
  // Een eindpunt dat al een knoop is of naast de hartlijn ligt knipt niet.
  assert.equal(splitsOpAansluitingen([ribben[0]], 1.5).length, 1);
  assert.equal(splitsOpAansluitingen([
    ribben[0], { id: 'los', startX: 400, startY: 40, endX: 400, endY: 500, dikteMm: 100 },
  ], 1.5).filter((r) => r.id === 'gevel').length, 1);
});

test('een T-aansluiting levert twee ruimten, geen één', () => {
  // Doos van 8000 x 8000 mm met één doorlopende gevel per zijde en een
  // binnenwand die halverwege de noord- en zuidgevel aansluit.
  const b = 8000 * K;
  const wanden = [
    ...doos(8000, 8000, 300),
    { id: 'binnen', startX: 5000 * K, startY: 0, endX: 5000 * K, endY: b, dikteMm: 100 },
  ];
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: K });
  assert.equal(losseEinden.length, 0);
  assert.equal(ruimten.length, 2);
  bijna(ruimten[0].oppervlakteM2, 36.96, 1e-6, 'links van de binnenwand');
  bijna(ruimten[1].oppervlakteM2, 21.56, 1e-6, 'rechts ervan');
  assert.ok(ruimten[0].wandIds.includes('binnen'));
  assert.equal(new Set(ruimten[0].wandIds).size, ruimten[0].wandIds.length, 'geen dubbele id\'s');
});

test('een niet-gesloten contour wordt gemeld, niet half gevuld', () => {
  const wanden = doos(5000, 4000).slice(0, 3);       // de westgevel ontbreekt
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: K });
  assert.equal(ruimten.length, 0);
  assert.equal(losseEinden.length, 2);
});

test('een gat dat te groot is om een sparing te zijn blijft een gat', () => {
  const wanden = [
    { id: 'a', startX: 0, startY: 0, endX: 1000, endY: 0, dikteMm: 300 },
    { id: 'b', startX: 2000, startY: 0, endX: 3000, endY: 0, dikteMm: 300 },
  ];
  assert.equal(overbrugSparingen(wanden, { maxGatPt: 500 }).length, 0);
  assert.equal(overbrugSparingen(wanden, { maxGatPt: 1500 }).length, 1);
  // Via ruimtenUitWanden gaat de grens in mm: 1000 pt gat = 2000 mm op K.
  assert.equal(ruimtenUitWanden(wanden, { pxPerMm: K, maxGatMm: 1500 }).losseEinden.length, 4);
  assert.equal(ruimtenUitWanden(wanden, { pxPerMm: K, maxGatMm: 3000 }).losseEinden.length, 2);
  // Haaks op elkaar staande vrije einden worden nooit overbrugd.
  const haaks = [
    { id: 'a', startX: 0, startY: 0, endX: 1000, endY: 0, dikteMm: 300 },
    { id: 'b', startX: 1100, startY: 0, endX: 1100, endY: 900, dikteMm: 300 },
  ];
  assert.equal(overbrugSparingen(haaks, { maxGatPt: 500 }).length, 0);
});

test('het zaadpunt wijst de ruimte aan, ook als de wanden bewegen', () => {
  const b = 8000 * K, h = 4000 * K, m = 5000 * K;
  const wanden = [
    { id: 'n1', startX: 0, startY: 0, endX: m, endY: 0, dikteMm: 300 },
    { id: 'n2', startX: m, startY: 0, endX: b, endY: 0, dikteMm: 300 },
    { id: 'o', startX: b, startY: 0, endX: b, endY: h, dikteMm: 300 },
    { id: 'z2', startX: b, startY: h, endX: m, endY: h, dikteMm: 300 },
    { id: 'z1', startX: m, startY: h, endX: 0, endY: h, dikteMm: 300 },
    { id: 'w', startX: 0, startY: h, endX: 0, endY: 0, dikteMm: 300 },
    { id: 'binnen', startX: m, startY: 0, endX: m, endY: h, dikteMm: 100 },
  ];
  const zaad = { x: 3000 * K, y: 2000 * K };            // links van de binnenwand
  const { ruimten } = ruimtenUitWanden(wanden, { pxPerMm: K });
  const voor = ruimteBijZaad(ruimten, zaad);
  bijna(voor.oppervlakteM2, 17.76, 1e-6, 'ruimte bij het zaad');
  assert.equal(ruimteBijZaad(ruimten, { x: -50, y: -50 }), null, 'buiten elke ruimte');

  // Binnenwand een meter naar links: het zaad ligt nog steeds links ervan,
  // maar de ruimte is kleiner geworden.
  const verplaatst = wanden.map((w) => (w.id === 'binnen'
    ? { ...w, startX: 4000 * K, endX: 4000 * K } : w));
  verplaatst[0] = { ...verplaatst[0], endX: 4000 * K };
  verplaatst[1] = { ...verplaatst[1], startX: 4000 * K };
  verplaatst[3] = { ...verplaatst[3], endX: 4000 * K };
  verplaatst[4] = { ...verplaatst[4], startX: 4000 * K };
  const na = ruimteBijZaad(ruimtenUitWanden(verplaatst, { pxPerMm: K }).ruimten, zaad);
  bijna(na.oppervlakteM2, 14.06, 1e-6, 'na het verplaatsen van de binnenwand');
});

test('de labeltekst is naam plus netto oppervlakte', () => {
  assert.equal(ruimteLabel('Woonkamer', 17.3912), 'Woonkamer\n17.4 m²');
  assert.equal(ruimteLabel('', 8), '8.0 m²');
  assert.equal(ruimteLabel('Hal', 4.25, 2), 'Hal\n4.25 m²');
});

// #552: twee omsloten kamers met twee deuren en een T-aansluiting in de
// onderste gevel. De zoeker mocht uiteinden niet over een kort wandstuk of
// door de T-aansluiting heen koppelen; die overlappende bruggen braken de
// vlakdoorloop en beide ruimten verdwenen.
function tweeKamersMetDeuren() {
  const wand = (id, startX, startY, endX, endY) => ({ id, startX, startY, endX, endY, dikteMm: 160 });
  return [
    wand('links', 0, 0, 0, 140),
    wand('boven', 0, 0, 220, 0),
    wand('rechts', 220, 0, 220, 140),
    wand('tussen', 100, 0, 100, 140),
    wand('onder-links', 0, 140, 40, 140),
    wand('onder-midden-links', 60, 140, 100, 140),
    wand('onder-midden-rechts', 100, 140, 130, 140),
    wand('onder-rechts', 150, 140, 220, 140),
  ];
}

test('#552: bruggen liggen alleen in echte openingen, niet over massieve wand', () => {
  const pxPerMm = 0.025;
  const bruggen = overbrugSparingen(tweeKamersMetDeuren(), { maxGatPt: 3000 * pxPerMm });
  assert.deepEqual(bruggen.map((b) => [b.startX, b.endX]).sort((p, q) => p[0] - q[0]),
    [[40, 60], [130, 150]], 'alleen de twee deuropeningen');
});

test('#552: twee kamers met deuren en een T-aansluiting blijven twee ruimten', () => {
  const pxPerMm = 0.025;
  const wanden = tweeKamersMetDeuren();
  const deuren = [
    { id: 'deur-l', startX: 40, startY: 140, endX: 60, endY: 140, dikteMm: 160, brug: true },
    { id: 'deur-r', startX: 130, startY: 140, endX: 150, endY: 140, dikteMm: 160, brug: true },
  ];
  const controle = ruimtenUitWanden(wanden, { pxPerMm, bruggen: deuren });
  assert.equal(controle.ruimten.length, 2, 'controle met alleen de echte deuren');
  const auto = ruimtenUitWanden(wanden, { pxPerMm });
  assert.equal(auto.ruimten.length, 2);
  assert.deepEqual(auto.losseEinden, []);
  for (let i = 0; i < 2; i++) {
    bijna(auto.ruimten[i].oppervlakteM2, controle.ruimten[i].oppervlakteM2, 1e-9, `ruimte ${i}`);
  }
});

test('#552: een deur breder dan het korte wandstuk ernaast wordt nog overbrugd', () => {
  // Onderste gevel: [0,40] deur 60 [100,115] deur 60 [175,220]. Het korte
  // stuk van 15 ligt tussen twee deuren die elk breder zijn dan dat stuk.
  const wand = (id, startX, startY, endX, endY) => ({ id, startX, startY, endX, endY, dikteMm: 100 });
  const wanden = [
    wand('links', 0, 0, 0, 140),
    wand('boven', 0, 0, 220, 0),
    wand('rechts', 220, 0, 220, 140),
    wand('onder-a', 0, 140, 40, 140),
    wand('onder-b', 100, 140, 115, 140),
    wand('onder-c', 175, 140, 220, 140),
  ];
  const bruggen = overbrugSparingen(wanden, { maxGatPt: 3000 });
  assert.deepEqual(bruggen.map((b) => [b.startX, b.endX]).sort((p, q) => p[0] - q[0]),
    [[40, 100], [115, 175]]);
  const { ruimten, losseEinden } = ruimtenUitWanden(wanden, { pxPerMm: 0.025 });
  assert.equal(ruimten.length, 1);
  assert.equal(losseEinden.length, 0);
});

test('#552: een deur direct naast een T-aansluiting wordt overbrugd', () => {
  // De binnenwand sluit precies aan op de dagkant van de deur [40,100].
  const wand = (id, startX, startY, endX, endY) => ({ id, startX, startY, endX, endY, dikteMm: 100 });
  const wanden = [
    wand('links', 0, 0, 0, 140),
    wand('boven', 0, 0, 220, 0),
    wand('rechts', 220, 0, 220, 140),
    wand('tussen', 100, 0, 100, 140),
    wand('onder-a', 0, 140, 40, 140),
    wand('onder-b', 100, 140, 220, 140),
  ];
  const bruggen = overbrugSparingen(wanden, { maxGatPt: 3000 });
  assert.deepEqual(bruggen.map((b) => [b.startX, b.endX]), [[40, 100]]);
  assert.equal(ruimtenUitWanden(wanden, { pxPerMm: 0.025 }).ruimten.length, 2);
});

test('#552: een wand die midden in een gat eindigt of het doorkruist blokkeert de brug', () => {
  const wand = (id, startX, startY, endX, endY) => ({ id, startX, startY, endX, endY, dikteMm: 100 });
  const gevel = [wand('a', 0, 0, 40, 0), wand('b', 100, 0, 140, 0)];
  assert.equal(overbrugSparingen(gevel, { maxGatPt: 3000 }).length, 1);
  assert.equal(overbrugSparingen([...gevel, wand('t', 70, 0, 70, 50)], { maxGatPt: 3000 }).length, 0,
    'T-aansluiting in de opening');
  assert.equal(overbrugSparingen([...gevel, wand('x', 70, -50, 70, 50)], { maxGatPt: 3000 }).length, 0,
    'een wand dwars door de opening');
  assert.equal(overbrugSparingen([...gevel, wand('k', 55, 0, 85, 0)], { maxGatPt: 3000 }).length, 2,
    'een los stuk in het verlengde: twee kleinere openingen');
});

test('#552: een dubbel getekende of overlappende ribbe breekt de vlakdoorloop niet', () => {
  // Een meegegeven brug die over een bestaand wandstuk ligt: de echte wand
  // wint, de ruimten blijven.
  const pxPerMm = 0.025;
  const wanden = tweeKamersMetDeuren();
  const bruggen = [
    { id: 'b1', startX: 40, startY: 140, endX: 100, endY: 140, dikteMm: 160, brug: true },
    { id: 'b2', startX: 100, startY: 140, endX: 150, endY: 140, dikteMm: 160, brug: true },
    { id: 'b3', startX: 40, startY: 140, endX: 60, endY: 140, dikteMm: 160, brug: true },
    { id: 'b4', startX: 130, startY: 140, endX: 150, endY: 140, dikteMm: 160, brug: true },
  ];
  const { ruimten } = ruimtenUitWanden(wanden, { pxPerMm, bruggen });
  assert.equal(ruimten.length, 2);
  for (const r of ruimten) {
    assert.ok(!r.wandIds.some((id) => bruggen.some((b) => b.id === id)), 'bruggen tellen niet als wand');
  }
  assert.ok(ruimten.some((r) => r.wandIds.includes('onder-midden-links')),
    'de echte wand vervangt de brug die eroverheen lag');
  const dubbel = ruimtenUitWanden([...doos(5000, 4000), ...doos(5000, 4000, 300, 'kopie')], { pxPerMm: K });
  assert.equal(dubbel.ruimten.length, 1, 'een dubbel getekende doos is één ruimte');
});
