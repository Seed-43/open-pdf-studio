// Papiermaat in een eenheid naar keuze (#598).
//
// Het model rekent in paginapunten (1 pt = 1/72 in). Het eigenschappenpaneel
// toont en leest papiermaten (breedte/hoogte van een afbeelding, hoogte van
// een schaalbalk) in de eenheid die de gebruiker kiest: mm, cm, in of pt. Dit
// bestand doet alleen de omrekening, de weergave-afronding en de
// verhoudingsrekening; het paneel en de voorkeur zitten elders
// (papierEenheidStore.js, ImageSection.jsx).
//
// Een eenheidswissel is puur weergave: het model verandert er nooit door.
//
// Alleen een import van minimummaat.js (zelf zonder imports), zodat dit in
// Node getest wordt (papiermaat-eenheid.test.mjs).

import { klemMaat, veiligeVerhouding } from './minimummaat.js';
import { leesGetalBegin } from '../core/getal-invoer.js';

/** Keuzes in het paneel en de voorkeuren, in deze volgorde. */
export const PAPIER_EENHEDEN = ['mm', 'cm', 'in', 'pt'];

/** Standaard: paginapunten, zoals het paneel altijd al rekende. */
export const STANDAARD_PAPIER_EENHEID = 'pt';

const _PT_PER = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 };

// Basisprecisie per eenheid: ruim onder wat op papier zichtbaar is
// (0,01 mm, 0,001 cm, 0,001 in, 0,01 pt).
const _DECIMALEN = { pt: 2, mm: 2, cm: 3, in: 3 };

/** Bovengrens van het aantal decimalen (geen exponentnotatie, geen ruis). */
const _MAX_DECIMALEN = 8;

/** Een geldige eenheid uit PAPIER_EENHEDEN; al het andere wordt de standaard. */
export function normaliseerPapierEenheid(eenheid) {
  if (typeof eenheid !== 'string') return STANDAARD_PAPIER_EENHEID;
  const e = eenheid.trim().toLowerCase();
  return PAPIER_EENHEDEN.includes(e) ? e : STANDAARD_PAPIER_EENHEID;
}

/** Aantal paginapunten in één eenheid. */
export function ptPerEenheid(eenheid) {
  return _PT_PER[normaliseerPapierEenheid(eenheid)];
}

/** Paginapunten naar de eenheid. Geen eindig getal geeft NaN. */
export function ptNaarEenheid(pt, eenheid) {
  if (typeof pt !== 'number' || !Number.isFinite(pt)) return NaN;
  return pt / ptPerEenheid(eenheid);
}

/** Waarde in de eenheid naar paginapunten. Geen eindig getal geeft NaN. */
export function eenheidNaarPt(waarde, eenheid) {
  if (typeof waarde !== 'number' || !Number.isFinite(waarde)) return NaN;
  return waarde * ptPerEenheid(eenheid);
}

/**
 * Decimalen voor de weergave van `waarde` (al in de eenheid): de
 * basisprecisie van de eenheid, maar minstens drie significante cijfers, zodat
 * een kleine maat in een grote eenheid (0,4 pt in inch) niet als 0 verschijnt.
 */
export function decimalenVoor(waarde, eenheid) {
  const basis = _DECIMALEN[normaliseerPapierEenheid(eenheid)];
  if (typeof waarde !== 'number' || !Number.isFinite(waarde) || waarde === 0) return basis;
  const nodig = Math.ceil(-Math.log10(Math.abs(waarde))) + 2;
  return Math.min(_MAX_DECIMALEN, Math.max(basis, nodig));
}

/**
 * Maat (paginapunten) als getal voor een invoerveld in de eenheid, afgerond
 * volgens decimalenVoor. Geen getal geeft 0 (zoals toonMaat).
 */
export function toonInEenheid(pt, eenheid) {
  const v = ptNaarEenheid(pt, eenheid);
  if (!Number.isFinite(v)) return 0;
  return Number(v.toFixed(decimalenVoor(v, eenheid)));
}

/**
 * Lees een getypte maat in de eenheid en geef paginapunten. Decimalen met
 * punt of komma. Null voor alles wat geen positieve maat is - ook de
 * tussenstanden tijdens het typen ("", "0", "0.") - zodat de aanroeper het
 * model dan met rust laat. Na omrekenen geklemd op de technische ondergrens,
 * of op eigen grenzen in paginapunten ({ min, max }).
 */
export function leesInvoerInEenheid(invoer, eenheid, grenzen = {}) {
  let n;
  if (typeof invoer === 'number') n = invoer;
  else if (typeof invoer === 'string') n = leesGetalBegin(invoer);
  else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  let pt = klemMaat(eenheidNaarPt(n, eenheid), grenzen.min);
  if (typeof grenzen.max === 'number' && Number.isFinite(grenzen.max) && pt > grenzen.max) pt = grenzen.max;
  return pt;
}

/**
 * Nieuwe breedte en hoogte (paginapunten) van een afbeelding na het typen van
 * één as in het paneel. Met vaste verhouding volgt de andere as de
 * verhouding van de ORIGINELE maat (zoals het slepen en "terug naar
 * origineel"); is die onbruikbaar, dan schaalt alleen de getypte as. De
 * annotatie wordt niet gemuteerd. Null bij een tussenstand of onbekende as.
 *
 * @param {'width'|'height'} as
 * @param {string|number} invoer  getypt, in `eenheid`
 * @param {string} eenheid
 * @param {{width:number,height:number,originalWidth?:number,originalHeight?:number,lockAspectRatio?:boolean}} ann
 * @returns {{width:number,height:number}|null}
 */
export function nieuweAfbeeldingsMaat(as, invoer, eenheid, ann) {
  if (!ann || (as !== 'width' && as !== 'height')) return null;
  const pt = leesInvoerInEenheid(invoer, eenheid);
  if (pt == null) return null;
  const verhouding = ann.lockAspectRatio
    ? veiligeVerhouding(ann.originalWidth, ann.originalHeight) : 0;
  if (as === 'width') {
    return { width: pt, height: verhouding ? klemMaat(pt / verhouding) : ann.height };
  }
  return { width: verhouding ? klemMaat(pt * verhouding) : ann.width, height: pt };
}
