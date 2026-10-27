// Tekstbewerking via de MCP-teksttools op een scan met een onzichtbare
// OCR-laag (#720). app_replace_text knipte de OCR-run en zette de nieuwe
// tekst zichtbaar over de scan, zonder afdekking: het gescande woord bleef
// eronder zichtbaar en het antwoord waarschuwde met rasterBackgroundOverlap.
// Nu doet de MCP-route wat de UI-route doet: het gescande woord wordt
// afgedekt, de nieuwe tekst staat er zichtbaar op en de OCR-tekst is
// bijgewerkt (de oude run is weg, de nieuwe tekst is de tekst van de pagina).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import * as mupdf from 'mupdf';
import sharp from 'sharp';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');
const { newRecord, verslag } = await import('../../text/mcp-text-plan.js');

const LIBERATION = readFileSync(new URL('../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
// 1×1 zwart: de "gescande" pixels van het woord.
const ZWART = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000000' } }).png().toBuffer();

// Scanpagina: een zwart blok waar het woord "Gescande tekst" in de pixels
// staat (x 80..170, y 556..570), met de OCR-laag (Tr 3) eroverheen.
async function scanPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const img = await pdf.embedPng(ZWART);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.setXObject(PDFName.of('Im1'), img.ref);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(
    'q 90 0 0 14 80 556 cm /Im1 Do Q\nBT /F1 12 Tf 3 Tr 80 560 Td (Gescande tekst) Tj ET\n')));
  return pdf.save({ useObjectStreams: false });
}

// Het record zoals app_replace_text het maakt (mcp-text-plan.newRecord).
function mcpRecord() {
  const span = {
    id: 'doc:p1:i0-0', text: 'Gescande tekst', fontSize: 12, rotation: 0,
    pdfAnchor: { x: 80, y: 560 }, pdfWidth: 80, fontName: 'g_d0_f1', fontFamily: 'sans-serif',
  };
  return newRecord(span, 1, 'Ok', '#000000');
}

function pixel(bytes, x, y) {
  const page = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(0);
  const zoom = 2;
  const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false, true);
  const px = pix.getPixels();
  const w = pix.getWidth();
  const i = (Math.round((842 - y) * zoom) * w + Math.round(x * zoom)) * 3;
  return px[i];
}

test('MCP op een scan: het gescande woord wordt afgedekt, de nieuwe tekst staat er zichtbaar', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(LIBERATION).buffer });
  try {
    const bron = await scanPdf();
    assert.ok(pixel(bron, 150, 563) < 60, 'vooraf: het gescande woord is zwart');
    const lib = await PDFDocument.load(bron);
    const edit = mcpRecord();
    await saveTextEditsToPages(lib, lib.getPages(), { textEdits: [edit] });
    const uit = await lib.save({ useObjectStreams: false });
    // Rechts van de korte nieuwe tekst ligt alleen nog het afdekvlak.
    assert.ok(pixel(uit, 150, 563) > 200, 'het gescande woord is afgedekt');
    const tekst = mupdf.Document.openDocument(uit, 'application/pdf').loadPage(0).toStructuredText().asText();
    assert.ok(!tekst.includes('Gescande'), `de oude OCR-tekst is weg: ${tekst}`);
    assert.equal(tekst.trim(), 'Ok', 'de nieuwe tekst is de tekst van de pagina');
    // Zichtbaar: de nieuwe glyfen kleuren pixels in het afgedekte vlak.
    let donker = 0;
    for (let x = 80; x < 95; x += 0.5) if (pixel(uit, x, 563) < 128) donker++;
    assert.ok(donker > 0, 'de nieuwe tekst is zichtbaar');
  } finally { globalThis.fetch = oldFetch; }
});

test('het antwoord meldt de afdekking zonder waarschuwing over de scan', () => {
  const plan = {
    span: { id: 's', text: 'Gescande tekst', bbox: {} }, record: { id: 'r', newText: 'Ok', fontSize: 12 },
    textColor: '#000000', fontUsed: 'Helvetica', fontFallback: true, needsCover: true,
  };
  const antwoord = verslag(plan);
  assert.equal(antwoord.rasterBackgroundOverlap, undefined);
  assert.equal(antwoord.warning, undefined);
  assert.equal(antwoord.coveredScannedText, true);
  assert.equal(verslag({ ...plan, needsCover: false }).coveredScannedText, undefined);
});
