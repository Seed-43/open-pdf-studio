// fontkit pas laden als er tekst ingebed wordt: als vaste import zat hij in
// de hoofdbundel en pakte hij bij elke start zijn tabellen uit (#707).
import { embedOcrFont, laadFontkit, loadBundledFontBytes } from '../pdf/saver/ocr-text-layer.js';
import { CJK_FONTS } from '../pdf/saver/cjk-fonts.js';
import { assetUrl } from '../core/basis-url.js';

const latinFonts = {
  regular: 'LiberationSans-Regular.ttf',
  bold: 'LiberationSans-Bold.ttf',
  italic: 'LiberationSans-Italic.ttf',
  boldItalic: 'LiberationSans-BoldItalic.ttf',
};
const fontBytes = new Map();
const embeddedFonts = new WeakMap();
// Eén keer geparste fonts per bestand: de CJK-fonts zijn megabytes groot en
// werden eerder bij elke vervanging opnieuw geparst.
const geparst = new Map();

async function liberationBytes(variant) {
  if (!fontBytes.has(variant)) {
    const belofte = fetch(assetUrl(`pdfjs/web/standard_fonts/${latinFonts[variant]}`))
      .then(response => {
        if (!response.ok) throw new Error(`Could not load ${latinFonts[variant]}`);
        return response.arrayBuffer();
      }).then(buffer => new Uint8Array(buffer));
    fontBytes.set(variant, belofte);
    belofte.catch(() => fontBytes.delete(variant));
  }
  return fontBytes.get(variant);
}

function covers(font, text) {
  return [...text].every(char => font.hasGlyphForCodePoint(char.codePointAt(0)));
}

function variantVan({ bold = false, italic = false } = {}) {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}

/**
 * De gebundelde volledige fonts in volgorde van voorkeur: Liberation Sans in
 * de gevraagde variant, dan Noto Sans TC en SC (zelfde volgorde als de
 * tekstvakken). Pas geladen als de vorige niet volstond; een font dat niet
 * laadt, valt uit de keten.
 * @returns {AsyncGenerator<{ name: string, bytes: Uint8Array, glyphs: { hasGlyphForCodePoint(cp: number): boolean } }>}
 */
async function* gebundeldeFonts(opties = {}) {
  const fontkit = await laadFontkit();
  const variant = variantVan(opties);
  const bronnen = [
    { bestand: latinFonts[variant], laad: () => liberationBytes(variant) },
    ...CJK_FONTS.map(({ bestand }) => ({ bestand, laad: () => loadBundledFontBytes(bestand) })),
  ];
  for (const { bestand, laad } of bronnen) {
    let bytes;
    try { bytes = await laad(); } catch { continue; }
    let item = geparst.get(bestand);
    if (!item || item.bytes !== bytes) {
      try { item = { bytes, glyphs: fontkit.create(bytes) }; } catch { continue; }
      geparst.set(bestand, item);
    }
    yield { name: bestand.replace(/\.(ttf|otf)$/, ''), bytes, glyphs: item.glyphs };
  }
}

/** Alle gebundelde fonts die laden, in volgorde van voorkeur. */
export async function alleGebundeldeFonts(opties = {}) {
  const fonts = [];
  for await (const font of gebundeldeFonts(opties)) fonts.push(font);
  return fonts;
}

async function inbedden(pdfDocLib, { name, bytes }) {
  let embedded = embeddedFonts.get(pdfDocLib);
  if (!embedded) { embedded = new Map(); embeddedFonts.set(pdfDocLib, embedded); }
  if (!embedded.has(name)) embedded.set(name, embedOcrFont(pdfDocLib, bytes));
  return { font: await embedded.get(name), name };
}

/** Choose a bundled full font that really has every requested glyph. */
export async function embedMcpTextFont(pdfDocLib, text, { bold = false, italic = false } = {}) {
  const geprobeerd = [];
  for await (const font of gebundeldeFonts({ bold, italic })) {
    if (covers(font.glyphs, text)) return { ...await inbedden(pdfDocLib, font), fallback: true };
    geprobeerd.push(font);
  }
  // Tekens die geen enkel gebundeld font heeft (bv. Hangul, #717) noemen;
  // sommige kunnen wel in de subset van het originele font staan.
  const zonder = [...new Set([...text].filter(char => char.trim()
    && !geprobeerd.some(f => f.glyphs.hasGlyphForCodePoint(char.codePointAt(0)))))];
  throw new Error('No bundled font contains every replacement glyph'
    + (zonder.length ? ` (not in any bundled font: ${zonder.join(' ')})` : '')
    + '; the PDF was not changed');
}

/**
 * De gebundelde fonts als keten per teken, voor tekst die geen enkel font in
 * zijn geheel heeft (#717): `index(cp)` geeft het eerste font met dat teken
 * (-1: geen), `embed(index)` bedt dat font in.
 */
export async function gebundeldeFontKeten(pdfDocLib, opties = {}) {
  const fonts = await alleGebundeldeFonts(opties);
  return {
    index: (cp) => fonts.findIndex(f => f.glyphs.hasGlyphForCodePoint(cp)),
    embed: (index) => inbedden(pdfDocLib, fonts[index]),
  };
}
