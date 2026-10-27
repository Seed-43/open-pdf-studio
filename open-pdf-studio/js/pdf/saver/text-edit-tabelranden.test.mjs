// Opslaan van een tekstbewerking in een tabel (#669).
//
// Kan de saver de originele tekstrun niet in-place uit de content stream
// knippen (hier: de tekst staat in een Form XObject dat ook op een tweede
// pagina getekend wordt, #716), dan dekt hij de oude tekst wit af. Dat vlak
// lag eerst over het hele blok — een tabelrij is één blok — en wiste in het
// bestand de celranden van die rij. Nu ligt er per
// originele run een strak vlak: de randen blijven in het bestand staan.
// Daarnaast komt de vervangtekst in de familie van het origineel terug: een
// font dat PDF.js als 'sans-serif' meldt, werd Times-Roman.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, PDFName, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from 'mupdf';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');
const { originalLineRuns, toStandardFontName } = await import('../../text/text-edit-appearance.js');

const KOLOMMEN = [72, 192, 252, 432];
const BOVEN = 700;
const RIJ = 13;
const RIJEN = [
  ['Onderdeel', 'Aantal', 'Opmerking'],
  ['Balk HEA 200', '4', 'Verzinkt'],
  ['Kolom HEB 240', '2', 'Brandwerend 60 min'],
  ['Ligger IPE 300', '6', 'Gestraald SA 2.5'],
];
const ONDER = BOVEN - RIJ * RIJEN.length;

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

// Tabel met 0,5 pt-lijnen op de pagina; de celtekst (9 pt, 2 pt na de
// linkerlijn, baseline 2,5 pt boven de onderlijn) in een Form XObject.
async function tabelPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let lijnen = 'q 0 0 0 RG 0.5 w\n';
  for (let r = 0; r <= RIJEN.length; r++) {
    const y = BOVEN - r * RIJ;
    lijnen += `${KOLOMMEN[0]} ${y} m ${KOLOMMEN[3]} ${y} l S\n`;
  }
  for (const x of KOLOMMEN) lijnen += `${x} ${BOVEN} m ${x} ${ONDER} l S\n`;
  lijnen += 'Q\n';
  let tekst = '';
  RIJEN.forEach((rij, r) => rij.forEach((t, c) => {
    tekst += `BT /F1 9 Tf 1 0 0 1 ${KOLOMMEN[c] + 2} ${BOVEN - (r + 1) * RIJ + 2.5} Tm (${esc(t)}) Tj ET\n`;
  }));
  const fontRes = pdf.context.obj({});
  fontRes.set(PDFName.of('F1'), font.ref);
  const res = pdf.context.obj({});
  res.set(PDFName.of('Font'), fontRes);
  const vorm = pdf.context.flateStream(tekst, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842], Resources: res,
  });
  const vormRef = pdf.context.register(vorm);
  page.node.setXObject(PDFName.of('Tx1'), vormRef);
  const inhoud = `${lijnen}q /Tx1 Do Q\n`;
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(inhoud)));
  // Hetzelfde formulier op een tweede pagina: knippen in het formulier zou
  // de tekst daar ook weghalen, dus blijft de saver op het terugval-pad.
  const tweede = pdf.addPage([595, 842]);
  tweede.node.setXObject(PDFName.of('Tx1'), vormRef);
  tweede.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('q /Tx1 Do Q\n')));
  return pdf.save({ useObjectStreams: false });
}

// Het record zoals de tekstbewerking het voor een tabelrij vastlegt (zie
// finishPdfTextEditing): de spans van de rij uit de tekstlaag van PDF.js.
async function rijRecord(bytes, r, nieuweTekst) {
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const tc = await (await doc.getPage(1)).getTextContent();
    const y = BOVEN - (r + 1) * RIJ + 2.5;
    const items = tc.items
      .filter(it => it.str !== undefined && Math.abs(it.transform[5] - y) < 1)
      .map(it => ({ text: it.str, pdfX: it.transform[4], pdfY: it.transform[5], pdfWidth: it.width, fontSize: 9,
        familie: tc.styles[it.fontName]?.fontFamily }))
      .sort((a, b) => a.pdfX - b.pdfX);
    assert.deepEqual(items.filter(it => it.text.trim()).map(it => it.text), RIJEN[r]);
    const anker = { x: items[0].pdfX, y: items[0].pdfY };
    const breedte = items.reduce((s, it) => s + it.pdfWidth, 0);
    const dx = (c) => items.find(it => it.text === RIJEN[r][c]).pdfX - anker.x;
    const familie = toStandardFontName(items[0].familie || 'sans-serif', false, false);
    return {
      id: `rij-${r}`,
      page: 1,
      originalText: RIJEN[r].join('\t'),
      newText: nieuweTekst.join('\t'),
      pdfX: anker.x,
      pdfY: anker.y,
      pdfWidth: breedte,
      fontSize: 9,
      lineSpacing: 10.8,
      numOriginalLines: 1,
      fontFamily: familie,
      loadedFontName: '',
      color: '#000000',
      textAngle: 0,
      lineStyles: [{ fontFamily: familie, fontSize: 9, color: '#000000', loadedFontName: '' }],
      lineSegments: [nieuweTekst.map((t, c) => ({ text: t, dx: dx(c) }))],
      originalLineInfo: [{
        ...anker, width: breedte, fontSize: 9, angle: 0,
        text: items.map(it => it.text).join(''),
        runs: originalLineRuns(items, anker, 0),
      }],
      originalSpanTexts: [items.map(it => it.text)],
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

const ZOOM = 4;
function render(bytes) {
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  const pix = d.loadPage(0).toPixmap(mupdf.Matrix.scale(ZOOM, ZOOM), mupdf.ColorSpace.DeviceRGB, false, true);
  return { w: pix.getWidth(), h: pix.getHeight(), px: pix.getPixels() };
}

// Donkere pixels op de tabellijnen (alles donkers buiten de celtekst).
function lijnPixels(beeld) {
  const tekstVak = (xp, yp) => RIJEN.some((rij, r) => {
    const y = BOVEN - (r + 1) * RIJ + 2.5;
    return yp > y - 2.2 && yp < y + 8 && rij.some((t, c) => {
      const x = KOLOMMEN[c] + 2;
      return xp > x - 0.3 && xp < x + t.length * 9 * 0.6;
    });
  });
  let n = 0;
  for (let y = 0; y < beeld.h; y++) {
    for (let x = 0; x < beeld.w; x++) {
      if (beeld.px[(y * beeld.w + x) * 3] >= 128) continue;
      if (tekstVak(x / ZOOM, 842 - y / ZOOM)) continue;
      n++;
    }
  }
  return n;
}

test('terugval-pad: de celranden van de bewerkte rij blijven in het bestand staan', async () => {
  const bytes = await tabelPdf();
  const edit = await rijRecord(bytes, 2, ['Kolom HEB 240', '2', 'Brandwerend 90 min']);
  const lib = await PDFDocument.load(bytes);
  await saveTextEditsToPages(lib, lib.getPages(), { textEdits: [edit] });
  assert.equal(edit._pendingBakeInfo?.inplaceBaked ?? null, null, 'tekst in een gedeeld Form XObject: geen in-place-knip');
  const uit = await lib.save({ useObjectStreams: false });

  const voor = lijnPixels(render(bytes));
  const na = lijnPixels(render(uit));
  assert.ok(voor > 5000, `testtabel heeft lijnen (${voor})`);
  assert.ok(voor - na <= voor * 0.002, `lijnpixels weggevallen: ${voor - na} van ${voor}`);
});

test('de vervangtekst komt terug in de familie van het origineel, niet in Times', async () => {
  const bytes = await tabelPdf();
  const edit = await rijRecord(bytes, 2, ['Kolom HEB 240', '2', 'Brandwerend 90 min']);
  const lib = await PDFDocument.load(bytes);
  await saveTextEditsToPages(lib, lib.getPages(), { textEdits: [edit] });
  const opgeslagen = await PDFDocument.load(await lib.save({ useObjectStreams: false }));
  const fonts = opgeslagen.getPages()[0].node.Resources().lookup(PDFName.of('Font'), PDFDict);
  const basisNamen = fonts.keys().map(k => String(opgeslagen.context.lookup(fonts.get(k)).get(PDFName.of('BaseFont'))));
  assert.ok(basisNamen.length > 0);
  assert.ok(basisNamen.every(n => !/Times/i.test(n)), basisNamen.join(', '));
  assert.ok(basisNamen.some(n => /Helvetica/.test(n)), basisNamen.join(', '));
});
