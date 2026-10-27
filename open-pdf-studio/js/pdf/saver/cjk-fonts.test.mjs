// De keten van gebundelde CJK-fonts voor tekst die WinAnsi niet kan tonen.
//
// Aanleiding: het gebundelde Noto Sans TC (Traditioneel Chinees) mist
// vereenvoudigde tekens als 测 en 试; die kwamen als lege vakjes in de
// appearance. Per teken kiest de keten het eerste font dat het teken heeft.
// Ontbreekt een fontbestand, dan mag dat het opslaan nooit laten mislukken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

import { CJK_FONTS, verdeelOverFonts, maakCjkFontKeten } from './cjk-fonts.js';

const dekt = (tekens) => (cp) => tekens.includes(String.fromCodePoint(cp));

// ── verdeelOverFonts ───────────────────────────────────────────────────────

test('elk teken gaat naar het eerste font dat het heeft', () => {
  const tc = dekt('中文 日本語テキストABC');
  const sc = dekt('中文测试 日本語テキストABC');
  assert.deepEqual(verdeelOverFonts('中文测试 日本語テキスト ABC', [tc, sc]), [
    { tekst: '中文', index: 0 },
    { tekst: '测试', index: 1 },
    { tekst: ' 日本語テキスト ABC', index: 0 },
  ]);
});

test('een teken dat geen font heeft blijft in de lopende run', () => {
  const tc = dekt('中文');
  const sc = dekt('测');
  assert.deepEqual(verdeelOverFonts('中☃文测☃', [tc, sc]), [
    { tekst: '中☃文', index: 0 },
    { tekst: '测☃', index: 1 },
  ]);
  assert.deepEqual(verdeelOverFonts('☃中', [tc, sc]), [{ tekst: '☃中', index: 0 }]);
});

test('tekens buiten het BMP blijven heel', () => {
  const tc = dekt('𠀀');
  assert.deepEqual(verdeelOverFonts('𠀀', [tc]), [{ tekst: '𠀀', index: 0 }]);
  assert.deepEqual(verdeelOverFonts('', [tc]), []);
});

test('de keten begint bij Traditioneel Chinees en valt terug op Vereenvoudigd', () => {
  assert.deepEqual(CJK_FONTS.map((f) => f.bestand), ['NotoSansTC-Regular.ttf', 'NotoSansSC-Regular.otf']);
  assert.equal(new Set(CJK_FONTS.map((f) => f.naam)).size, CJK_FONTS.length, 'unieke resourcenamen');
});

// ── maakCjkFontKeten ───────────────────────────────────────────────────────

const LIBERATION = readFileSync(new URL('../../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

test('zonder fontbestanden is de keten niet beschikbaar en waarschuwt hij één keer', async () => {
  const doc = await PDFDocument.create();
  const meldingen = [];
  const keten = maakCjkFontKeten(doc, {
    laadBytes: async (bestand) => { throw new Error(`failed to open file at path: C:/x/fonts/${bestand}`); },
    waarschuw: (m) => meldingen.push(m),
  });
  assert.equal(await keten.beschikbaar(), false);
  assert.equal(await keten.beschikbaar(), false);
  assert.equal(meldingen.length, 1, meldingen.join('\n'));
  assert.match(meldingen[0], /NotoSansTC-Regular\.ttf/);
  assert.match(meldingen[0], /NotoSansSC-Regular\.otf/);
  assert.deepEqual(await keten.runs('中文'), []);
  doc.addPage();
  assert.ok((await doc.save()).length > 0, 'het document blijft opslaanbaar');
});

test('ontbreekt één font, dan werkt de keten met de rest', async () => {
  const doc = await PDFDocument.create();
  const meldingen = [];
  const keten = maakCjkFontKeten(doc, {
    laadBytes: async (bestand) => {
      if (bestand === 'NotoSansSC-Regular.otf') throw new Error('failed to open file');
      return LIBERATION;
    },
    waarschuw: (m) => meldingen.push(m),
  });
  assert.equal(await keten.beschikbaar(), true);
  assert.equal(meldingen.length, 1);
  assert.match(meldingen[0], /NotoSansSC-Regular\.otf/);
  const runs = await keten.runs('ABC');
  assert.deepEqual(runs.map((r) => [r.tekst, r.naam]), [['ABC', 'OPSCjk']]);
  assert.ok(keten.ref('OPSCjk'), 'ingebed font heeft een ref');
  assert.equal(keten.ref('OPSCjkSC'), undefined, 'niet gebruikt = niet ingebed');
});

// ── Met de echte gebundelde fonts ──────────────────────────────────────────

const FONTS = new URL('../../../src-tauri/resources/fonts/', import.meta.url);
const aanwezig = CJK_FONTS.every((f) => existsSync(new URL(f.bestand, FONTS)));
const zonderFonts = aanwezig ? false : 'CJK-fonts ontbreken — draai eerst npm run prepare:ocr-runtime';

test('Vereenvoudigd en Japans krijgen allemaal een echte glyph', { skip: zonderFonts }, async () => {
  const doc = await PDFDocument.create();
  const keten = maakCjkFontKeten(doc, {
    laadBytes: async (bestand) => readFileSync(new URL(bestand, FONTS)),
    waarschuw: (m) => assert.fail(m),
  });
  const tekst = '中文测试 日本語テキスト ABC';
  const runs = await keten.runs(tekst);
  assert.equal(runs.map((r) => r.tekst).join(''), tekst);
  assert.deepEqual(runs.map((r) => r.naam), ['OPSCjk', 'OPSCjkSC', 'OPSCjk']);
  for (const r of runs) {
    const glyphs = r.font.embedder.font.glyphsForString(r.tekst);
    assert.ok(glyphs.every((g) => g.id !== 0), `geen .notdef in '${r.tekst}' (${r.naam})`);
  }
  doc.addPage().drawText('x');
  const opnieuw = await PDFDocument.load(await doc.save());
  assert.ok(opnieuw.getPageCount() === 1);
});
