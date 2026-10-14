// Toetsen en voorbereiden van tekstvervangingen voor de MCP-teksttools
// (#507), zonder app-state. Eén regel vervangen (app_replace_text) en een
// hele pagina in één keer (app_translate_page) delen deze regels, zodat de
// paginaversie precies dezelfde eisen stelt als de losse.

import { PDFDocument } from 'pdf-lib';
import { applyInPlaceTextEdits } from '../pdf/saver/text-edit-inplace.js';

export const MAX_VERVANGINGEN = 500;

/** `<documentId>:p<page>:i<first>-<last>` uit app_get_page_text. */
export function parseSpanId(spanId) {
  const match = /^(.+):p(\d+):i(\d+)-(\d+)$/.exec(spanId);
  return match ? { documentId: match[1], page: Number(match[2]) } : null;
}

/** De vorm van één vervanging; een foutmelding of null. */
export function vervangingVormFout(item) {
  const { spanId, expectedText, newText } = item || {};
  if (typeof spanId !== 'string' || !spanId || typeof expectedText !== 'string' || typeof newText !== 'string') {
    return 'spanId, expectedText and newText are required strings';
  }
  if (newText.includes('\n') || newText.includes('\r')) return 'replace one line at a time; newText cannot contain line breaks';
  if (!parseSpanId(spanId)) return 'invalid spanId';
  return null;
}

/** Een standaardlettertype van dezelfde soort, voor het tekenen. PDF.js
 *  noemt een schreefloze letter 'sans-serif': dat is geen schreefletter. */
export function fallbackFamily(span) {
  const name = `${span.fontFamily} ${span.fontName}`.toLowerCase();
  const base = /courier|mono|consolas/.test(name) ? 'Courier'
    : /times|(?<!sans-)serif|garamond|georgia|palatino/.test(name) ? 'TimesRoman' : 'Helvetica';
  const bold = /bold|black|heavy/.test(name), italic = /italic|oblique/.test(name);
  if (base === 'Courier') return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Oblique' : '-Oblique') : ''}`;
  if (base === 'TimesRoman') return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Italic' : '-Italic') : ''}`;
  return `${base}${bold ? '-Bold' : ''}${italic ? (bold ? 'Oblique' : '-Oblique') : ''}`;
}

/** De tekstbewerking zoals de saver haar ter plekke toepast. */
export function newRecord(span, page, newText, color) {
  const fontSize = span.fontSize;
  const x = span.pdfAnchor.x, y = span.pdfAnchor.y;
  return {
    id: `mcp-text-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    mcpStrict: true, mcpSpanId: span.id,
    page, originalText: span.text, newText,
    pdfX: x, pdfY: y, pdfWidth: span.pdfWidth,
    fontSize, lineSpacing: fontSize * 1.2, numOriginalLines: 1,
    fontFamily: fallbackFamily(span), loadedFontName: span.fontName,
    pdfFontName: span.fontName, color, textAngle: span.rotation,
    originalLineInfo: [{ x, y, width: span.pdfWidth, fontSize, angle: span.rotation, text: span.text }],
    originalSpanTexts: [[span.text]],
  };
}

/** Heeft deze bronregel al een niet-opgeslagen tekstbewerking? */
export function heeftOpenBewerking(edits, span, page) {
  return (edits || []).some(edit => !edit.baked && edit.page === page
    && (edit.mcpSpanId === span.id || (Math.abs((edit.pdfX || 0) - span.pdfAnchor.x) < span.fontSize
      && Math.abs((edit.pdfY || 0) - span.pdfAnchor.y) < span.fontSize)));
}

/**
 * Eén vervanging toetsen tegen de gelezen pagina (`read` van
 * getPageTextForMcp) en de openstaande bewerkingen.
 * @returns {{error:string}|{unchanged:true}|{span, textColor, record}}
 */
export function planVervanging(read, item, edits) {
  const id = parseSpanId(item.spanId);
  if (!id || read.documentId !== id.documentId) return { error: 'spanId belongs to a different document' };
  if (id.page !== read.page) return { error: 'spanId belongs to a different page' };
  const span = read.spans.find(entry => entry.id === item.spanId);
  if (!span || span.text !== item.expectedText) return { error: 'span changed; call app_get_page_text again' };
  if (item.newText === item.expectedText) return { unchanged: true };
  if (!span.color && !item.color) return { error: 'source text colour could not be determined; provide color as #RRGGBB' };
  const textColor = item.color || span.color;
  if (!/^#[0-9a-f]{6}$/i.test(textColor)) return { error: 'color must be #RRGGBB' };
  if (heeftOpenBewerking(edits, span, read.page)) return { error: 'this source span already has an unsaved text edit' };
  return { span, textColor, record: newRecord(span, read.page, item.newText, textColor) };
}

/** De lettergrootte die de vervanging binnen de oorspronkelijke breedte houdt. */
export function pasGrootte(originalSize, naturalWidth, boxWidth) {
  if (!(naturalWidth > 0) || !(boxWidth > 0)) return { error: 'replacement width cannot be measured' };
  const fitted = originalSize * Math.min(1, boxWidth * 0.98 / naturalWidth);
  if (fitted < Math.max(3, originalSize * 0.25)) return { error: 'replacement does not fit the original text box legibly' };
  return { fontSize: fitted };
}

/**
 * De proef op een wegwerpkopie van de PDF, voor alle plannen samen zoals
 * de saver ze straks samen toepast. Een veilige verwijdering ter plekke is
 * verplicht: een wit afdekvlak zou afbeeldingen en lijnwerk beschadigen.
 * Zet per plan `error`, of `fontUsed`, `fontFallback`, `needsCover` en de
 * passende `record.fontSize`.
 *
 * @param {Uint8Array} sourceBytes
 * @param {Array<{span, record}>} plannen
 * @param {{ embedFont: (pdfDoc, text, opts) => Promise<{font, name}> }} hulp
 */
export async function proefOpKopie(sourceBytes, plannen, { embedFont }) {
  const copy = await PDFDocument.load(sourceBytes.slice(), { ignoreEncryption: true });
  const inPlaceMap = applyInPlaceTextEdits(copy, copy.getPages(), plannen.map(plan => plan.record));
  for (const plan of plannen) {
    const inPlace = inPlaceMap.get(plan.record);
    if (!inPlace) { plan.error = 'source text cannot be removed safely in place'; continue; }
    plan.needsCover = !!inPlace.needsCover;
    plan.fontUsed = plan.span.fontName;
    plan.fontFallback = false;
    const { record } = plan;
    if (!record.newText) continue;
    const originalSize = record.fontSize;
    const bold = /bold/i.test(record.fontFamily), italic = /italic|oblique/i.test(record.fontFamily);
    const encoded = inPlace.encodeRun(record.newText, 0, originalSize,
      { bold, italic, baseBold: bold, baseItalic: italic });
    let naturalWidth = 0;
    if (encoded) naturalWidth = encoded.width;
    else {
      try {
        const picked = await embedFont(copy, record.newText, { bold, italic });
        naturalWidth = picked.font.widthOfTextAtSize(record.newText, originalSize);
        plan.fontUsed = picked.name;
        plan.fontFallback = true;
      } catch (error) {
        plan.error = error?.message || String(error);
        continue;
      }
    }
    const pas = pasGrootte(originalSize, naturalWidth, plan.span.pdfWidth);
    if (pas.error) { plan.error = pas.error; continue; }
    record.fontSize = pas.fontSize;
  }
  return plannen;
}
