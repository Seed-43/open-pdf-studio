// Tekstbewerking van tekst in een Form XObject (#716). De in-place-analyse
// keek alleen in de content streams van de pagina; tekst in een formulier
// viel terug op het afdekvlak en bleef zo in het bestand staan (dubbel bij
// zoeken en kopiëren). Nu zoekt de analyse ook in een Form XObject dat maar
// één keer getekend wordt (CTM = Matrix × CTM bij Do), knipt de tekst daar
// en zet het font van het formulier ook in de pagina-resources.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import {
  PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, decodePDFRawStream,
} from 'pdf-lib';
import * as mupdf from 'mupdf';
import { applyInPlaceTextEdits } from './text-edit-inplace.js';
import { interpretContentStreams } from '../../text/content-stream-text.js';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

// Een simpel font mét /Widths: dan kan de saver de nieuwe tekst in het
// originele font terugschrijven (en moet de fontresource op de pagina staan).
function fontMetBreedtes(context) {
  return context.register(context.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
    FirstChar: 32, LastChar: 126, Widths: Array.from({ length: 95 }, () => 556),
  }));
}

// Pagina met een formulier (Fx1) op 72,600; optioneel twee keer getekend of
// ook op een tweede pagina. De pagina zelf gebruikt /F1 voor een ánder font
// dan het formulier, zodat een naamsbotsing zichtbaar wordt.
async function maakPdf({ tweeKeer = false, tweedePagina = false, matrix = null, eigenFont = true } = {}) {
  const pdf = await PDFDocument.create();
  const ctx = pdf.context;
  const formFont = fontMetBreedtes(ctx);
  const paginaFont = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Courier', Encoding: 'WinAnsiEncoding',
    FirstChar: 32, LastChar: 126, Widths: Array.from({ length: 95 }, () => 600),
  }));
  const fxDict = {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 60],
    Resources: ctx.obj({ Font: ctx.obj({ F1: eigenFont ? formFont : paginaFont }) }),
  };
  if (matrix) fxDict.Matrix = matrix;
  const fx = ctx.register(ctx.flateStream(Buffer.from(
    '0 0 1 RG 1 w 0 0 300 60 re S\nBT /F1 12 Tf 10 25 Td (Tekst in een formulier) Tj ET\n', 'latin1'), fxDict));
  const pagina = (inhoud) => {
    const page = pdf.addPage([595, 842]);
    page.node.set(PDFName.of('Resources'), ctx.obj({
      Font: ctx.obj({ F1: paginaFont }), XObject: ctx.obj({ Fx1: fx }),
    }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(Buffer.from(inhoud, 'latin1'))));
  };
  pagina('q 1 0 0 1 72 600 cm /Fx1 Do Q\n'
    + (tweeKeer ? 'q 1 0 0 1 72 300 cm /Fx1 Do Q\n' : '')
    + 'BT /F1 12 Tf 72 560 Td (Gewone paginatekst eronder) Tj ET\n');
  if (tweedePagina) pagina('q 1 0 0 1 72 600 cm /Fx1 Do Q\n');
  return PDFDocument.load(await pdf.save({ useObjectStreams: false }));
}

const record = (x = 82, y = 625) => ({
  id: 'fx1', page: 1, originalText: 'Tekst in een formulier', newText: 'Tekst in een XObject',
  pdfX: x, pdfY: y, fontSize: 12, textAngle: 0, color: '#000000',
  fontFamily: 'Helvetica', loadedFontName: 'g_d0_f1',
  originalLineInfo: [{ x, y, text: 'Tekst in een formulier', fontSize: 12, angle: 0 }],
  originalSpanTexts: [['Tekst in een formulier']],
});

function formulierTekst(doc) {
  const res = doc.getPages()[0].node.Resources();
  const fx = res.lookup(PDFName.of('XObject'), PDFDict).lookup(PDFName.of('Fx1'));
  assert.ok(fx instanceof PDFRawStream);
  return latin1(decodePDFRawStream(fx).decode());
}

test('tekst in een formulier dat één keer getekend wordt: geknipt in het formulier', async () => {
  const doc = await maakPdf();
  const edit = record();
  const r = applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit);
  assert.ok(r, 'de run in het formulier is in-place te knippen');
  assert.equal(r.needsCover, false);
  const fx = formulierTekst(doc);
  assert.ok(!fx.includes('Tekst in een formulier'), 'de oude tekst staat niet meer in het formulier');
  assert.ok(fx.includes('re S'), 'het lijnwerk van het formulier blijft staan');
});

test('de Matrix van het formulier telt mee in de positie (Matrix × CTM)', async () => {
  const doc = await maakPdf({ matrix: [1, 0, 0, 1, 5, 0] });
  const edit = record(87, 625);
  assert.ok(applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit));
  // Op de oude plek (zonder Matrix) bestaat de run niet.
  const doc2 = await maakPdf({ matrix: [1, 0, 0, 1, 40, 0] });
  const edit2 = record(82, 625);
  assert.equal(applyInPlaceTextEdits(doc2, doc2.getPages(), [edit2]).get(edit2), undefined);
});

test('het font van het formulier komt in de pagina-resources, zonder naamsbotsing', async () => {
  const doc = await maakPdf();
  const edit = record();
  const r = applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit);
  const enc = r.encodeRun('Tekst in een XObject', 0, 12);
  assert.ok(enc, 'de nieuwe tekst is in het originele font te coderen');
  const paginaFonts = doc.getPages()[0].node.Resources().lookup(PDFName.of('Font'), PDFDict);
  const formFonts = doc.getPages()[0].node.Resources().lookup(PDFName.of('XObject'), PDFDict)
    .lookup(PDFName.of('Fx1')).dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict);
  assert.notEqual(enc.fontKey, 'F1', '/F1 van de pagina is een ander font');
  assert.equal(paginaFonts.get(PDFName.of(enc.fontKey)), formFonts.get(PDFName.of('F1')),
    'de paginasleutel wijst naar het font van het formulier');
  // Dezelfde sleutel bij een tweede run.
  assert.equal(r.encodeRun('XObject', 0, 12).fontKey, enc.fontKey);
});

test('opslaan: de oude tekst is weg, de nieuwe staat er één keer, in het originele font', async () => {
  const doc = await maakPdf();
  const edit = record();
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] });
  const bytes = await doc.save({ useObjectStreams: false });
  // Extractie zoals zoeken en kopiëren haar zien (MuPDF).
  const tekst = mupdf.Document.openDocument(bytes, 'application/pdf').loadPage(0).toStructuredText().asText();
  assert.ok(!tekst.includes('formulier'), `de oude tekst is uit de extractie: ${tekst}`);
  assert.equal(tekst.split('Tekst in een XObject').length - 1, 1, `de nieuwe tekst staat er één keer: ${tekst}`);
  assert.ok(tekst.includes('Gewone paginatekst eronder'));
  const opnieuw = await PDFDocument.load(bytes);
  const fx = formulierTekst(opnieuw);
  const page = opnieuw.getPages()[0];
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map(ref => latin1(decodePDFRawStream(opnieuw.context.lookup(ref)).decode()))
    : [latin1(decodePDFRawStream(contents).decode())];
  const alles = [...streams, fx].join('\n');
  assert.ok(!alles.includes('formulier'), 'geen oude tekst meer in pagina of formulier');
  // De nieuwe tekst staat als hex in het originele font: decodeer de ops.
  const ops = interpretContentStreams(streams);
  const teksten = ops.map(op => op.strings.map(s => String.fromCharCode(...s)).join(''));
  assert.equal(teksten.filter(t => t === 'Tekst in een XObject').length, 1);
  const nieuw = ops[teksten.indexOf('Tekst in een XObject')];
  const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
  assert.equal(String(fonts.lookup(PDFName.of(nieuw.font), PDFDict).get(PDFName.of('BaseFont'))), '/Helvetica');
  assert.ok(Math.abs(nieuw.x - 82) < 0.01 && Math.abs(nieuw.y - 625) < 0.01, 'op het anker van het origineel');
});

test('een formulier met hetzelfde font als de pagina gebruikt de paginasleutel', async () => {
  const doc = await maakPdf({ eigenFont: false });
  const edit = record();
  const r = applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit);
  assert.ok(r);
  assert.equal(r.encodeRun('Tekst', 0, 12).fontKey, 'F1', 'zelfde font als de pagina: de paginasleutel');
});

test('een formulier dat twee keer getekend wordt, blijft onaangeroerd', async () => {
  const doc = await maakPdf({ tweeKeer: true });
  const edit = record();
  assert.equal(applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit), undefined);
  assert.ok(formulierTekst(doc).includes('Tekst in een formulier'));
});

test('een formulier dat ook op een andere pagina staat, blijft onaangeroerd', async () => {
  const doc = await maakPdf({ tweedePagina: true });
  const edit = record();
  assert.equal(applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit), undefined);
  assert.ok(formulierTekst(doc).includes('Tekst in een formulier'));
});

test('een formulier dat ook in de weergave van een annotatie staat, blijft onaangeroerd', async () => {
  const doc = await maakPdf();
  const ctx = doc.context;
  const page = doc.getPages()[0];
  const fx = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict).get(PDFName.of('Fx1'));
  const ap = ctx.register(ctx.flateStream(Buffer.from('/Fx1 Do', 'latin1'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 60],
    Resources: ctx.obj({ XObject: ctx.obj({ Fx1: fx }) }),
  }));
  const annot = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 300, 60], AP: ctx.obj({ N: ap }),
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  const edit = record();
  assert.equal(applyInPlaceTextEdits(doc, doc.getPages(), [edit]).get(edit), undefined);
  assert.ok(formulierTekst(doc).includes('Tekst in een formulier'));
});
