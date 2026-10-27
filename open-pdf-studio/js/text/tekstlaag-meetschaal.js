/**
 * Meetschaal voor de PDF.js-tekstlaag (#506, deel 2).
 *
 * PDF.js maakt elke tekstrun een span en rekt die met --scale-x tot de
 * breedte uit de PDF. Daarvoor meet het de run op een canvas, op de
 * lettergrootte × viewport.scale × devicePixelRatio. Verder doet de schaal
 * niets aan de laag: left/top staan in procenten van het paginakader en de
 * lettergrootte loopt via --total-scale-factor.
 *
 * Na het sluiten van het laatste tabblad past de viewport de zoom in op een
 * verborgen 0×0-container: zoom = 1/paginahoogte (≈ 0,0012). Het volgende
 * document bouwde zijn tekstlaag met die schaal, dus PDF.js mat op ≈ 0,02 px.
 * Daar geeft Chromium ongeveer de halve breedte terug; --scale-x werd ≈ 2 en
 * elke span twee keer te breed. In de enkele-paginaweergave wordt de laag bij
 * zoomen niet herbouwd, dus de te brede spans bleven staan: overlappende
 * selectievlakken (donkere banden op woordgrenzen) en vlakken voorbij de
 * tekst.
 *
 * Meten op minstens schaal 1 houdt de meetgrootte ruim boven die grens; de
 * meting is daarboven lineair, dus --scale-x verandert verder niet.
 */

/** Kleinste schaal waarop PDF.js de tekstruns meet. */
export const MIN_MEETSCHAAL = 1;

/**
 * De viewport die PDF.js' TextLayer krijgt: dezelfde pagina, rotatie en
 * kader, maar nooit onder MIN_MEETSCHAAL. Een viewport zonder clone() (geen
 * PDF.js-PageViewport) gaat ongewijzigd door.
 * @param {object} viewport  PDF.js PageViewport
 * @returns {object}
 */
export function meetViewportVoorTekstlaag(viewport) {
  if (!viewport || typeof viewport.clone !== 'function') return viewport;
  const schaal = Number(viewport.scale);
  if (Number.isFinite(schaal) && schaal >= MIN_MEETSCHAAL) return viewport;
  return viewport.clone({ scale: MIN_MEETSCHAAL });
}
