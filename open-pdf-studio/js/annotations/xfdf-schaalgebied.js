// Vulling en doorzichtigheid van een schaalgebied in XFDF (#611). De
// standaard-attributen opacity en interior-color, plus het eigen attribuut
// opsfillopacity voor de vul-doorzichtigheid (zoals opstype, opsunits, …).
// Zonder die attributen blijft het oude uiterlijk (zie scale-region-style.js).

import { hasFill } from './fill-utils.js';
import { colorToXFDF, vulkleurUitAttribuut } from './xfdf-kleur.js';

function getal01(raw) {
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/** Extra attributen achter de gedeelde; '' voor een standaard-schaalgebied. */
export function schaalgebiedXfdfAttributen(ann) {
  let uit = '';
  const op = ann?.opacity;
  if (op !== undefined && op !== null && op !== 1) uit += ` opacity="${op}"`;
  if (hasFill(ann?.fillColor)) uit += ` interior-color="${colorToXFDF(ann.fillColor)}"`;
  const fo = ann?.fillOpacity;
  if (fo !== undefined && fo !== null) uit += ` opsfillopacity="${fo}"`;
  return uit;
}

/**
 * @param {(naam:string) => (string|null)} attr leest een attribuut van het element
 * @returns {{opacity:number, fillColor:(string|undefined), fillOpacity:(number|undefined)}}
 */
export function schaalgebiedUitXfdf(attr) {
  return {
    opacity: getal01(attr('opacity')) ?? 1,
    fillColor: vulkleurUitAttribuut(attr('interior-color')) || undefined,
    fillOpacity: getal01(attr('opsfillopacity')),
  };
}
