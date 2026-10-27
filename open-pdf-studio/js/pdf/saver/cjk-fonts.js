// Gebundelde CJK-fonts voor tekst die WinAnsi niet kan tonen (Chinees,
// Japans, ...). Noto Sans TC komt eerst: dat dekt Big5 en HKSCS. Noto Sans SC
// vult de vereenvoudigde tekens aan die TC mist (测, 试, ...). Per teken kiest
// de keten het eerste font dat het teken heeft, zodat tekst die TC al toonde
// er precies zo uit blijft zien. Beide staan in src-tauri/resources/fonts
// (scripts/ocr-runtime.mjs).
//
// Een ontbrekend of onleesbaar fontbestand laat het opslaan nooit mislukken:
// de keten waarschuwt één keer en werkt met wat er wel is.

import { embedOcrFont, laadFontkit, loadBundledFontBytes } from './ocr-text-layer.js';

/** De fonts in volgorde van voorkeur, met hun resourcenaam in een appearance. */
export const CJK_FONTS = Object.freeze([
  Object.freeze({ bestand: 'NotoSansTC-Regular.ttf', naam: 'OPSCjk' }),
  Object.freeze({ bestand: 'NotoSansSC-Regular.otf', naam: 'OPSCjkSC' }),
]);

/**
 * Verdeelt tekst in runs per font: elk teken gaat naar het eerste font dat
 * het heeft. Een teken dat geen enkel font heeft, blijft in de lopende run.
 * @param {string} tekst
 * @param {Array<(codePoint: number) => boolean>} dekt per font: heeft het dit teken?
 * @returns {Array<{ tekst: string, index: number }>}
 */
export function verdeelOverFonts(tekst, dekt) {
  const runs = [];
  for (const teken of String(tekst ?? '')) {
    const laatste = runs[runs.length - 1];
    let index = dekt.findIndex((heeft) => heeft(teken.codePointAt(0)));
    if (index < 0) index = laatste ? laatste.index : 0;
    if (laatste && laatste.index === index) laatste.tekst += teken;
    else runs.push({ tekst: teken, index });
  }
  return runs;
}

/**
 * De CJK-fonts voor één op te slaan document. Fonts worden pas geladen bij de
 * eerste vraag en pas ingebed als een run ze echt gebruikt: een ingebed maar
 * ongebruikt font zou een lege subset in het bestand zetten.
 * @param {import('pdf-lib').PDFDocument} pdfDocLib
 * @param {{ laadBytes?: (bestand: string) => Promise<Uint8Array>, waarschuw?: (melding: string) => void }} [opties]
 */
export function maakCjkFontKeten(pdfDocLib, {
  laadBytes = loadBundledFontBytes,
  waarschuw = (melding) => console.warn(melding),
} = {}) {
  let geladen = null;
  const ingebed = new Map();

  const laad = () => {
    geladen ??= (async () => {
      const fontkit = await laadFontkit();
      const fonts = [];
      const fouten = [];
      for (const f of CJK_FONTS) {
        try {
          const bytes = await laadBytes(f.bestand);
          fonts.push({ ...f, bytes, glyphs: fontkit.create(bytes) });
        } catch (fout) {
          fouten.push(`${f.bestand}: ${fout?.message || fout}`);
        }
      }
      if (fouten.length) {
        const gevolg = fonts.length
          ? 'characters only those fonts have show as empty boxes'
          : 'text boxes with such text are saved with a WinAnsi appearance';
        waarschuw(`[save] CJK font not available (${fouten.join('; ')}); ${gevolg}`);
      }
      return fonts;
    })();
    return geladen;
  };

  return {
    /** Is er minstens één CJK-font? */
    async beschikbaar() {
      return (await laad()).length > 0;
    },
    /**
     * Tekst in runs, elk met het ingebedde pdf-lib-font en zijn resourcenaam.
     * Leeg als er geen CJK-font is.
     * @returns {Promise<Array<{ tekst: string, naam: string, font: import('pdf-lib').PDFFont }>>}
     */
    async runs(tekst) {
      const fonts = await laad();
      if (!fonts.length) return [];
      const delen = verdeelOverFonts(tekst, fonts.map((f) => (cp) => f.glyphs.hasGlyphForCodePoint(cp)));
      const uit = [];
      for (const deel of delen) {
        const f = fonts[deel.index];
        if (!ingebed.has(f.naam)) ingebed.set(f.naam, await embedOcrFont(pdfDocLib, f.bytes));
        uit.push({ tekst: deel.tekst, naam: f.naam, font: ingebed.get(f.naam) });
      }
      return uit;
    },
    /** Ref van een ingebed font voor /Resources, of undefined als het niet gebruikt is. */
    ref(naam) {
      return ingebed.get(naam)?.ref;
    },
  };
}
