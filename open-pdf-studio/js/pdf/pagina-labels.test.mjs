import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  zijnGewoneNummers, normaliseerLabels, labelVan, heeftEigenLabel, herschikLabels,
  labelInReeks, paginaLabelReeksen, schrijfPaginaLabels, slaPaginaLabelsOp,
  regelsTotTekst, tekstInGebied, woordenInGebied, draaiVak, plaatshouders, vulSjabloon,
} from './pagina-labels.js';

// Paginalabels (#580): lijstlogica, /PageLabels heen en terug via pdf.js (wat
// de app bij openen leest), en tekst uit een vak op de pagina — ook op
// CAD-bladen die ongedraaid met /Rotate 90 zijn opgeslagen.

async function pdfMetPaginas(aantal) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) doc.addPage([200, 200]);
  return doc;
}

async function labelsVolgensPdfjs(bytes) {
  const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  try {
    return await pdf.getPageLabels();
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// ── Lijst ──

test('gewone nummering wordt null, lege labels worden het paginanummer', () => {
  assert.equal(zijnGewoneNummers(['1', '2', '3']), true);
  assert.equal(normaliseerLabels(['1', '', null], 3), null);
  assert.deepEqual(normaliseerLabels(['  S-101   GROUND\nFLOOR ', '', 'x'], 4), ['S-101 GROUND FLOOR', '2', 'x', '4']);
  assert.equal(normaliseerLabels(null, 3), null);
});

test('labelVan en heeftEigenLabel vallen terug op het paginanummer', () => {
  assert.equal(labelVan(null, 3), '3');
  assert.equal(labelVan(['A', ''], 2), '2');
  assert.equal(labelVan(['A', 'B'], 1), 'A');
  assert.equal(heeftEigenLabel(['A', '2'], 1), true);
  assert.equal(heeftEigenLabel(['A', '2'], 2), false);
  assert.equal(heeftEigenLabel(null, 1), false);
});

test('namen verhuizen mee bij verwijderen, verplaatsen en invoegen; nummers worden het nieuwe nummer', () => {
  const labels = ['Cover', '2', 'S-101', 'S-102'];
  // pagina 2 weg
  assert.deepEqual(herschikLabels(labels, { 1: 1, 2: null, 3: 2, 4: 3 }, 3), ['Cover', 'S-101', 'S-102']);
  // pagina 4 naar voren
  assert.deepEqual(herschikLabels(labels, { 4: 1, 1: 2, 2: 3, 3: 4 }, 4), ['S-102', 'Cover', '3', 'S-101']);
  // lege pagina ingevoegd na pagina 1
  assert.deepEqual(herschikLabels(labels, { 1: 1, 2: 3, 3: 4, 4: 5 }, 5), ['Cover', '2', '3', 'S-101', 'S-102']);
  assert.equal(herschikLabels(null, { 1: 1 }, 1), null);
  // alleen nummers over: weer gewone nummering
  assert.equal(herschikLabels(['A', '2'], { 1: null, 2: 1 }, 1), null);
});

// ── Reeksen ──

test('labels worden zo weinig mogelijk reeksen, met romeinse en doorlopende nummers', () => {
  assert.deepEqual(paginaLabelReeksen(['i', 'ii', 'iii', '1', '2', '3']), [
    { index: 0, S: 'r', P: '', St: 1 },
    { index: 3, S: 'D', P: '', St: 1 },
  ]);
  assert.deepEqual(paginaLabelReeksen(['S-101', 'S-102', 'S-103']), [{ index: 0, S: 'D', P: 'S-', St: 101 }]);
  assert.deepEqual(paginaLabelReeksen(['Cover', 'Cover']), [{ index: 0, P: 'Cover', St: 1 }]);
  // Een los paginanummer blijft een nummer, geen tekst.
  assert.deepEqual(paginaLabelReeksen(['Cover', '2', 'Plan', '4']), [
    { index: 0, P: 'Cover', St: 1 },
    { index: 1, S: 'D', P: '', St: 2 },
    { index: 2, P: 'Plan', St: 1 },
    { index: 3, S: 'D', P: '', St: 4 },
  ]);
  assert.deepEqual(paginaLabelReeksen(['A', 'B', 'C']).length, 1);
  assert.equal(labelInReeks({ S: 'A' }, 27), 'AA');
  assert.equal(labelInReeks({ S: 'r', P: 'p.' }, 14), 'p.xiv');
});

test('elke lijst reeksen geeft precies de labels terug', () => {
  const lijsten = [
    ['Cover', 'S-101 - GROUND FLOOR PLAN', 'S-102 - FIRST FLOOR PLAN', 'iv', 'v', '6'],
    ['A-01', 'A-01', 'A-02', 'x', 'X', 'xi', 'Appendix', 'Appendix C', 'Appendix D', '01', '02'],
    ['', '', 'a', 'b', 'z', 'aa', 'MMXXVI', 'MMXXVII'],
  ];
  for (const labels of lijsten) {
    const uit = [];
    const reeksen = paginaLabelReeksen(labels);
    reeksen.forEach((r, i) => {
      const eind = i + 1 < reeksen.length ? reeksen[i + 1].index : labels.length;
      for (let p = r.index; p < eind; p++) uit.push(labelInReeks(r, r.St + (p - r.index)));
    });
    assert.deepEqual(uit, labels);
  }
});

// ── /PageLabels heen en terug ──

test('opgeslagen labels leest pdf.js na heropenen precies zo terug', async () => {
  const labels = ['Cover', 'S-101 - GROUND FLOOR PLAN', 'S-102 - FIRST FLOOR PLAN', 'iv', 'v', '6', 'Détail ü 中文'];
  const lib = await pdfMetPaginas(labels.length);
  const doc = { pageLabels: normaliseerLabels(labels, labels.length), pageLabelsDirty: true };
  assert.equal(slaPaginaLabelsOp(lib, doc), true);
  const bytes = await lib.save();
  assert.deepEqual(await labelsVolgensPdfjs(bytes), labels);

  // Terug naar paginanummers: /PageLabels verdwijnt.
  const opnieuw = await PDFDocument.load(bytes);
  slaPaginaLabelsOp(opnieuw, { pageLabels: null, pageLabelsDirty: true });
  assert.equal(opnieuw.catalog.get(PDFName.of('PageLabels')), undefined);
  assert.equal(await labelsVolgensPdfjs(await opnieuw.save()), null);
});

test('een bestand met een andere nummering blijft ongemoeid zolang de labels niet bewerkt zijn', async () => {
  const lib = await pdfMetPaginas(4);
  schrijfPaginaLabels(lib, ['i', 'ii', '1', '2']);
  const bytes = await lib.save();
  const geladen = await PDFDocument.load(bytes);
  const voor = geladen.catalog.get(PDFName.of('PageLabels'));
  assert.equal(slaPaginaLabelsOp(geladen, { pageLabels: ['i', 'ii', '1', '2'], pageLabelsDirty: false }), false);
  assert.equal(geladen.catalog.get(PDFName.of('PageLabels')), voor);
  // De romeinse nummering staat als stijl in het bestand, niet als losse tekst.
  const nums = geladen.context.lookup(voor).lookup(PDFName.of('Nums'));
  assert.equal(nums.size(), 4);
  assert.equal(nums.lookup(1).get(PDFName.of('S')).asString(), '/r');
  assert.deepEqual(await labelsVolgensPdfjs(bytes), ['i', 'ii', '1', '2']);
});

test('een bewerkte pagina in een romeins genummerd bestand houdt de rest als nummering', async () => {
  const lib = await pdfMetPaginas(5);
  schrijfPaginaLabels(lib, ['i', 'ii', 'Plan', '2', '3']);
  const nums = lib.catalog.lookup(PDFName.of('PageLabels')).lookup(PDFName.of('Nums'));
  assert.equal(nums.size(), 6, 'drie reeksen: romeins, de naam, en decimaal vanaf 2');
  assert.deepEqual(await labelsVolgensPdfjs(await lib.save()), ['i', 'ii', 'Plan', '2', '3']);
});

// ── Tekst in een vak ──

// Een onderhoek: bijschrift "DWG No." met het nummer eronder, en een titel
// over twee regels. Op een /Rotate 90-blad is de tekst in PDF-ruimte 90°
// gedraaid geschreven, zodat hij op het scherm rechtop staat.
async function bladenPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const regels = [
    // [tekst, weergave-x, weergave-y (basislijn), grootte]
    ['DWG No.', 440, 300, 7],
    ['S-101', 440, 314, 10],
    ['GROUND FLOOR', 440, 340, 9],
    ['PLAN', 440, 352, 9],
  ];
  // Blad 1: ongedraaid opgeslagen, staand 400 × 600, met /Rotate 90.
  const gedraaid = doc.addPage([400, 600]);
  gedraaid.setRotation(degrees(90));
  // Weergave (u, v) hoort bij PDF (x, y) = (v, u) op dit blad.
  for (const [tekst, u, v, size] of regels) {
    gedraaid.drawText(tekst, { x: v, y: u, size, font, rotate: degrees(90) });
  }
  // Blad 2: gewoon liggend 600 × 400.
  const recht = doc.addPage([600, 400]);
  for (const [tekst, u, v, size] of regels) {
    recht.drawText(tekst, { x: u, y: 400 - v, size, font });
  }
  // Blad 3: CAD-uitvoer met elke letter als losse tekst.
  const letters = doc.addPage([600, 400]);
  let x = 440;
  for (const teken of 'S-102') {
    letters.drawText(teken, { x, y: 400 - 314, size: 10, font });
    x += font.widthOfTextAtSize(teken, 10);
  }
  letters.drawText('DWG No.', { x: 440, y: 400 - 300, size: 7, font });
  return doc.save();
}

async function metPaginas(bytes, fn) {
  const pdf = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
      const { items } = await page.getTextContent();
      await fn(n, items, viewport);
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const NUMMERVAK = { x: 435, y: 304, width: 60, height: 14 };
const TITELVAK = { x: 435, y: 330, width: 120, height: 26 };

test('een vak om het nummer onder "DWG No." geeft het nummer, ook op /Rotate 90-bladen', async () => {
  const gelezen = [];
  await metPaginas(await bladenPdf(), (n, items, viewport) => {
    gelezen.push([tekstInGebied(items, viewport, NUMMERVAK), tekstInGebied(items, viewport, TITELVAK)]);
  });
  assert.deepEqual(gelezen, [
    ['S-101', 'GROUND FLOOR PLAN'],
    ['S-101', 'GROUND FLOOR PLAN'],
    ['S-102', ''],
  ]);
  const teksten = { 1: gelezen[0][0], 2: gelezen[0][1] };
  assert.equal(vulSjabloon('{OCR1} - {OCR2}', teksten), 'S-101 - GROUND FLOOR PLAN');
});

test('regels worden van boven naar onder en van links naar rechts één naam', () => {
  assert.equal(regelsTotTekst([
    { x: 50, y: 20, width: 30, height: 10, text: 'PLAN' },
    { x: 10, y: 5, width: 30, height: 10, text: 'GROUND' },
    { x: 45, y: 6, width: 30, height: 10, text: 'FLOOR' },
  ]), 'GROUND FLOOR PLAN');
  assert.equal(regelsTotTekst([]), '');
});

test('OCR-woorden: alleen woorden met hun midden in het vak, ook na draaien', () => {
  const woorden = [
    { text: 'DWG', left: 10, top: 10, width: 20, height: 8 },
    { text: 'S-201', left: 10, top: 22, width: 30, height: 10 },
  ];
  assert.equal(woordenInGebied(woorden, { x: 5, y: 20, width: 40, height: 14 }), 'S-201');
  assert.deepEqual(draaiVak({ x: 10, y: 20, width: 30, height: 10 }, 200, 100, 90), { x: 70, y: 10, width: 10, height: 30 });
  assert.deepEqual(draaiVak({ x: 10, y: 20, width: 30, height: 10 }, 200, 100, 180), { x: 160, y: 70, width: 30, height: 10 });
  assert.deepEqual(draaiVak({ x: 10, y: 20, width: 30, height: 10 }, 200, 100, 270), { x: 20, y: 160, width: 10, height: 30 });
  assert.deepEqual(draaiVak({ x: 10, y: 20, width: 30, height: 10 }, 200, 100, 0), { x: 10, y: 20, width: 30, height: 10 });
});

// ── Sjabloon ──

test('sjabloon: {OCRn} wordt de gelezen tekst, losse scheidingstekens vallen weg', () => {
  assert.deepEqual(plaatshouders('{OCR1} - {ocr2} {OCR1}'), [1, 2]);
  assert.equal(vulSjabloon('{OCR1} - {OCR2}', { 1: 'S-101', 2: '' }), 'S-101');
  assert.equal(vulSjabloon('{OCR1} - {OCR2}', { 1: '', 2: 'PLAN' }), 'PLAN');
  assert.equal(vulSjabloon('{OCR1} - {OCR2} - {OCR3}', { 1: 'A', 2: '', 3: 'C' }), 'A - C');
  assert.equal(vulSjabloon('Sheet {OCR1}', { 1: '  7 \n' }), 'Sheet 7');
  assert.equal(vulSjabloon('S-101 -', {}), 'S-101 -', 'zonder plaatshouder blijft getypte tekst staan');
  assert.equal(vulSjabloon('', { 1: 'x' }), '');
});
