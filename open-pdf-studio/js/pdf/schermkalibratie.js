// Schermkalibratie (issue #520): "Werkelijke grootte" (Ctrl+0, de knop 100%)
// op de echte papiermaat laten uitkomen.
//
// Zonder kalibratie bepaalt de voorkeur 'Schermresolutie voor 100% zoom'
// (zoomDpi, zoom-display.js) wat 100% is. Wie zijn scherm kalibreert (een
// betaalpas of liniaal tegen het scherm houden), slaat het werkelijke aantal
// CSS-pixels per inch op; Werkelijke grootte zoomt dan naar pxPerInch / 72 en
// die waarde gaat op dat scherm voor zoomDpi.
//
// De kalibratie geldt ALLEEN voor de weergave op het scherm. Paginamaten, de
// tekenschaal van de meetgereedschappen, export-DPI en afdrukschaal blijven
// precies zoals ze waren.
//
// Per scherm: CSS-pixels per inch hangen af van de schermschaal van het
// besturingssysteem (devicePixelRatio). De kalibratie wordt daarom per
// devicePixelRatio bewaard. Twee schermen met dezelfde schaal maar een andere
// pixeldichtheid delen dus één waarde — die beperking staat in de docs.
//
// Pure module zonder app-imports, zodat hij in node getest wordt.

import { leesGetalBegin } from '../core/getal-invoer.js';

/** PDF-punten per inch. */
export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
/** CSS-referentie: 96 CSS-pixels per inch bij schermschaal 100%. */
export const CSS_PX_PER_INCH = 96;

/** Grenzen waarbinnen een kalibratie zinnig is (de helft tot 3x de referentie). */
export const MIN_PX_PER_INCH = 48;
export const MAX_PX_PER_INCH = 288;

/** Referenties in het kalibratievenster: wat de gebruiker tegen het scherm houdt. */
export const REFERENTIES = [
  { id: 'card', mm: 85.6 },   // breedte van een betaalpas (ISO/IEC 7810 ID-1)
  { id: 'ruler50', mm: 50 },
  { id: 'ruler100', mm: 100 },
];

/** Sleutel voor een schermschaal: 1.25 -> "1.25", 1.5000001 -> "1.5". */
export function dprSleutel(dpr) {
  const n = Number(dpr);
  const geldig = Number.isFinite(n) && n > 0 ? n : 1;
  return String(Math.round(geldig * 100) / 100);
}

/**
 * Een bruikbare waarde in CSS-pixels per inch, of null.
 * @param {unknown} waarde
 * @returns {number|null}
 */
export function geldigePxPerInch(waarde) {
  const n = typeof waarde === 'string' ? leesGetalBegin(waarde) : Number(waarde);
  if (!Number.isFinite(n) || n < MIN_PX_PER_INCH || n > MAX_PX_PER_INCH) return null;
  return Math.round(n * 100) / 100;
}

/**
 * De opgeslagen kalibratie voor deze schermschaal, of null als dit scherm
 * niet gekalibreerd is.
 * @param {Record<string, number>|null|undefined} kalibraties
 * @param {number} dpr
 */
export function kalibratieVoor(kalibraties, dpr) {
  if (!kalibraties || typeof kalibraties !== 'object') return null;
  return geldigePxPerInch(kalibraties[dprSleutel(dpr)]);
}

/** Nieuwe kalibratielijst met de waarde voor deze schermschaal. */
export function zetKalibratie(kalibraties, dpr, pxPerInch) {
  const waarde = geldigePxPerInch(pxPerInch);
  if (waarde == null) throw new Error(`ongeldige kalibratie: ${pxPerInch}`);
  return { ...(kalibraties || {}), [dprSleutel(dpr)]: waarde };
}

/** Nieuwe kalibratielijst zonder de waarde voor deze schermschaal. */
export function wisKalibratie(kalibraties, dpr) {
  const uit = { ...(kalibraties || {}) };
  delete uit[dprSleutel(dpr)];
  return uit;
}

/**
 * Zoomfactor voor "Werkelijke grootte". Zonder (geldige) kalibratie 1,0:
 * het gedrag van voor de kalibratie.
 * @param {number|null|undefined} pxPerInch
 */
export function werkelijkeGrootteZoom(pxPerInch) {
  const k = geldigePxPerInch(pxPerInch);
  return k == null ? 1 : k / PT_PER_INCH;
}

/** Lengte in millimeters -> CSS-pixels bij deze kalibratie. */
export function mmNaarSchermPx(mm, pxPerInch) {
  return (Number(mm) / MM_PER_INCH) * Number(pxPerInch);
}

/**
 * CSS-pixels per inch uit een lengte op het scherm die de gebruiker met een
 * liniaal heeft gemeten: een lijn van `schermPx` CSS-pixels bleek `gemetenMm`
 * millimeter lang.
 * @returns {number|null}
 */
export function pxPerInchUitLengte(schermPx, gemetenMm) {
  const px = Number(schermPx);
  const mm = typeof gemetenMm === 'string' ? leesGetalBegin(gemetenMm) : Number(gemetenMm);
  if (!(px > 0) || !(mm > 0)) return null;
  return geldigePxPerInch((px * MM_PER_INCH) / mm);
}

/**
 * Zoom na het verslepen van het venster naar een scherm met een andere
 * schermschaal. Alleen als de weergave op Werkelijke grootte stond voor het
 * oude scherm en BEIDE schermen gekalibreerd zijn, krijgt het nieuwe scherm
 * zijn eigen werkelijke grootte; anders null (zoom ongemoeid laten).
 * @returns {number|null}
 */
export function zoomNaDprWissel(zoomNu, oudeDpr, nieuweDpr, kalibraties) {
  if (dprSleutel(oudeDpr) === dprSleutel(nieuweDpr)) return null;
  const oud = kalibratieVoor(kalibraties, oudeDpr);
  const nieuw = kalibratieVoor(kalibraties, nieuweDpr);
  if (oud == null || nieuw == null) return null;
  if (!(Math.abs(Number(zoomNu) - werkelijkeGrootteZoom(oud)) < 1e-3)) return null;
  const doel = werkelijkeGrootteZoom(nieuw);
  return Math.abs(doel - zoomNu) < 1e-6 ? null : doel;
}
