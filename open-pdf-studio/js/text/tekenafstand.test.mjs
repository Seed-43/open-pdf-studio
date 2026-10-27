// Gespatieerde tekst bewerken (#718). Bij Tc 2 geeft PDF.js de kop
// "Gespatieerde kop" als "G e s p a t i e e r d e" + "k o p". De editor
// toonde die spaties en de vervanging kwam er met die spaties én met de Tc
// van het origineel uit: dubbele afstand. Nu gaan de spaties bij het openen
// weg en houdt de vervanging de Tc (ook op de terugvalroute).
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { zonderSpatieringsSpaties, lijktGespatieerd, tekenafstandPerItem } from './tekenafstand.js';
import { textEditLineCharSpacing } from './text-edit-appearance.js';
import { interpretContentStreams } from './content-stream-text.js';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('../pdf/saver/text-edits.js');

async function pdfMet(inhoud) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(inhoud)));
  return pdf.save({ useObjectStreams: false });
}
const GESPATIEERD = 'BT /F1 12 Tf 2 Tc 72 450 Td (Gespatieerde kop) Tj ET 0 Tc\n'
  + 'BT /F1 12 Tf 72 400 Td (Gewone regel) Tj ET\n'
  + 'BT /F1 6 Tf 2 0 0 2 72 350 Tm 1 Tc (Geschaald) Tj ET\n';

async function pdfjsItems(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const items = (await pagina.getTextContent()).items.filter((i) => i.str !== undefined);
  const ops = await pagina.getOperatorList();
  const tcs = tekenafstandPerItem(items, ops, pdfjs.OPS);
  await doc.loadingTask.destroy();
  return items.map((item, i) => ({ str: item.str, tc: tcs[i] }));
}

test('de spaties van de tekstextractie tussen gespatieerde letters gaan weg', () => {
  assert.equal(zonderSpatieringsSpaties('G e s p a t i e e r d e  k o p'), 'Gespatieerde kop');
  assert.equal(zonderSpatieringsSpaties('G e s p a t i e e r d e'), 'Gespatieerde');
  assert.equal(zonderSpatieringsSpaties('k o p'), 'kop');
  assert.equal(zonderSpatieringsSpaties('Een gewone zin'), 'Een gewone zin');
  assert.equal(zonderSpatieringsSpaties(' '), ' ');
  assert.equal(lijktGespatieerd('G e s p a t'), true);
  assert.equal(lijktGespatieerd('Een gewone zin'), false);
});

test('de tekenafstand per tekstitem komt uit de operatorlijst (in punten van de pagina)', async () => {
  const items = await pdfjsItems(await pdfMet(GESPATIEERD));
  const kop = items.filter((i) => /G e s p|k o p/.test(i.str));
  assert.ok(kop.length >= 1, JSON.stringify(items));
  // PDF.js zette de spaties: dat is het probleem van #718.
  assert.ok(kop.some((i) => i.str.includes('G e s p a t')), JSON.stringify(kop));
  for (const i of kop) assert.equal(i.tc, 2);
  assert.equal(kop.map((i) => zonderSpatieringsSpaties(i.str).trim()).filter(Boolean).join(' '), 'Gespatieerde kop');
  const gewoon = items.find((i) => i.str.includes('Gewone'));
  assert.equal(gewoon.tc, 0);
  // Tc staat in tekstruimte: met Tm 2× is het 2 pt op de pagina.
  const geschaald = items.find((i) => /G ?e ?s ?c ?h/.test(i.str));
  assert.ok(Math.abs(geschaald.tc - 2) < 1e-6, JSON.stringify(geschaald));
});

test('de vervanging houdt de Tc, ook als de tekst niet in het originele font kan', async () => {
  // Standaard-Helvetica zonder /Widths: de saver schrijft in Standard-14 (de
  // terugvalroute). Zonder lineCharSpacing kwam de kop zonder afstand terug.
  const doc = await PDFDocument.load(await pdfMet(GESPATIEERD));
  const edit = {
    id: 'tc1', page: 1, originalText: 'Gespatieerde\tkop', newText: 'Gespatieerde\ttitel',
    pdfX: 72, pdfY: 450, pdfWidth: 124.7, fontSize: 12, lineSpacing: 14.4, numOriginalLines: 1,
    fontFamily: 'Helvetica', loadedFontName: 'Helvetica', color: '#000000', textAngle: 0,
    lineStyles: [{ fontFamily: 'Helvetica', fontSize: 12, color: '#000000', loadedFontName: 'Helvetica' }],
    lineSegments: [[{ text: 'Gespatieerde', dx: 0 }, { text: 'titel', dx: 101.372 }]],
    lineCharSpacing: [2],
    originalLineInfo: [{ x: 72, y: 450, width: 124.7, fontSize: 12, angle: 0, text: 'G e s p a t i e e r d e k o p' }],
    originalSpanTexts: [['G e s p a t i e e r d e', ' ', 'k o p']],
  };
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] });
  const pagina = doc.getPages()[0];
  const streams = pagina.node.Contents().asArray().map((ref) => {
    const st = doc.context.lookup(ref);
    const bytes = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getUnencodedContents();
    return Buffer.from(bytes).toString('latin1');
  });
  // Standard-14 (WinAnsi): één byte per teken.
  const ops = interpretContentStreams(streams)
    .map((o) => ({ ...o, text: (o.strings || []).map((b) => Buffer.from(b).toString('latin1')).join('') }));
  const nieuw = ops.filter((o) => /titel|Gespatieerde/.test(o.text || ''));
  assert.ok(nieuw.length >= 2, JSON.stringify(ops.map((o) => [o.text, o.tc])));
  for (const o of nieuw) {
    assert.equal(o.tc, 2, `"${o.text}" zonder de Tc van het origineel`);
    assert.doesNotMatch(o.text, /G e s/, 'de spaties van de extractie staan in het bestand');
  }
  // De oude kop is weg.
  assert.ok(!ops.some((o) => /Gespatieerde kop/.test(o.text || '')));
});

test('lineCharSpacing per regel; nieuwe regels erven de laatste', () => {
  assert.equal(textEditLineCharSpacing({ lineCharSpacing: [2, 0] }, 0), 2);
  assert.equal(textEditLineCharSpacing({ lineCharSpacing: [2, 0] }, 1), 0);
  assert.equal(textEditLineCharSpacing({ lineCharSpacing: [1.5] }, 3), 1.5);
  assert.equal(textEditLineCharSpacing({}, 0), 0);
});
