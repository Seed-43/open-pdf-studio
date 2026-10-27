// Bewerken van PDF-tekst in een tabel (#669): de bewerking mag alleen de oude
// tekst weghalen, niet de lijnen eromheen, en de vervangtekst komt terug in
// de familie van het origineel.
//
// - Afdekvlakken: per originele tekstrun een strak vlak, zodat tabelranden
//   tussen en rond de cellen erbuiten liggen (textEditCoverRects).
// - Uitsnede zonder tekst: PDF.js tekent het afdekgebied met de tekst- en
//   afbeeldingsoperaties overgeslagen; lijnen die de tekst raken of kruisen
//   blijven staan (text-edit-afdekking.js).
// - 'sans-serif' (de terugvalfamilie van PDF.js) is geen schreeffont.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  toStandardFontName,
  cssFamilyForFontName,
  originalLineRuns,
  textEditCoverRects,
  coverRectsFrameBounds,
  COVER_DESCENT_EM,
  COVER_ASCENT_EM,
} from './text-edit-appearance.js';
import {
  afdekOverslaanOps,
  maakAfdekFilter,
  heeftOnzichtbareTekst,
  uitsnedeDichtheid,
  uitsnedeKader,
  uitsnedeVoldoet,
  MAX_UITSNEDE_AS,
  MAX_UITSNEDE_PIXELS,
} from './text-edit-afdekking.js';

// ── Testtabel: 3 kolommen (72-192-252-432), rijen van 13 pt, lijnen 0,5 pt,
// tekst 9 pt, 2 pt na de linkerlijn en de baseline 2,5 pt boven de onderlijn.
const KOLOMMEN = [72, 192, 252, 432];
const BOVEN = 700;
const RIJ = 13;
const RIJEN = [
  ['Onderdeel', 'Aantal', 'Opmerking'],
  ['Balk HEA 200', '4', 'Verzinkt'],
  ['Kolom HEB 240', '2', 'Brandwerend 60 min'],
];
const baseline = (r) => BOVEN - (r + 1) * RIJ + 2.5;

// De spans van rij r zoals de tekstlaag ze levert: één per cel, met een
// witruimte-span die het gat naar de volgende cel vult.
function rijItems(r) {
  const items = [];
  RIJEN[r].forEach((tekst, c) => {
    const x = KOLOMMEN[c] + 2;
    const breedte = tekst.length * 9 * 0.5;
    items.push({ text: tekst, pdfX: x, pdfY: baseline(r), pdfWidth: breedte, fontSize: 9 });
    if (c < RIJEN[r].length - 1) {
      items.push({ text: ' ', pdfX: x + breedte, pdfY: baseline(r), pdfWidth: KOLOMMEN[c + 1] + 2 - (x + breedte), fontSize: 9 });
    }
  });
  return items;
}

function rijRecord(r, nieuw) {
  const items = rijItems(r);
  const anker = { x: items[0].pdfX, y: items[0].pdfY };
  return {
    id: `rij-${r}`,
    page: 1,
    originalText: RIJEN[r].join('\t'),
    newText: nieuw ?? RIJEN[r].join('\t'),
    pdfX: anker.x,
    pdfY: anker.y,
    pdfWidth: items.reduce((s, it) => s + it.pdfWidth, 0),
    fontSize: 9,
    lineSpacing: 10.8,
    numOriginalLines: 1,
    textAngle: 0,
    originalLineInfo: [{
      ...anker, width: items.reduce((s, it) => s + it.pdfWidth, 0), fontSize: 9, angle: 0,
      text: items.map(it => it.text).join(''),
      runs: originalLineRuns(items, anker, 0),
    }],
  };
}

// Raakt een (as-evenwijdig) afdekvlak een verticale lijn op x tussen y0 en y1?
const raaktVerticaal = (rect, x, y0, y1) => rect.x < x + 0.25 && rect.x + rect.width > x - 0.25
  && rect.y < y1 && rect.y + rect.height > y0;
const raaktHorizontaal = (rect, y) => rect.y < y + 0.25 && rect.y + rect.height > y - 0.25;

test('runs per cel: de witruimte-span tussen twee cellen is geen run', () => {
  const items = rijItems(2);
  const runs = originalLineRuns(items, { x: items[0].pdfX, y: items[0].pdfY }, 0);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map(r => Math.round(r.dx)), [0, 120, 180]);
  assert.equal(runs[0].width, 'Kolom HEB 240'.length * 4.5);
});

test('runs op woordafstand worden één run (glyf-voor-glyf-gepositioneerde tekst)', () => {
  const items = [...'Hallo'].map((ch, i) => ({ text: ch, pdfX: 100 + i * 5, pdfY: 500, pdfWidth: 5, fontSize: 10 }));
  assert.deepEqual(originalLineRuns(items, { x: 100, y: 500 }, 0), [{ dx: 0, width: 25 }]);
});

test('afdekvlakken van een tabelrij laten de celranden vrij', () => {
  const rect = textEditCoverRects(rijRecord(2));
  assert.equal(rect.length, 3, 'één vlak per cel');
  const rijBoven = BOVEN - 2 * RIJ;
  const rijOnder = BOVEN - 3 * RIJ;
  for (const r of rect) {
    for (const x of KOLOMMEN) {
      assert.equal(raaktVerticaal(r, x, rijOnder, rijBoven), false, `vlak bij x=${r.x.toFixed(1)} raakt de rand op x=${x}`);
    }
    assert.equal(raaktHorizontaal(r, rijBoven), false, 'bovenrand van de rij');
    assert.equal(raaktHorizontaal(r, rijOnder), false, 'onderrand van de rij');
    // Wel de glyfen: van onder de descender tot boven de accenten.
    assert.ok(r.y <= baseline(2) - 9 * 0.2 && r.y + r.height >= baseline(2) + 9 * 0.9);
  }
});

test('zonder runs: één vlak over de gemeten regelbreedte, niet over een tekenaantal-schatting', () => {
  const rec = { originalText: 'Verzinkt', fontSize: 9, textAngle: 0,
    originalLineInfo: [{ x: 254, y: 676.5, width: 32.5, fontSize: 9, angle: 0, text: 'Verzinkt' }] };
  const [r] = textEditCoverRects(rec);
  assert.ok(r.x > 252 && r.x + r.width < 432, JSON.stringify(r));
  assert.ok(r.width < 32.5 + 9 * 0.5);
});

test('afdekvlakken draaien mee met gedraaide tekst', () => {
  const rec = { originalText: 'AB', fontSize: 10, textAngle: 90,
    originalLineInfo: [{ x: 100, y: 200, width: 20, fontSize: 10, angle: 90, text: 'AB' }] };
  const [r] = textEditCoverRects(rec);
  assert.equal(r.angle, 90);
  // Leesrichting omhoog: het vlak begint onder het anker en ligt links/rechts
  // van de baseline-as volgens de ascender-richting (-x).
  assert.ok(Math.abs(r.y - (200 - 1)) < 1e-9, `y ${r.y}`);
  assert.ok(Math.abs(r.x - (100 + 10 * COVER_DESCENT_EM)) < 1e-9, `x ${r.x}`);
  const kader = coverRectsFrameBounds([r], 0, 842);
  assert.ok(Math.abs(kader.width - 10 * (COVER_DESCENT_EM + COVER_ASCENT_EM)) < 1e-9);
});

test('nieuw toegevoegde tekst heeft geen afdekvlak', () => {
  assert.deepEqual(textEditCoverRects({ originalText: '', newText: 'x', fontSize: 9 }), []);
});

test("'sans-serif' en Sans-namen blijven schreefloos; echte schreeffonts worden Times", () => {
  assert.equal(toStandardFontName('sans-serif', false, false), 'Helvetica');
  assert.equal(toStandardFontName('sans-serif', true, true), 'Helvetica-BoldOblique');
  assert.equal(toStandardFontName('Microsoft Sans Serif', false, false), 'Helvetica');
  assert.equal(toStandardFontName('serif', false, false), 'TimesRoman');
  assert.equal(toStandardFontName('DejaVu Serif', true, false), 'TimesRoman-Bold');
  assert.equal(toStandardFontName('Garamond', false, true), 'TimesRoman-Italic');
  assert.equal(toStandardFontName('Consolas', false, false), 'Courier');
  assert.equal(cssFamilyForFontName('sans-serif'), 'Helvetica, Arial, sans-serif');
  assert.equal(cssFamilyForFontName('PT Serif'), '"Times New Roman", Times, serif');
});

test('het filter van de uitsnede slaat tekst en afbeeldingen over, lijnen en vlakken niet', () => {
  const filter = maakAfdekFilter(OPS);
  const lijst = {
    fnArray: [OPS.save, OPS.constructPath, OPS.beginText, OPS.setFont, OPS.showText,
      OPS.showSpacedText, OPS.endText, OPS.paintImageXObject, OPS.paintInlineImageXObject,
      OPS.fill, OPS.restore],
  };
  const uitgevoerd = lijst.fnArray.filter((_, i) => filter(i, lijst));
  assert.deepEqual(uitgevoerd, [OPS.save, OPS.constructPath, OPS.beginText, OPS.setFont,
    OPS.endText, OPS.fill, OPS.restore]);
  assert.ok(!afdekOverslaanOps(OPS).has(undefined));
});

// Zichtbare tekst over een foto: de foto blijft in de uitsnede staan (geen
// wit gat). Alleen op een pagina met een OCR-laag gaat de afbeelding weg.
test('het filter laat afbeeldingen staan als de pagina geen OCR-laag heeft', () => {
  const filter = maakAfdekFilter(OPS, { afbeeldingen: false });
  const lijst = { fnArray: [OPS.save, OPS.showText, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.restore] };
  assert.deepEqual(lijst.fnArray.filter((_, i) => filter(i, lijst)),
    [OPS.save, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.restore]);
});

test('onzichtbare tekst (render-modus 3 of 7) maakt een pagina een OCR-pagina', () => {
  const lijst = (modus) => ({ fnArray: [OPS.beginText, OPS.setTextRenderingMode, OPS.showText],
    argsArray: [null, [modus], null] });
  assert.equal(heeftOnzichtbareTekst(lijst(3), OPS), true);
  assert.equal(heeftOnzichtbareTekst(lijst(7), OPS), true);
  assert.equal(heeftOnzichtbareTekst(lijst(0), OPS), false);
  assert.equal(heeftOnzichtbareTekst({ fnArray: [OPS.showText], argsArray: [null] }, OPS), false);
});

test('de uitsnede kiest het filter naar de OCR-laag van de pagina', async () => {
  const fs = await import('node:fs');
  const bron = fs.readFileSync(new URL('./text-edit-afdekking.js', import.meta.url), 'utf8');
  assert.match(bron, /maakAfdekFilter\(pdfjs\.OPS, \{ afbeeldingen: ocrPagina \}\)/);
  // Een MCP-bewerking dekt een scan in het bestand af zoals de UI (#720): de
  // weergave laat de afbeelding dan ook niet meer staan.
  const painter = fs.readFileSync(new URL('../annotations/rendering.js', import.meta.url), 'utf8');
  assert.doesNotMatch(painter, /behoudBeeld/);
});

test('uitsnede: dichtheid van het canvas, begrensd per as en in pixels', () => {
  assert.equal(uitsnedeDichtheid({ width: 100, height: 13 }, 3), 3);
  const breed = uitsnedeDichtheid({ width: 1000, height: 13 }, 48);
  assert.ok(breed * 1000 <= MAX_UITSNEDE_AS + 1e-6);
  const groot = uitsnedeDichtheid({ width: 2000, height: 2000 }, 10);
  assert.ok(2000 * 2000 * groot * groot <= MAX_UITSNEDE_PIXELS * 1.0001);
  assert.equal(uitsnedeVoldoet(3, 3), true);
  assert.equal(uitsnedeVoldoet(2, 3), false, 'te grof na inzoomen');
  assert.equal(uitsnedeVoldoet(6, 3), false, 'veel te fijn na uitzoomen');
});

test('uitsnede: het kader ligt op het pixelraster en omvat het afdekgebied', () => {
  const px = 2.25;
  const omh = { x: 10.3, y: 20.7, width: 33.33, height: 11.7 };
  const k = uitsnedeKader(omh, px);
  for (const v of [k.x, k.y, k.x + k.width, k.y + k.height]) {
    assert.ok(Math.abs(v * px - Math.round(v * px)) < 1e-9, `${v} niet op het raster`);
  }
  assert.ok(k.x <= omh.x && k.y <= omh.y);
  assert.ok(k.x + k.width >= omh.x + omh.width && k.y + k.height >= omh.y + omh.height);
});

// ── De uitsnede zelf, met PDF.js onder node ──
// Een tabelrij met een randlijn die door de tekst loopt en een onderstreping
// als vectorlijn: in de uitsnede staan de lijnen, de tekst niet.
async function kruisendePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 120]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const inhoud = [
    'q 0 0 0 RG 0.5 w 20 60 m 280 60 l S 40 50 m 40 80 l S Q',
    'BT /F1 12 Tf 1 0 0 1 22 57 Tm (Peil vloer +0.000) Tj ET',
  ].join('\n');
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(inhoud)));
  return pdf.save();
}

let napiCanvas = null;
try { napiCanvas = await import('@napi-rs/canvas'); } catch { napiCanvas = null; }

test('PDF.js tekent de uitsnede zonder tekst: kruisende lijnen blijven, glyfen niet',
  { skip: napiCanvas ? false : '@napi-rs/canvas ontbreekt' }, async () => {
    const bytes = await kruisendePdf();
    const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    try {
      const page = await doc.getPage(1);
      const px = 4;
      // Kader rond de tekst (tekenkader: y omlaag vanaf de bovenrand 120).
      const kader = { x: 18, y: 120 - 70, width: 130, height: 20 };
      const teken = async (filter) => {
        const canvas = napiCanvas.createCanvas(kader.width * px, kader.height * px);
        await page.render({
          canvas,
          viewport: page.getViewport({ scale: px, rotation: 0 }),
          transform: [1, 0, 0, 1, -kader.x * px, -kader.y * px],
          background: '#ffffff',
          ...(filter ? { operationsFilter: filter } : {}),
        }).promise;
        return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      };
      const donker = (img, x0, y0, x1, y1) => {
        let n = 0;
        for (let y = Math.round(y0 * px); y < Math.round(y1 * px); y++) {
          for (let x = Math.round(x0 * px); x < Math.round(x1 * px); x++) {
            const o = (y * img.width + x) * 4;
            if (img.data[o] < 128) n++;
          }
        }
        return n;
      };
      const zonder = await teken(maakAfdekFilter(OPS));
      const met = await teken(null);
      // Tekenkader → uitsnede: x - 18, (120 - y) - 50.
      const tekstGebied = [44 - 18, 120 - 66 - 50, 140 - 18, 120 - 61 - 50]; // boven de lijn, rechts van de verticale
      assert.ok(donker(met, ...tekstGebied) > 50, 'origineel: glyfen in het tekstgebied');
      assert.equal(donker(zonder, ...tekstGebied), 0, 'uitsnede: geen glyfen');
      const horizontaal = [20 - 18, 120 - 60.5 - 50, 140 - 18, 120 - 59.5 - 50];
      const verticaal = [39.5 - 18, 120 - 70 - 50, 40.5 - 18, 120 - 50 - 50];
      assert.ok(donker(zonder, ...horizontaal) >= (120) * px * 0.9, 'horizontale lijn door de tekst blijft staan');
      assert.ok(donker(zonder, ...verticaal) >= 20 * px * 0.9, 'verticale lijn door de tekst blijft staan');
    } finally {
      await doc.loadingTask.destroy();
    }
  });
