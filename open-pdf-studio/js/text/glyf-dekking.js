// Tekst die geen enkel beschikbaar font kan tonen (#717).
//
// Een tekstbewerking komt in het bestand in het originele font (als de subset
// de tekens heeft), anders in een gebundeld font: Standard-14 voor WinAnsi,
// Liberation Sans en Noto Sans TC/SC voor de rest. Hangul staat in geen van
// die fonts. Eerder werd zo'n teken bij het opslaan stil een '?', terwijl het
// scherm het wel toonde. Nu weigert de app zulke tekst: al bij het bevestigen
// van de bewerking als de dekking dan bekend is, en anders bij het opslaan
// (de saver, met de echte subset van het originele font), vóór er iets in het
// bestand komt.

import { isWinAnsiCodePoint } from './text-edit-appearance.js';

export const FOUT_ONTBREKENDE_GLYFEN = 'TEXT_EDIT_MISSING_GLYPHS';

/** Een tekstbewerking met tekens die geen font heeft; `tekens` noemt ze. */
export class OntbrekendeGlyfenFout extends Error {
  constructor(tekens) {
    const lijst = [...new Set(tekens)];
    super(`No available font has a glyph for: ${lijst.join(' ')}`);
    this.name = 'OntbrekendeGlyfenFout';
    this.code = FOUT_ONTBREKENDE_GLYFEN;
    this.tekens = lijst;
  }
}

/** Is dit een fout van een tekstbewerking met tekens zonder font? */
export function isOntbrekendeGlyfenFout(fout) {
  return !!fout && typeof fout === 'object' && fout.code === FOUT_ONTBREKENDE_GLYFEN
    && Array.isArray(fout.tekens);
}

/**
 * De tekens om na te gaan: uniek, geen witruimte, niet WinAnsi (dat kan
 * altijd, via Standard-14) en niet al in `bekend` (de originele tekst: die
 * tekens staan in de subset van het originele font).
 */
export function kandidaatTekens(tekst, bekend = '') {
  const al = new Set([...String(bekend ?? '')]);
  const uit = [];
  for (const teken of String(tekst ?? '')) {
    if (!teken.trim() || al.has(teken) || uit.includes(teken)) continue;
    if (isWinAnsiCodePoint(teken.codePointAt(0))) continue;
    uit.push(teken);
  }
  return uit;
}

/**
 * Welke tekens heeft geen enkel font?
 * @param {string[]} tekens
 * @param {Array<(cp: number) => boolean>} dekkingen per font
 */
export function zonderGlyf(tekens, dekkingen) {
  return tekens.filter(teken => !dekkingen.some(heeft => heeft(teken.codePointAt(0))));
}

/** De tekens voor een melding: gescheiden door een spatie. */
export function tekensVoorMelding(tekens) {
  return [...new Set(tekens)].join(' ');
}

// De dekking van de gebundelde fonts: één keer geladen, daarna meteen
// beschikbaar, zodat het bevestigen van een bewerking niet hoeft te wachten.
let dekkingNu = null;
let dekkingBelofte = null;

async function standaardDekking() {
  const { alleGebundeldeFonts } = await import('./mcp-text-font.js');
  const fonts = await alleGebundeldeFonts();
  return fonts.map(f => (cp) => f.glyphs.hasGlyphForCodePoint(cp));
}

/**
 * Laad de dekking van de gebundelde fonts (eenmalig).
 * @returns {Promise<Array<(cp: number) => boolean>>}
 */
export function laadBundelDekking(laad = standaardDekking) {
  if (dekkingNu) return Promise.resolve(dekkingNu);
  if (!dekkingBelofte) {
    dekkingBelofte = Promise.resolve().then(laad).then((dekking) => {
      dekkingNu = dekking;
      return dekking;
    }, (fout) => {
      dekkingBelofte = null;
      throw fout;
    });
  }
  return dekkingBelofte;
}

/** De dekking als die al geladen is, anders null. */
export function bundelDekkingNu() {
  return dekkingNu;
}

/** Alleen voor tests: de geladen dekking vergeten. */
export function vergeetBundelDekking() {
  dekkingNu = null;
  dekkingBelofte = null;
}

/**
 * De tekens van `nieuw` die geen beschikbaar font heeft, of null als dat nog
 * niet te zeggen is (dekking nog niet geladen). `bekend`: tekst waarvan de
 * tekens in de subset van het originele font staan.
 */
export function ontbrekendeTekensNu(nieuw, bekend = '') {
  const kandidaten = kandidaatTekens(nieuw, bekend);
  if (!kandidaten.length) return [];
  const dekking = bundelDekkingNu();
  if (!dekking) return null;
  return zonderGlyf(kandidaten, dekking);
}

/** Heeft de tekst tekens waarvoor de dekking nodig is? */
export function heeftKandidaten(nieuw, bekend = '') {
  return kandidaatTekens(nieuw, bekend).length > 0;
}
