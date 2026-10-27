// Tekens die geen enkel beschikbaar font heeft (#717). Hangul staat niet in de
// gebundelde fonts (Liberation Sans, Noto Sans TC/SC). Eerder werd zo'n teken
// bij het opslaan stil een '?', terwijl het scherm het wel toonde. Nu:
// - tekst die geen font in zijn geheel heeft, gaat per teken naar het
//   originele font (de subset) of een gebundeld font;
// - een teken dat nergens in staat, weigert de opslag en wordt genoemd;
// - de controle bij het bevestigen (glyf-dekking.js) zegt hetzelfde.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as mupdf from 'mupdf';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { saveTextEditsToPages } = await import('./text-edits.js');
const {
  kandidaatTekens, zonderGlyf, ontbrekendeTekensNu, laadBundelDekking, vergeetBundelDekking,
  isOntbrekendeGlyfenFout, tekensVoorMelding,
} = await import('../../text/glyf-dekking.js');

const LIBERATION = fs.readFileSync(new URL('../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
const liberation = fontkit.create(LIBERATION);

// Alleen Liberation Sans als gebundeld font: geen Hangul, wel Łódź.
const geenEnkelFont = async () => { throw new Error('geen font met alle tekens'); };
const liberationKeten = async (pdfDoc) => ({
  index: (cp) => (liberation.hasGlyphForCodePoint(cp) ? 0 : -1),
  embed: async () => {
    pdfDoc.registerFontkit(fontkit);
    return { font: await pdfDoc.embedFont(LIBERATION, { subset: true }), name: 'LiberationSans-Regular' };
  },
});

function tekstVan(bytes) {
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  return d.loadPage(0).toStructuredText().asText();
}

const record = (oud, nieuw, extra = {}) => ({
  id: 'g1', page: 1, originalText: oud, newText: nieuw,
  pdfX: 72, pdfY: 700, pdfWidth: 70, fontSize: 12, lineSpacing: 14.4, numOriginalLines: 1,
  fontFamily: 'Helvetica', loadedFontName: '', color: '#000000', textAngle: 0,
  originalLineInfo: [{ x: 72, y: 700, width: 70, fontSize: 12, angle: 0, text: oud }],
  originalSpanTexts: [[oud]],
  ...extra,
});

async function helveticaPdf(tekst) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(
    `BT /F1 12 Tf 72 700 Td (${tekst}) Tj ET\n`)));
  return PDFDocument.load(await pdf.save({ useObjectStreams: false }));
}

test('een teken dat geen font heeft, weigert de opslag en wordt genoemd', async () => {
  const doc = await helveticaPdf('Plaats: Lodz');
  const edit = record('Plaats: Lodz', 'Plaats: 안녕 Lodz');
  let fout = null;
  try {
    await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] },
      { kiesUnicodeFont: geenEnkelFont, fontKeten: liberationKeten });
  } catch (e) { fout = e; }
  assert.ok(fout, 'de opslag ging door; het bestand kreeg "??"');
  assert.ok(isOntbrekendeGlyfenFout(fout), String(fout));
  assert.deepEqual(fout.tekens, ['안', '녕']);
  assert.equal(tekensVoorMelding(fout.tekens), '안 녕');
});

test('andere bewerkingen laten een weigering niet stil verdwijnen', async () => {
  // Eén bewerking zonder font en één gewone: de hele opslag weigert (de
  // saver slaat de mislukte niet over, zoals bij andere fouten).
  const doc = await helveticaPdf('Plaats: Lodz');
  const goed = record('Plaats: Lodz', 'Plaats: Delft', { id: 'g2' });
  const fout = record('Plaats: Lodz', '가', { id: 'g3', pdfY: 600,
    originalLineInfo: [{ x: 72, y: 600, width: 70, fontSize: 12, angle: 0, text: 'x' }] });
  await assert.rejects(saveTextEditsToPages(doc, doc.getPages(), { textEdits: [goed, fout] },
    { kiesUnicodeFont: geenEnkelFont, fontKeten: liberationKeten }), (e) => isOntbrekendeGlyfenFout(e));
});

test('tekst die geen font in zijn geheel heeft: per teken het originele font of een gebundeld font', async () => {
  // Het originele font is een subset (alleen de tekens van "Plaats: Lodz");
  // Ł staat er niet in maar wel in Liberation. Geen enkel font in zijn geheel
  // (geïnjecteerd): per teken.
  const bron = await PDFDocument.create();
  bron.registerFontkit(fontkit);
  const subset = await bron.embedFont(LIBERATION, { subset: true });
  bron.addPage([595, 842]).drawText('Plaats: Lodz', { x: 72, y: 700, size: 12, font: subset });
  const doc = await PDFDocument.load(await bron.save({ useObjectStreams: false }));
  const edit = record('Plaats: Lodz', 'Plaats: Łodz', {
    lineStyles: [{ fontFamily: 'Helvetica', fontSize: 12, color: '#000000', loadedFontName: 'g_d0_f1' }],
  });
  await saveTextEditsToPages(doc, doc.getPages(), { textEdits: [edit] },
    { kiesUnicodeFont: geenEnkelFont, fontKeten: liberationKeten });
  const tekst = tekstVan(await doc.save());
  assert.match(tekst, /Plaats: Łodz/);
  assert.doesNotMatch(tekst, /\?|Plaats: Lodz/);
});

test('bevestigen: de tekens zonder font, met de originele tekst als bekend', async () => {
  // Kandidaten: niet WinAnsi, geen witruimte, niet in de originele tekst.
  assert.deepEqual(kandidaatTekens('안녕히 가세요 é', '안녕하세요'), ['히', '가']);
  assert.deepEqual(kandidaatTekens('Łódź', ''), ['Ł', 'ź']);
  const heeft = (cp) => liberation.hasGlyphForCodePoint(cp);
  assert.deepEqual(zonderGlyf(['히', 'Ł'], [heeft]), ['히']);

  vergeetBundelDekking();
  // Nog niet geladen: niet te zeggen.
  assert.equal(ontbrekendeTekensNu('안녕히', '안녕'), null);
  // Alleen WinAnsi of bekende tekens: niets na te gaan.
  assert.deepEqual(ontbrekendeTekensNu('Lodz', ''), []);
  await laadBundelDekking(async () => [heeft]);
  assert.deepEqual(ontbrekendeTekensNu('안녕히 가세요', '안녕하세요'), ['히', '가']);
  assert.deepEqual(ontbrekendeTekensNu('Łódź', 'Lodz'), []);
  vergeetBundelDekking();
});

test('de meldingen staan in alle 40 talen, met de tekens, en de code gebruikt ze', () => {
  const locales = new URL('../../i18n/locales/', import.meta.url);
  const talen = fs.readdirSync(locales);
  assert.equal(talen.length, 40);
  const SLEUTELS = ['textEditMissingGlyphs', 'textEditMissingGlyphsLater', 'textEditMissingGlyphsSave'];
  const lees = (taal) => JSON.parse(fs.readFileSync(new URL(`${taal}/common.json`, locales), 'utf8'));
  const en = lees('en');
  for (const taal of talen) {
    const c = lees(taal);
    for (const k of SLEUTELS) {
      assert.ok(typeof c[k] === 'string' && c[k].includes('{{chars}}'), `${taal}: ${k}`);
      if (taal !== 'en') assert.notEqual(c[k], en[k], `${taal}: ${k} niet vertaald`);
    }
  }
  const code = ['../../tools/text-edit-tool.js', '../saver.js']
    .map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  for (const k of SLEUTELS) assert.ok(code.includes(`'${k}'`), `de code gebruikt ${k} niet`);
});
