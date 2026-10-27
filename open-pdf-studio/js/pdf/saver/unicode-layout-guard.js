/** Reject shaped glyphs that pdf-lib cannot map back to Unicode. A successful
 * font subset is not proof that copy/search preserves text. Do not turn off
 * shaping features or invent Unicode values to make an extraction test pass.
 */
export class UnicodeLayoutError extends Error {
  constructor(code) {
    super(`${code}: this font cannot preserve the requested text in a PDF`);
    this.name = 'UnicodeLayoutError';
    this.code = code;
  }
}

export function withUnicodeLayoutGuard(fontkit) {
  return {
    create(bytes, postscriptName) {
      const font = fontkit.create(bytes, postscriptName);
      const layout = font.layout;
      font.layout = function (text, ...args) {
        for (const char of String(text)) {
          if (!font.hasGlyphForCodePoint(char.codePointAt(0))) {
            throw new UnicodeLayoutError('PDF_MISSING_GLYPH');
          }
        }
        const run = layout.call(this, text, ...args);
        for (const glyph of run.glyphs) {
          if (glyph.id === 0) throw new UnicodeLayoutError('PDF_MISSING_GLYPH');
          if (!glyph.codePoints?.length) throw new UnicodeLayoutError('PDF_UNMAPPED_SHAPED_GLYPH');
        }
        return run;
      };
      return font;
    },
  };
}
