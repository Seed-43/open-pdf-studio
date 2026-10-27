// Naamgeving van stalen kokerprofielen (koudgevormde buisprofielen) — PURE
// module, zonder app- of DOM-imports, zodat de loader, de IFC-export, de
// constructie-opdracht en de tests hem allemaal kunnen gebruiken.
//
// Schrijfwijze (NL tekenkamer):
//   vierkant     → "K<breedte>/<wanddikte>"          K100/5, K40/3, K300/12.5
//   rechthoekig  → "Koker <b>x<h>x<wanddikte>"       Koker 100x50x5 (ongewijzigd)
//
// Decimalen met een punt, net als de rest van de staalcatalogus (HEA 260
// heeft tf 12.5, "L 45x45x4.5"); een komma in de invoer wordt een punt.
//
// Oudere bestanden en invoer gebruiken nog "Koker 100x100x5" (of "SHS
// 100x100x5", "K100x100x5", ...). Die worden herkend als hetzelfde profiel en
// naar de nieuwe naam omgezet; het symbool-id ('staal-koker') blijft gelijk.

import { leesGetal } from '../core/getal-invoer.js';

export const KOKER_SYMBOOL_ID = 'staal-koker';

const GETAL = String.raw`(\d+(?:[.,]\d+)?)`;
const KRUIS = String.raw`\s*[x×*]\s*`;

// "K100/5", "K 100/5", "koker 100/5", "SHS 100/5"
const SCHUINE_STREEP = new RegExp(String.raw`^(?:K|koker|SHS)\s*-?\s*${GETAL}\s*\/\s*${GETAL}$`, 'i');
// "Koker 100x100x5", "koker 100x50x5", "SHS 100x100x5", "RHS 100x50x5",
// "K100x100x5", "buis 100x100x5"
const DRIE_MATEN = new RegExp(String.raw`^(?:K|koker|buis|SHS|RHS)\s*-?\s*${GETAL}${KRUIS}${GETAL}${KRUIS}${GETAL}$`, 'i');

function _getal(tekst) {
  return leesGetal(String(tekst));
}

/** Getal zoals de catalogus het schrijft: 5 → "5", 12.5 → "12.5". */
function _schrijf(n) {
  return String(Number(n));
}

/**
 * Naam van een kokerprofiel.
 * @param {number} b  Breedte (mm).
 * @param {number} h  Hoogte (mm).
 * @param {number} t  Wanddikte (mm).
 * @returns {string}  "K100/5" voor vierkant, "Koker 100x50x5" voor rechthoekig.
 */
export function kokerNaam(b, h, t) {
  if (Number(b) === Number(h)) return `K${_schrijf(b)}/${_schrijf(t)}`;
  return `Koker ${_schrijf(b)}x${_schrijf(h)}x${_schrijf(t)}`;
}

/**
 * Ontleed een kokeraanduiding in oude of nieuwe schrijfwijze.
 * @param {string} tekst
 * @returns {{b:number, h:number, t:number}|null}  null als het geen koker is.
 */
export function ontleedKokerNaam(tekst) {
  const ruw = String(tekst ?? '').trim();
  if (!ruw) return null;
  let b, h, t;
  const kort = ruw.match(SCHUINE_STREEP);
  if (kort) {
    b = h = _getal(kort[1]);
    t = _getal(kort[2]);
  } else {
    const lang = ruw.match(DRIE_MATEN);
    if (!lang) return null;
    b = _getal(lang[1]);
    h = _getal(lang[2]);
    t = _getal(lang[3]);
  }
  if (!(b > 0) || !(h > 0) || !(t > 0)) return null;
  return { b, h, t };
}

/**
 * Naam in de huidige schrijfwijze, of null als de tekst geen koker is.
 * "Koker 100x100x5" → "K100/5"; "RHS 100x50x5" → "Koker 100x50x5".
 */
export function normaliseerKokerNaam(tekst) {
  const m = ontleedKokerNaam(tekst);
  return m ? kokerNaam(m.b, m.h, m.t) : null;
}

/** Oude schrijfwijze van een kokernaam, voor zoeken: "K100/5" → "Koker 100x100x5". */
export function oudeKokerNaam(tekst) {
  const m = ontleedKokerNaam(tekst);
  return m ? `Koker ${_schrijf(m.b)}x${_schrijf(m.h)}x${_schrijf(m.t)}` : null;
}

/**
 * Parameters van een geplaatst symbool bijwerken naar de huidige
 * schrijfwijze. Alleen het kokersymbool met een herkenbare oude `maat`
 * verandert; al het andere komt ongewijzigd (zelfde object) terug.
 * @param {string} symbolId
 * @param {object} params
 * @returns {object}
 */
export function migreerProfielParams(symbolId, params) {
  if (symbolId !== KOKER_SYMBOOL_ID || !params || typeof params !== 'object') return params;
  if (typeof params.maat !== 'string') return params;
  const nieuw = normaliseerKokerNaam(params.maat);
  if (!nieuw || nieuw === params.maat) return params;
  return { ...params, maat: nieuw };
}
