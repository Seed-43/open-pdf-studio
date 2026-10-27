// Tellingen (#621).
//
// - De telmarkering van de app (type 'count'): één genummerde stip op een
//   punt. Zie saver/telling.js voor het opslaan.
// - Een telling van een ander programma: een /Polygon met /IT /PolygonCount;
//   elk hoekpunt is één getelde plek. De app laadt hem als veelhoek met de
//   ruwe sleutels (saver/ruwe-sleutels.js) en tekent hem als stippen op de
//   hoekpunten, niet als gesloten veelhoek: zo tekent dat programma hem ook.
//
// Puur: geen DOM, geen pdf-lib.

/** Straal van een telstip in punten (zoals het scherm de eigen telmarkering tekent). */
export const TELSTIP_STRAAL = 9;

/** Is dit een telling van een ander programma (/IT /PolygonCount)? */
export function isVreemdeTelling(ann) {
  return ann?.type === 'polygon' && ann?.pdfRaw?.sleutels?.IT?.n === 'PolygonCount';
}

/**
 * Straal van de stippen van een vreemde telling: /CountScale schaalt de
 * standaardmaat (zonder schaal 1). Begrensd, zodat een vreemde waarde geen
 * vlakvullende stip wordt.
 */
export function tellingStraal(ann) {
  const schaal = Number(ann?.pdfRaw?.sleutels?.CountScale);
  const s = Number.isFinite(schaal) && schaal > 0 ? Math.min(schaal, 10) : 1;
  return 4 * s;
}
