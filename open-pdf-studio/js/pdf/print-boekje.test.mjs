// Boekje afdrukken (#381): de volgorde voor een geniet boekje (saddle-stitch),
// twee pagina's per zijde van een liggend vel, voor dubbelzijdig afdrukken.
// Kruip (creep) telt niet mee.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  boekjeVolgorde, aantalBoekjeZijden, boekjeZijde, isBoekje, kiesBoekjeBlad, boekjeIndeling,
  voorbeeldBoekje, maakBoekje,
} from './print-boekje.js';
import { BLAD_MARGE_PT } from './print-meerperblad.js';

const PT_PER_MM = 72 / 25.4;
const A4_VEL = { breedteMm: 210, hoogteMm: 297 };
const A4 = { breedtePt: 210 * PT_PER_MM, hoogtePt: 297 * PT_PER_MM };
const KEUZES = { papier: A4_VEL, orientatie: 'auto', schaling: 'fit', zoom: 100, centreren: true };

// Paginanummers (vanaf 1) per zijde; 0 = blanco.
const nummers = (volgorde) => volgorde.zijden.map(([l, r]) => [l === null ? 0 : l + 1, r === null ? 0 : r + 1]);

test('isBoekje: alleen de keuze "booklet"', () => {
  assert.equal(isBoekje('booklet'), true);
  assert.equal(isBoekje('2'), false);
  assert.equal(isBoekje(null), false);
  assert.equal(isBoekje(undefined), false);
});

test('8 pagina\'s: twee vellen, voor- en achterkant in de genietvolgorde', () => {
  const v = boekjeVolgorde(8);
  assert.equal(v.totaal, 8);
  assert.equal(v.blanco, 0);
  assert.deepEqual(nummers(v), [[8, 1], [2, 7], [6, 3], [4, 5]]);
  assert.equal(v.vellen.length, 2);
  assert.deepEqual(v.vellen[0], { voor: [7, 0], achter: [1, 6] });
  assert.deepEqual(v.vellen[1], { voor: [5, 2], achter: [3, 4] });
});

test('6 pagina\'s: aangevuld tot 8 met twee blanco pagina\'s achteraan', () => {
  const v = boekjeVolgorde(6);
  assert.equal(v.totaal, 8);
  assert.equal(v.blanco, 2);
  assert.deepEqual(nummers(v), [[0, 1], [2, 0], [6, 3], [4, 5]]);
});

test('aanvullen tot een viervoud: 1, 2, 3, 4, 5, 12 en 13 pagina\'s', () => {
  for (const [n, totaal] of [[1, 4], [2, 4], [3, 4], [4, 4], [5, 8], [12, 12], [13, 16]]) {
    const v = boekjeVolgorde(n);
    assert.equal(v.totaal, totaal, `${n} pagina's`);
    assert.equal(v.blanco, totaal - n, `${n} pagina's: blanco`);
    assert.equal(v.zijden.length, totaal / 2, `${n} pagina's: zijden`);
    // Elke pagina precies één keer, de blanco's zijn de rest.
    const gezien = v.zijden.flat().filter((i) => i !== null).sort((a, b) => a - b);
    assert.deepEqual(gezien, Array.from({ length: n }, (_, i) => i), `${n} pagina's: elke pagina één keer`);
  }
  assert.equal(aantalBoekjeZijden(6), 4);
  assert.equal(aantalBoekjeZijden(0), 0);
  assert.deepEqual(boekjeVolgorde(0).zijden, []);
});

test('gevouwen en genest leest het boekje van 1 tot het eind', () => {
  // Leg de vellen op elkaar (vel 0 buiten), vouw dubbel: de lezer ziet per
  // spread de rechterhelft van de voorkant of de achterkant.
  for (const n of [4, 8, 16, 20]) {
    const v = boekjeVolgorde(n);
    const lezing = [];
    // Rechterhelften van de voorkanten van buiten naar binnen, dan de
    // achterkanten van binnen naar buiten: de leesvolgorde van de rechterpagina's
    // is 1, 3, 5... en die van de linker 2, 4, 6...
    for (let s = 0; s < v.vellen.length; s++) lezing.push(v.vellen[s].voor[1], v.vellen[s].achter[0]);
    for (let s = v.vellen.length - 1; s >= 0; s--) lezing.push(v.vellen[s].achter[1], v.vellen[s].voor[0]);
    assert.deepEqual(lezing, Array.from({ length: n }, (_, i) => i), `${n} pagina's`);
  }
});

test('boekjeZijde: vel en kant van de k-de zijde', () => {
  assert.deepEqual(boekjeZijde(0), { vel: 1, kant: 'front' });
  assert.deepEqual(boekjeZijde(1), { vel: 1, kant: 'back' });
  assert.deepEqual(boekjeZijde(2), { vel: 2, kant: 'front' });
  assert.deepEqual(boekjeZijde(5), { vel: 3, kant: 'back' });
});

test('kiesBoekjeBlad: altijd liggend, ook bij een staand vel of zonder papier', () => {
  const met = kiesBoekjeBlad({ papier: A4_VEL, eerstePagina: { breedte: 100, hoogte: 200 } });
  assert.ok(met.bladB > met.bladH);
  assert.ok(Math.abs(met.bladB - 297 * PT_PER_MM) < 1e-6);
  const zonder = kiesBoekjeBlad({ papier: null, eerstePagina: { breedte: 300, hoogte: 500 } });
  assert.deepEqual(zonder, { bladB: 500, bladH: 300 });
});

test('boekjeIndeling: links tegen de vouw, rechts tegen de vouw, verticaal gecentreerd', () => {
  const bladB = 297 * PT_PER_MM;
  const bladH = 210 * PT_PER_MM;
  const a4 = { breedte: A4.breedtePt, hoogte: A4.hoogtePt };
  const cellen = boekjeIndeling({ bladB, bladH, maten: [a4, a4] });
  assert.equal(cellen.length, 2);
  const [l, r] = cellen;
  assert.equal(l.k, 0);
  assert.equal(r.k, 1);
  assert.ok(Math.abs(l.x + l.breedte - bladB / 2) < 1e-6, 'linkerpagina eindigt op de vouw');
  assert.ok(Math.abs(r.x - bladB / 2) < 1e-6, 'rechterpagina begint op de vouw');
  assert.ok(l.x >= BLAD_MARGE_PT - 1e-6 && r.x + r.breedte <= bladB - BLAD_MARGE_PT + 1e-6);
  assert.ok(l.y >= BLAD_MARGE_PT - 1e-6 && l.y + l.hoogte <= bladH - BLAD_MARGE_PT + 1e-6);
  assert.ok(Math.abs((l.y + l.hoogte / 2) - bladH / 2) < 1e-6, 'verticaal gecentreerd');
  assert.ok(Math.abs(l.hoogte / l.breedte - 297 / 210) < 1e-6, 'verhouding blijft');
  // Een blanco helft: geen cel.
  const half = boekjeIndeling({ bladB, bladH, maten: [null, a4] });
  assert.deepEqual(half.map((c) => c.k), [1]);
});

test('voorbeeldBoekje: liggend A4-vel, twee cellen, mm vanaf linksboven', () => {
  const v = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [A4, A4] });
  assert.equal(v.vel.orientatie, 'landscape');
  assert.ok(Math.abs(v.vel.breedteMm - 297) < 1e-6 && Math.abs(v.vel.hoogteMm - 210) < 1e-6);
  assert.equal(v.cellen.length, 2);
  const [l, r] = v.cellen;
  assert.ok(Math.abs(l.opVel.x + l.opVel.breedte - 148.5) < 1e-6);
  assert.ok(Math.abs(r.opVel.x - 148.5) < 1e-6);
  assert.ok(Math.abs(l.opVel.y - (210 - l.opVel.hoogte) / 2) < 1e-6);
  assert.ok(v.schaal > 0.6 && v.schaal < 0.71);
  assert.equal(v.rand, false);
  // Blanco links: alleen de rechtercel.
  const blanco = voorbeeldBoekje({ keuzes: KEUZES, eerstePagina: A4, paginas: [null, A4] });
  assert.deepEqual(blanco.cellen.map((c) => c.k), [1]);
  assert.equal(voorbeeldBoekje({ keuzes: null, eerstePagina: A4, paginas: [A4, A4] }), null);
});

// Een bron-PDF met één pagina per bronpagina, elk met haar nummer als tekst:
// zo is in de uitvoer terug te lezen welke pagina op welke plek staat.
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

// Per uitvoerpagina: de getekende bronpagina's met hun x-positie (links of
// rechts van de vouw). drawPage schrijft "q 1 0 0 1 x y cm ... /Naam Do Q".
function getekendePaginas(uit) {
  const context = uit.context;
  return uit.getPages().map((pagina) => {
    const xobjects = pagina.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
    const inhoud = pagina.node.Contents();
    const stromen = inhoud && typeof inhoud.asArray === 'function'
      ? inhoud.asArray().map((r) => context.lookup(r))
      : [inhoud];
    const tekst = stromen.filter(Boolean).map(streamTekst).join('\n');
    const plekken = [];
    const re = /q\s+1 0 0 1 ([-\d.]+) ([-\d.]+) cm[\s\S]*?\/(\S+) Do/g;
    let m;
    while ((m = re.exec(tekst))) {
      const xobj = context.lookup(xobjects.get(PDFName.of(m[3])));
      plekken.push({ x: Number(m[1]), nr: paginaNummerIn(streamTekst(xobj)) });
    }
    return plekken;
  });
}

// Helvetica-tekst staat als hex-string in de stroom: "PAGINA-3" terug uit de hex.
function paginaNummerIn(bron) {
  const m = /<([0-9A-Fa-f]+)> Tj/.exec(bron);
  if (!m) return NaN;
  return Number(/PAGINA-(\d+)/.exec(Buffer.from(m[1], 'hex').toString('latin1'))?.[1]);
}

test('maakBoekje: 8 pagina\'s geven 4 liggende zijden in genietvolgorde', async () => {
  const bron = await genummerdeBron(8);
  const uit = await maakBoekje(bron, { papier: A4_VEL });
  assert.equal(uit.getPageCount(), 4);
  for (const p of uit.getPages()) {
    const { width, height } = p.getSize();
    assert.ok(width > height, 'liggend');
    assert.ok(Math.abs(width - 297 * PT_PER_MM) < 0.01 && Math.abs(height - 210 * PT_PER_MM) < 0.01);
  }
  const heropend = await PDFDocument.load(await uit.save());
  const zijden = getekendePaginas(heropend).map((plekken) => plekken
    .sort((a, b) => a.x - b.x).map((p) => p.nr));
  assert.deepEqual(zijden, [[8, 1], [2, 7], [6, 3], [4, 5]]);
});

test('maakBoekje: 6 pagina\'s, de blanco helften blijven leeg', async () => {
  const bron = await genummerdeBron(6);
  const uit = await maakBoekje(bron, { papier: A4_VEL });
  assert.equal(uit.getPageCount(), 4);
  const heropend = await PDFDocument.load(await uit.save());
  const plekken = getekendePaginas(heropend);
  const halfB = (297 * PT_PER_MM) / 2;
  // Zijde 1: blanco links, pagina 1 rechts. Zijde 2: pagina 2 links, blanco rechts.
  assert.deepEqual(plekken[0].map((p) => p.nr), [1]);
  assert.ok(plekken[0][0].x >= halfB - 1e-3, 'pagina 1 rechts van de vouw');
  assert.deepEqual(plekken[1].map((p) => p.nr), [2]);
  assert.ok(plekken[1][0].x < halfB, 'pagina 2 links van de vouw');
  assert.deepEqual(plekken[2].sort((a, b) => a.x - b.x).map((p) => p.nr), [6, 3]);
  assert.deepEqual(plekken[3].sort((a, b) => a.x - b.x).map((p) => p.nr), [4, 5]);
});

test('maakBoekje: zonder pagina\'s komt hetzelfde document terug', async () => {
  const leeg = await PDFDocument.create();
  assert.equal(await maakBoekje(leeg, { papier: A4_VEL }), leeg);
});

test('alle locales hebben de boekjesteksten, vertaald en met dezelfde plaatshouders', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const map = join(hier, '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8')).print;
  const sleutels = ['perSheetBooklet', 'bookletNote', 'bookletSideFront', 'bookletSideBack', 'bookletBlank', 'bookletPadded'];
  const plaatshouders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const en = lees('en');
  const talen = readdirSync(map);
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const p = lees(taal);
    for (const sleutel of sleutels) {
      const tekst = p[sleutel];
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      assert.deepEqual(plaatshouders(tekst), plaatshouders(en[sleutel]), `${taal} print.${sleutel}: plaatshouders`);
      if (taal !== 'en') assert.notEqual(tekst, en[sleutel], `${taal} print.${sleutel} is niet vertaald`);
    }
  }
  // Elke boekjessleutel die de printdialoog gebruikt bestaat.
  const dialoog = readFileSync(join(hier, '../solid/components/dialogs/PrintDialog.jsx'), 'utf8');
  const gebruikt = [...dialoog.matchAll(/['"`]print\.(booklet\w*|perSheetBooklet)['"`]/g)].map((m) => m[1]);
  assert.ok(gebruikt.length >= 5);
  for (const sleutel of gebruikt) assert.ok(en[sleutel], `print.${sleutel} wordt gebruikt maar ontbreekt`);
});
