// Zijdematen van een meetvlak (GitHub #536): de lengte van elke rechte zijde
// van de buitenring, midden op die zijde, langs de zijde en rechtop leesbaar,
// aan de buitenkant van het vlak.
//
// Puur, zonder canvas of app-state: het scherm (rendering/measurements.js) en
// de opgeslagen appearance (saver/appearance-vectors.js) plaatsen de maten met
// dezelfde regels. De tekst zelf (schaal, eenheid, afronding) komt uit
// measurement.js (vlakZijdeTeksten), zodat hij precies de schaal van de
// oppervlaktetekst volgt.
//
// Alleen de buitenring (`points`) krijgt maten; gaten en extra delen niet.
// Boogsegmenten (een punt met `arc`) zijn geen rechte zijde en krijgen geen
// maat, net als een zijde zonder lengte.

import { leesbareHoek } from './maat-label.js';
import { HOOFDLETTER_HOOGTE } from './maatlijn-inline.js';

/** Tekstgrootte van een zijdemaat, gelijk aan het oppervlaktelabel (pt). */
export const ZIJDE_TEKST_GROOTTE = 11;

// Onderlengte en gemiddelde cijferbreedte van Helvetica/Arial, als fractie van
// de tekstgrootte (zelfde schatting als maatLabelOps in de saver).
const ONDERLENGTE = 0.21;
const TEKEN_BREEDTE = 0.55;
const MIN_LENGTE = 1e-6;

/** Millimeters per lengte-eenheid; pixels hebben geen vaste maat. */
const MM_PER_EENHEID = Object.freeze({
  mm: 1,
  cm: 10,
  dm: 100,
  m: 1000,
  km: 1e6,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
  pt: 25.4 / 72,
});

/**
 * De lengte-eenheid bij een (oppervlakte-)eenheid: 'mm²' → 'mm',
 * 'sq ft' → 'ft', 'cm' → 'cm'. Leeg of onbekend → null.
 */
export function lengteEenheid(eenheid) {
  if (typeof eenheid !== 'string') return null;
  const kaal = eenheid.trim().replace(/²$/, '').replace(/^sq\.?\s+/i, '').trim();
  return kaal || null;
}

/** Factor van `van` naar `naar` (1 van = factor naar), of null als dat niet kan. */
export function eenheidFactor(van, naar) {
  const a = MM_PER_EENHEID[van];
  const b = MM_PER_EENHEID[naar];
  if (!a || !b) return null;
  return a / b;
}

/**
 * Een schaal in eenheden per punt, omgerekend naar een andere eenheid zodat
 * de echte maat gelijk blijft. Zonder vaste verhouding (pixels, onbekend)
 * blijft het getal staan.
 */
export function schaalInEenheid(schaal, van, naar) {
  const f = eenheidFactor(van, naar);
  return f == null ? schaal : schaal * f;
}

/**
 * De eigen schaal van een meetvlak uit een /Measure-woordenboek (de lader).
 * `schaal` en `xEenheid` komen uit /X: de factoren van de hele reeks
 * vermenigvuldigd, dus in de eenheid van het LAATSTE element (bij voet + inch
 * is dat de inch). `aEenheid` is de eenheid van /A ('m²', 'sq ft').
 *
 * Het meetvlak rekent measureScale in de lengte-eenheid van measureUnit
 * (lengteEenheid), dus die twee moeten bij elkaar passen. Kan de schaal naar
 * de lengte-eenheid van /A, dan wordt hij omgerekend en blijft de eenheid van
 * /A staan; anders volgt de eenheid de schaal (het kwadraat van /X). Zonder
 * eenheid in /X blijft de eenheid van /A, zoals voorheen.
 */
export function vlakSchaalUitMeasure(schaal, xEenheid, aEenheid) {
  const x = lengteEenheid(xEenheid);
  const a = typeof aEenheid === 'string' && aEenheid.trim() ? aEenheid : null;
  if (!x) return { measureScale: schaal, measureUnit: a || 'mm²' };
  const doel = lengteEenheid(a);
  if (doel === x) return { measureScale: schaal, measureUnit: a };
  if (doel && eenheidFactor(x, doel) != null) {
    return { measureScale: schaalInEenheid(schaal, x, doel), measureUnit: a };
  }
  return { measureScale: schaal, measureUnit: `${x}²` };
}

// Getekende oppervlakte (schoenveter) van de hoekpunten; het teken geeft de
// draairichting. Voor de buitennormaal is alleen dat teken nodig.
function getekendOppervlak(punten) {
  let som = 0;
  for (let i = 0; i < punten.length; i++) {
    const a = punten[i];
    const b = punten[(i + 1) % punten.length];
    som += a.x * b.y - b.x * a.y;
  }
  return som / 2;
}

/**
 * De rechte zijden van de buitenring, met de sluitende zijde (laatste punt
 * terug naar het eerste). Elke zijde: { index, x1, y1, x2, y2, lengte, buiten }
 * met `index` het nummer van haar beginpunt en `buiten` de eenheidsnormaal
 * naar de buitenkant van het vlak. Minder dan drie punten → [].
 */
export function vlakZijden(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  // Positief getekend oppervlak: binnen ligt links van elke zijde.
  const draai = getekendOppervlak(points) >= 0 ? 1 : -1;
  const zijden = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const j = (i + 1) % points.length;
    const b = points[j];
    // Een boog loopt NAAR het punt met `arc` (zie arc-points.js).
    if (b.arc === true) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengte = Math.hypot(dx, dy);
    if (!(lengte > MIN_LENGTE)) continue;
    zijden.push({
      index: i,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      lengte,
      buiten: { x: (draai * dy) / lengte, y: (-draai * dx) / lengte },
    });
  }
  return zijden;
}

/**
 * Plaats van de maat bij een zijde: het midden van de basislijn (x, y), de
 * hoek (radialen, y omlaag) waaronder de tekst staat, de leesrichting en
 * "boven" van de tekst. De tekst staat langs de zijde, nooit op zijn kop
 * (zoals een maatlijn, maat-label.js) en met `marge` ruimte tussen zijde en
 * tekst aan de buitenkant van het vlak.
 *
 * `draaiing` (radialen) is de paginarotatie wanneer de punten in het
 * ongedraaide paginaframe staan (de saver): de tekst leest dan rechtop op de
 * gedraaide pagina, net als op het scherm.
 */
export function zijdeLabel(zijde, { fontSize = ZIJDE_TEKST_GROOTTE, marge, draaiing = 0 } = {}) {
  const fs = fontSize > 0 ? fontSize : ZIJDE_TEKST_GROOTTE;
  const ruimte = marge ?? Math.max(3, fs * 0.35);
  const d = Number(draaiing) || 0;
  const lijnhoek = Math.atan2(zijde.y2 - zijde.y1, zijde.x2 - zijde.x1);
  const hoek = leesbareHoek(lijnhoek + d) - d;
  const richting = { x: Math.cos(hoek), y: Math.sin(hoek) };
  const boven = { x: Math.sin(hoek), y: -Math.cos(hoek) };
  const mx = (zijde.x1 + zijde.x2) / 2;
  const my = (zijde.y1 + zijde.y2) / 2;
  const buitenIsBoven = zijde.buiten.x * boven.x + zijde.buiten.y * boven.y >= 0;
  // Boven de zijde: de onderkant van de tekst (onderlengte) op `ruimte`.
  // Eronder: de bovenkant van de cijfers (hoofdletterhoogte) op `ruimte`.
  const afstand = buitenIsBoven ? ruimte + fs * ONDERLENGTE : -(ruimte + fs * HOOFDLETTER_HOOGTE);
  return {
    x: mx + boven.x * afstand,
    y: my + boven.y * afstand,
    hoek,
    richting,
    boven,
    fontSize: fs,
  };
}

/** Geschatte breedte van een zijdemaat (Helvetica/Arial, cijfers). */
export function zijdeTekstBreedte(tekst, fontSize = ZIJDE_TEKST_GROOTTE) {
  return String(tekst ?? '').length * fontSize * TEKEN_BREEDTE;
}

/**
 * De vier hoeken van het vak dat de tekst inneemt, in dezelfde ruimte als de
 * zijde: de opgeslagen /Rect moet ze omvatten, anders knipt een andere lezer
 * de maten weg.
 */
export function zijdeLabelKader(label, tekst) {
  const fs = label.fontSize || ZIJDE_TEKST_GROOTTE;
  const half = zijdeTekstBreedte(tekst, fs) / 2;
  const { x, y, richting: r, boven: b } = label;
  const op = fs;                   // boven de basislijn (ruim)
  const neer = fs * ONDERLENGTE;   // onder de basislijn
  return [
    { x: x - r.x * half + b.x * op, y: y - r.y * half + b.y * op },
    { x: x + r.x * half + b.x * op, y: y + r.y * half + b.y * op },
    { x: x + r.x * half - b.x * neer, y: y + r.y * half - b.y * neer },
    { x: x - r.x * half - b.x * neer, y: y - r.y * half - b.y * neer },
  ];
}
