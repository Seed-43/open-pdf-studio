// Boekje-opties (#607): rugzijde links of rechts, alleen voor- of
// achterkanten (handmatig dubbelzijdig), achterkanten een halve slag
// gedraaid (printer kantelt over de lange zijde), vellen in omgekeerde
// volgorde en kruipcompensatie. Het voorbeeld en de afdruk gebruiken
// dezelfde regels (boekjeAfdrukZijden, boekjeIndeling).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  boekjeVolgorde, boekjeAfdrukZijden, boekjeIndeling, voorbeeldBoekje, maakBoekje,
  kruipVoorVel, geldigeKruip, BOEKJE_BINDINGEN, BOEKJE_KANTEN, KRUIP_MAX_MM,
} from './print-boekje.js';

const PT_PER_MM = 72 / 25.4;
const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const A4 = { breedtePt: 210 * PT_PER_MM, hoogtePt: 297 * PT_PER_MM };
const KEUZES = { papier: A4_VEL, orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };
const BLAD_B = 297 * PT_PER_MM;
const BLAD_H = 210 * PT_PER_MM;

const nummers = (zijden) => zijden.map(([l, r]) => [l === null ? 0 : l + 1, r === null ? 0 : r + 1]);
const dicht = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('keuzelijsten: binding en kanten', () => {
  assert.deepEqual([...BOEKJE_BINDINGEN], ['left', 'right']);
  assert.deepEqual([...BOEKJE_KANTEN], ['both', 'front', 'back']);
});

test('rugzijde rechts: elke zijde gespiegeld, de blanco\'s blijven achteraan', () => {
  const links = boekjeVolgorde(8);
  const rechts = boekjeVolgorde(8, 0, { binding: 'right' });
  assert.deepEqual(nummers(rechts.zijden), [[1, 8], [7, 2], [3, 6], [5, 4]]);
  assert.deepEqual(rechts.zijden, links.zijden.map(([l, r]) => [r, l]));
  assert.deepEqual(rechts.vellen[0], { voor: [0, 7], achter: [6, 1] });
  // 6 pagina's: de twee blanco pagina's zijn nog steeds pagina 7 en 8.
  assert.deepEqual(nummers(boekjeVolgorde(6, 0, { binding: 'right' }).zijden), [[1, 0], [0, 2], [3, 6], [5, 4]]);
  // Onbekende binding = links.
  assert.deepEqual(boekjeVolgorde(8, 0, { binding: 'boven' }).zijden, links.zijden);
});

test('rugzijde rechts: gevouwen leest het boekje van rechts naar links van 1 tot het eind', () => {
  // Bij een rug rechts ziet de lezer per spread de linkerhelft van de
  // voorkant of de achterkant als "volgende" pagina (gespiegeld aan links).
  for (const n of [4, 8, 16, 20]) {
    const v = boekjeVolgorde(n, 0, { binding: 'right' });
    const lezing = [];
    for (let s = 0; s < v.vellen.length; s++) lezing.push(v.vellen[s].voor[0], v.vellen[s].achter[1]);
    for (let s = v.vellen.length - 1; s >= 0; s--) lezing.push(v.vellen[s].achter[0], v.vellen[s].voor[1]);
    assert.deepEqual(lezing, Array.from({ length: n }, (_, i) => i), `${n} pagina's`);
  }
});

test('positie in het katern: vel 0 is het buitenste', () => {
  const v = boekjeVolgorde(24, 2);
  assert.deepEqual(v.velInKatern, [0, 1, 0, 1, 0, 1]);
  const een = boekjeVolgorde(12);
  assert.deepEqual(een.velInKatern, [0, 1, 2]);
});

test('boekjeAfdrukZijden: beide kanten in afdrukvolgorde, zoals de zijden', () => {
  const v = boekjeVolgorde(8);
  const zijden = boekjeAfdrukZijden(v);
  assert.equal(zijden.length, 4);
  assert.deepEqual(zijden.map((z) => [z.vel, z.kant]), [[1, 'front'], [1, 'back'], [2, 'front'], [2, 'back']]);
  assert.deepEqual(zijden.map((z) => z.paginas), v.zijden);
  assert.deepEqual(zijden.map((z) => z.k), [0, 1, 2, 3]);
  assert.ok(zijden.every((z) => z.gedraaid === false));
  assert.deepEqual(zijden.map((z) => [z.velInKatern, z.vellenInKatern]), [[0, 2], [0, 2], [1, 2], [1, 2]]);
});

test('boekjeAfdrukZijden: alleen voorkanten of alleen achterkanten (handmatig dubbelzijdig)', () => {
  const v = boekjeVolgorde(12);
  const voor = boekjeAfdrukZijden(v, { kanten: 'front' });
  assert.deepEqual(voor.map((z) => [z.vel, z.kant]), [[1, 'front'], [2, 'front'], [3, 'front']]);
  assert.deepEqual(nummers(voor.map((z) => z.paginas)), [[12, 1], [10, 3], [8, 5]]);
  const achter = boekjeAfdrukZijden(v, { kanten: 'back' });
  assert.deepEqual(achter.map((z) => [z.vel, z.kant]), [[1, 'back'], [2, 'back'], [3, 'back']]);
  assert.deepEqual(nummers(achter.map((z) => z.paginas)), [[2, 11], [4, 9], [6, 7]]);
  // Onbekend = beide.
  assert.equal(boekjeAfdrukZijden(v, { kanten: 'x' }).length, 6);
});

test('boekjeAfdrukZijden: omgekeerd draait de volgorde van de vellen, voor blijft vóór achter', () => {
  const v = boekjeVolgorde(12);
  const beide = boekjeAfdrukZijden(v, { omgekeerd: true });
  assert.deepEqual(beide.map((z) => [z.vel, z.kant]),
    [[3, 'front'], [3, 'back'], [2, 'front'], [2, 'back'], [1, 'front'], [1, 'back']]);
  const achter = boekjeAfdrukZijden(v, { kanten: 'back', omgekeerd: true });
  assert.deepEqual(achter.map((z) => z.vel), [3, 2, 1]);
});

test('boekjeAfdrukZijden: draaiAchter draait alleen de achterkanten', () => {
  const v = boekjeVolgorde(8);
  const zijden = boekjeAfdrukZijden(v, { draaiAchter: true });
  assert.deepEqual(zijden.map((z) => z.gedraaid), [false, true, false, true]);
  const voor = boekjeAfdrukZijden(v, { kanten: 'front', draaiAchter: true });
  assert.ok(voor.every((z) => !z.gedraaid));
});

test('kruip: buitenste vel 0, binnenste vel de volle kruip, lineair daartussen', () => {
  assert.equal(kruipVoorVel(0, 4, 1.5), 0);
  assert.ok(dicht(kruipVoorVel(3, 4, 1.5), 1.5 * PT_PER_MM));
  assert.ok(dicht(kruipVoorVel(1, 4, 1.5), 0.5 * PT_PER_MM));
  assert.equal(kruipVoorVel(0, 1, 2), 0, 'één vel: niets te compenseren');
  assert.equal(kruipVoorVel(2, 4, 0), 0);
  assert.equal(geldigeKruip('1.25'), 1.3);
  assert.equal(geldigeKruip(-1), 0);
  assert.equal(geldigeKruip(99), KRUIP_MAX_MM);
  assert.equal(geldigeKruip('abc'), 0);
  assert.equal(geldigeKruip(undefined), 0);
});

test('boekjeIndeling met kruip: beide pagina\'s schuiven naar de vouw en worden op hun helft afgeknipt', () => {
  const a4 = { breedte: A4.breedtePt, hoogte: A4.hoogtePt };
  const zonder = boekjeIndeling({ bladB: BLAD_B, bladH: BLAD_H, maten: [a4, a4] });
  assert.ok(zonder.every((c) => !c.klem), 'zonder kruip geen knipvlak');
  const d = 2 * PT_PER_MM;
  const [l, r] = boekjeIndeling({ bladB: BLAD_B, bladH: BLAD_H, maten: [a4, a4], kruip: d });
  const vouw = BLAD_B / 2;
  assert.ok(dicht(l.x, zonder[0].x + d), 'links schuift naar rechts');
  assert.ok(dicht(r.x, zonder[1].x - d), 'rechts schuift naar links');
  assert.ok(dicht(l.breedte, zonder[0].breedte) && dicht(l.schaal, zonder[0].schaal), 'zelfde maat');
  assert.deepEqual(l.klem, { x: 0, y: 0, breedte: vouw, hoogte: BLAD_H });
  assert.deepEqual(r.klem, { x: vouw, y: 0, breedte: vouw, hoogte: BLAD_H });
});

test('voorbeeldBoekje: gedraaide zijde staat een halve slag gedraaid op het vel', () => {
  const recht = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, null] });
  const gedraaid = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, null], gedraaid: true });
  assert.equal(gedraaid.gedraaid, true);
  const [a] = recht.cellen;
  const [b] = gedraaid.cellen;
  assert.equal(b.gedraaid, true);
  assert.equal(a.gedraaid, false);
  // De linkerpagina komt rechts te staan, ondersteboven.
  assert.ok(dicht(b.opVel.x, 297 - a.opVel.x - a.opVel.breedte));
  assert.ok(dicht(b.opVel.y, 210 - a.opVel.y - a.opVel.hoogte));
  assert.ok(dicht(b.opVel.breedte, a.opVel.breedte));
  // De vouw ligt midden op het vel (alleen in het voorbeeld getekend).
  assert.ok(dicht(recht.vouw, 148.5));
});

test('voorbeeldBoekje met kruip: verschoven cel en knipvlak in mm', () => {
  const v = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, A4], kruip: 3 * PT_PER_MM });
  const [l, r] = v.cellen;
  assert.ok(dicht(l.opVel.x + l.opVel.breedte, 148.5 + 3));
  assert.ok(dicht(r.opVel.x, 148.5 - 3));
  assert.ok(dicht(l.klem.x, 0) && dicht(l.klem.breedte, 148.5) && dicht(l.klem.hoogte, 210));
  assert.ok(dicht(r.klem.x, 148.5));
  // Gedraaid draait het knipvlak mee.
  const g = voorbeeldBoekje({
    keuzes: KEUZES, eerstePagina: A4, paginas: [A4, null], kruip: 3 * PT_PER_MM, gedraaid: true,
  });
  assert.ok(dicht(g.cellen[0].klem.x, 148.5), 'linkerhelft wordt rechterhelft');
});

// --- De afdruk: dezelfde regels in de print-PDF -----------------------------

async function genummerdeBron(aantal) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= aantal; i++) {
    const p = doc.addPage([A4.breedtePt, A4.hoogtePt]);
    p.drawText(`PAGINA-${i}`, { x: 50, y: 700, size: 24, font });
  }
  return doc;
}

function streamTekst(stream) {
  const data = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(data).toString('latin1');
}

function paginaNummerIn(bron) {
  const m = /<([0-9A-Fa-f]+)> Tj/.exec(bron);
  if (!m) return NaN;
  return Number(/PAGINA-(\d+)/.exec(Buffer.from(m[1], 'hex').toString('latin1'))?.[1]);
}

// Per uitvoerpagina: de inhoud, of de zijde gedraaid is (een cm met -1 0 0 -1
// vooraan), en de getekende bronpagina's met hun x-positie op het vel.
function lees(uit) {
  const context = uit.context;
  return uit.getPages().map((pagina) => {
    const xobjects = pagina.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const inhoud = pagina.node.Contents();
    const stromen = inhoud && typeof inhoud.asArray === 'function'
      ? inhoud.asArray().map((r) => context.lookup(r))
      : [inhoud];
    const tekst = stromen.filter(Boolean).map(streamTekst).join('\n');
    const gedraaid = /-1 0 -?0 -1 [\d.]+ [\d.]+ cm/.test(tekst);
    const plekken = [];
    const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) cm[\s\S]*?\/(\S+) Do/g;
    let m;
    while ((m = re.exec(tekst))) {
      const xobj = context.lookup(xobjects.get(PDFName.of(m[3])));
      plekken.push({ x: Number(m[1]), nr: paginaNummerIn(streamTekst(xobj)) });
    }
    return { tekst, gedraaid, plekken };
  });
}

test('maakBoekje: rugzijde rechts, alleen achterkanten, omgekeerd en gedraaid', async () => {
  const opVolgorde = (z) => z.plekken.sort((a, b) => a.x - b.x).map((p) => p.nr);

  const rechts = lees(await PDFDocument.load(await (await maakBoekje(await genummerdeBron(8), {
    papier: A4_VEL, binding: 'right',
  })).save()));
  assert.deepEqual(rechts.map(opVolgorde), [[1, 8], [7, 2], [3, 6], [5, 4]]);

  const achter = lees(await PDFDocument.load(await (await maakBoekje(await genummerdeBron(8), {
    papier: A4_VEL, kanten: 'back', omgekeerd: true,
  })).save()));
  assert.deepEqual(achter.map(opVolgorde), [[4, 5], [2, 7]]);
  assert.ok(achter.every((z) => !z.gedraaid));

  const gedraaid = lees(await PDFDocument.load(await (await maakBoekje(await genummerdeBron(8), {
    papier: A4_VEL, draaiAchter: true,
  })).save()));
  assert.deepEqual(gedraaid.map((z) => z.gedraaid), [false, true, false, true]);
  // Binnen de gedraaide zijde staan de pagina's nog op hun plek van vóór de
  // draaiing; het geheel draait om het midden van het vel.
  assert.deepEqual(opVolgorde(gedraaid[1]), [2, 7]);
});

test('maakBoekje met kruip: knipvlak per pagina, binnenste vel het meest verschoven', async () => {
  const zonder = lees(await PDFDocument.load(await (await maakBoekje(await genummerdeBron(12), {
    papier: A4_VEL,
  })).save()));
  assert.ok(zonder.every((z) => !/\bW n\b/.test(z.tekst)), 'zonder kruip geen knipvlak');

  const met = lees(await PDFDocument.load(await (await maakBoekje(await genummerdeBron(12), {
    papier: A4_VEL, kruipMm: 2,
  })).save()));
  // Het buitenste vel schuift niet en krijgt geen knipvlak; de rest wel.
  assert.deepEqual(met.map((z) => /\bW\s+n\b/.test(z.tekst)), [false, false, true, true, true, true]);
  // Linkerpagina per zijde: verschuiving t.o.v. zonder kruip = 0, 1, 2 mm
  // voor vel 1, 2, 3 (beide kanten).
  const linksX = (z) => Math.min(...z.plekken.map((p) => p.x));
  const verschil = met.map((z, i) => (linksX(z) - linksX(zonder[i])) / PT_PER_MM);
  for (const [i, verwacht] of [0, 0, 1, 1, 2, 2].entries()) {
    assert.ok(Math.abs(verschil[i] - verwacht) < 0.01, `zijde ${i}: ${verschil[i]} mm`);
  }
});

// --- Volgorde-aanwijzer bij boekje en folder ---------------------------------

test('volgordeAanwijzer zonder pijlen: alleen de nummers, ook op een gedraaide zijde', async () => {
  const { volgordeAanwijzer } = await import('./print-meerperblad.js');
  const v = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, A4] });
  const met = volgordeAanwijzer(v.cellen);
  assert.equal(met.pijlen.length, 1);
  const zonder = volgordeAanwijzer(v.cellen, { pijlen: false });
  assert.equal(zonder.merken.length, 2);
  assert.deepEqual(zonder.pijlen, []);
  assert.ok(zonder.straal > 0);
  // Gedraaid: het merk van de linkerpagina staat rechts van de vouw.
  const g = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, null], gedraaid: true });
  const [m] = volgordeAanwijzer(g.cellen, { pijlen: false }).merken;
  assert.ok(m.x > 148.5);
});

test('de aanwijzer en de vouwlijn komen nooit in de afdruk: maakBoekje kent ze niet', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const bron = readFileSync(join(hier, 'print-boekje.js'), 'utf8');
  const maak = bron.slice(bron.indexOf('export async function maakBoekje'));
  assert.doesNotMatch(maak, /volgordeAanwijzer|vouw:/);
});

test('alle locales hebben de teksten voor afdrukwijzen en boekje-opties, vertaald en gebruikt', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const map = join(hier, '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8')).print;
  const sleutels = [
    'modeLabel', 'modeNormal', 'modeMultiple', 'modeFlyer', 'modePoster', 'flyerTwoSidedNote',
    'bookletBinding', 'bookletBindingLeft', 'bookletBindingRight', 'bookletSides', 'bookletSidesBoth',
    'bookletSidesFront', 'bookletSidesBack', 'bookletCreep', 'bookletCreepHint', 'bookletRotateBack',
    'bookletRotateBackHint', 'bookletManualNote', 'bookletRotatedInfo',
  ];
  // Leenwoorden die in veel talen gelijk zijn aan het Engels.
  const magGelijk = ['modeNormal', 'modeFlyer', 'modePoster'];
  const plaatshouders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const en = lees('en');
  assert.deepEqual(plaatshouders(en.bookletManualNote), ['reverse']);
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const p = lees(taal);
    for (const sleutel of sleutels) {
      const tekst = p[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} print.${sleutel}: plaatshouders`);
      if (taal !== 'en' && !magGelijk.includes(sleutel)) {
        assert.notEqual(tekst, en[sleutel], `${taal} print.${sleutel} is niet vertaald`);
      }
    }
  }
  const dialoog = readFileSync(join(hier, '../solid/components/dialogs/PrintDialog.jsx'), 'utf8');
  for (const sleutel of sleutels) {
    assert.match(dialoog, new RegExp(`['"\`]print\.${sleutel}['"\`]`), `${sleutel} niet gebruikt`);
  }
});
