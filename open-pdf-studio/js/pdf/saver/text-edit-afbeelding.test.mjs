// Tekstbewerking op een afbeelding (text-edit-inplace.js): wanneer moet de
// saver de oude tekst wit afdekken?
// - zichtbare tekst over een foto: niet. De tekst zit niet in de pixels; het
//   witte vlak sloeg een gat in de afbeelding (live én in het bestand);
// - onzichtbare tekst (Tr 3, een OCR-laag over een scan): wel;
// - tekst die de afbeelding daarna overschildert: wel (de zichtbare tekst is
//   de afbeelding).
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import { applyInPlaceTextEdits } from './text-edit-inplace.js';
import { interpretContentStreams } from '../../text/content-stream-text.js';

const PNG_1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==', 'base64'));

async function pdfMet(inhoud) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const img = await pdf.embedPng(PNG_1x1);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.setXObject(PDFName.of('Im1'), img.ref);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(inhoud)));
  return PDFDocument.load(await pdf.save({ useObjectStreams: false }));
}
const BEELD = 'q 400 0 0 150 60 500 cm /Im1 Do Q\n';
const tekst = (tr = 0) => `BT /F1 14 Tf ${tr} Tr 80 560 Td (Tekst over afbeelding) Tj ET\n`;
const record = () => ({
  id: 't1', page: 1, originalText: 'Tekst over afbeelding', newText: 'Tekst boven afbeelding',
  pdfX: 80, pdfY: 560, fontSize: 14, textAngle: 0,
  originalLineInfo: [{ x: 80, y: 560, text: 'Tekst over afbeelding', fontSize: 14, angle: 0 }],
});
async function analyse(inhoud) {
  const doc = await pdfMet(inhoud);
  const edit = record();
  return applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit);
}

test('zichtbare tekst over een foto: knippen zonder wit vlak', async () => {
  const r = await analyse(BEELD + tekst(0));
  assert.ok(r, 'de run is in-place te knippen');
  assert.equal(r.needsCover, false);
});

test('onzichtbare tekst over een scan (OCR-laag): wit afdekken', async () => {
  const r = await analyse(BEELD + tekst(3));
  assert.ok(r);
  assert.equal(r.needsCover, true);
});

test('tekst onder een afbeelding (daarna overschilderd): wit afdekken', async () => {
  const r = await analyse(tekst(0) + BEELD);
  assert.ok(r);
  assert.equal(r.needsCover, true);
});

test('de interpreter zet de tekst-state terug bij Q en volgt Tr', () => {
  const ops = interpretContentStreams([
    'q BT /F1 12 Tf 2 Tc 3 Tr 10 10 Td (a) Tj ET Q BT /F2 9 Tf 20 20 Td (b) Tj ET',
  ]);
  assert.equal(ops[0].tc, 2);
  assert.equal(ops[0].tr, 3);
  assert.equal(ops[1].tc, 0, 'Tc hoort na Q terug te staan');
  assert.equal(ops[1].tr, 0, 'Tr hoort na Q terug te staan');
  assert.equal(ops[1].font, 'F2');
});
