// Lijnkoppen van pijlen naar /LE (ISO 32000 tabel 176) en terug, op één plek
// voor de saver en de loader (zie lijnkoppen.test.mjs).

const NAAR_LE = {
  open: 'OpenArrow',
  closed: 'ClosedArrow',
  diamond: 'Diamond',
  circle: 'Circle',
  square: 'Square',
  slash: 'Slash',
  butt: 'Butt',
  openReversed: 'ROpenArrow',
  closedReversed: 'RClosedArrow',
  // Geen eigen /LE-naam: de dichtstbijzijnde, plus /OPS_LineHeads.
  stealth: 'OpenArrow',
};
const UIT_LE = {
  OpenArrow: 'open',
  ClosedArrow: 'closed',
  Diamond: 'diamond',
  Circle: 'circle',
  Square: 'square',
  Slash: 'slash',
  Butt: 'butt',
  ROpenArrow: 'openReversed',
  RClosedArrow: 'closedReversed',
};
const BEKEND = new Set(['none', ...Object.keys(NAAR_LE)]);

/** /LE-naam (zonder '/') van een kop van de app. */
export function kopNaarLE(kop) {
  return NAAR_LE[kop] || 'None';
}

/**
 * Waarde voor /OPS_LineHeads ('begin,eind'), of null als /LE beide koppen
 * exact vastlegt.
 */
export function koppenSleutel(startHead, endHead) {
  const exact = (k) => !k || k === 'none' || UIT_LE[kopNaarLE(k)] === k;
  return exact(startHead) && exact(endHead) ? null : `${startHead || 'none'},${endHead || 'none'}`;
}

/**
 * Koppen bij het inlezen. /OPS_LineHeads geldt per uiteinde, en alleen zolang
 * het nog bij /LE past: een ander programma kan /LE wijzigen en deze sleutel
 * laten staan. Anders telt /LE.
 * @param {string[]} le  /LE-namen zoals PDF.js ze geeft
 * @param {string|null|undefined} sleutel  /OPS_LineHeads
 */
export function koppenUitBestand(le, sleutel) {
  const uitLe = { startHead: UIT_LE[le?.[0]] || 'none', endHead: UIT_LE[le?.[1]] || 'none' };
  if (typeof sleutel !== 'string') return uitLe;
  const koppen = sleutel.split(',').map((s) => s.trim());
  const kies = (i) => (BEKEND.has(koppen[i]) && kopNaarLE(koppen[i]) === (le?.[i] || 'None') ? koppen[i] : null);
  return { startHead: kies(0) || uitLe.startHead, endHead: kies(1) || uitLe.endHead };
}

// ── Lint en eigenschappenpaneel ───────────────────────────────────────────

/**
 * Typen waarvan het lint (Start/Einde) en het eigenschappenpaneel de koppen
 * instellen: de typen die ze ook tekenen en opslaan. Een gewone lijn tekent
 * geen koppen, maatlijnen hebben hun eigen koppen en voorkeuren.
 */
export const LINT_LIJNKOP_TYPES = new Set(['arrow', 'splineArrow', 'callout']);

export function lintZetLijnkoppen(type) {
  return LINT_LIJNKOP_TYPES.has(type);
}

/**
 * De koppen en kopgrootte zoals het scherm ze tekent: die van de annotatie,
 * anders de standaard van het type (een callout: dichte punt van 7, een pijl:
 * open punt van 8).
 */
export function koppenVan(ann) {
  const callout = ann?.type === 'callout';
  return {
    startHead: ann?.startHead || 'none',
    endHead: ann?.endHead || (callout ? 'closed' : 'open'),
    headSize: ann?.headSize || (callout ? 7 : 8),
  };
}

// ── Callout (FreeText met /CL) ────────────────────────────────────────────
// Bij een FreeText is /LE één naam, voor het eerste punt van /CL: de punt
// (ISO 32000-1, tabel 174). Voor de kop aan de kant van het tekstvak bestaat
// geen standaardsleutel; beide koppen gaan daarom ook in /OPS_LineHeads.

/** /LE (naam zonder '/') en /OPS_LineHeads van een callout. */
export function calloutKoppenNaarBestand(startHead, endHead) {
  return { le: kopNaarLE(endHead), sleutel: `${startHead || 'none'},${endHead || 'none'}` };
}

/**
 * Koppen van een callout bij het inlezen.
 * @param {string|string[]|undefined} le  /LE: een naam, of (ander programma) een rij namen
 * @param {string|null|undefined} sleutel  /OPS_LineHeads
 * @param {{eigenBestand?: boolean}} opties  eigenBestand: de app schreef de
 *   callout (/OPS_Rotation). Zonder /OPS_LineHeads is dat een bestand van vóór
 *   #612: /LE was toen altijd /OpenArrow, het scherm toonde een dichte punt.
 */
export function calloutKoppenUitBestand(le, sleutel, { eigenBestand = false } = {}) {
  const naam = (Array.isArray(le) ? le[0] : le) || 'None';
  const uitLe = UIT_LE[naam] || 'none';
  if (typeof sleutel !== 'string') {
    return { startHead: 'none', endHead: eigenBestand && naam === 'OpenArrow' ? 'closed' : uitLe };
  }
  const [start, eind] = sleutel.split(',').map((s) => s.trim());
  return {
    // Het tekstvak-einde heeft geen /LE om tegen te toetsen.
    startHead: BEKEND.has(start) ? start : 'none',
    // De punt alleen zolang hij nog bij /LE past (een ander programma kan
    // /LE wijzigen en deze sleutel laten staan).
    endHead: BEKEND.has(eind) && kopNaarLE(eind) === naam ? eind : uitLe,
  };
}
