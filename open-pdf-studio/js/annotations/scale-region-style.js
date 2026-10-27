// Uiterlijk van een schaalgebied (#611): welke kleur en doorzichtigheid de
// rand en de vulling krijgen. Eén bron voor het scherm (rendering.js), de
// appearance in het bestand (saver/scale-region-ap.js) en het
// eigenschappenpaneel, zodat ze niet uit elkaar lopen.
//
// - Rand en label: `color` (standaard oranje) op `opacity` (PDF /CA).
// - Vulling: `fillColor`, of anders de randkleur, op `fillOpacity` (PDF /ca).
//   Zonder eigen `fillOpacity` blijft het oude uiterlijk: een tint van 10 %
//   van `opacity`. Zo zien bestaande documenten er precies hetzelfde uit
//   zolang de gebruiker de vulling niet zelf instelt.

export const SCHAALGEBIED_KLEUR = '#ff9800';
/** Vul-alfa als deel van de doorzichtigheid wanneer er geen eigen is. */
export const SCHAALGEBIED_VULFACTOR = 0.1;

function alfa(waarde, standaard) {
  if (waarde === undefined || waarde === null || waarde === '') return standaard;
  const n = Number(waarde);
  if (!Number.isFinite(n)) return standaard;
  return Math.max(0, Math.min(1, n));
}

function isKleur(c) {
  return typeof c === 'string' && c !== '' && c !== 'none' && c !== 'transparent';
}

/**
 * @param {object} ann schaalgebied-annotatie
 * @returns {{randKleur:string, vulKleur:string, randAlfa:number, vulAlfa:number}}
 */
export function schaalgebiedStijl(ann) {
  const randKleur = isKleur(ann?.color) ? ann.color : SCHAALGEBIED_KLEUR;
  const vulKleur = isKleur(ann?.fillColor) ? ann.fillColor : randKleur;
  const randAlfa = alfa(ann?.opacity, 1);
  const eigen = ann?.fillOpacity;
  const vulAlfa = (eigen === undefined || eigen === null)
    ? SCHAALGEBIED_VULFACTOR * randAlfa
    : alfa(eigen, SCHAALGEBIED_VULFACTOR * randAlfa);
  return { randKleur, vulKleur, randAlfa, vulAlfa };
}
