// Het kader van een afbeelding tijdens slepen en schalen (app-ruimte, y omlaag).
// Geen DOM: testbaar onder Node.

/** De acht handvatten: naam en plek als deel van breedte (fx) en hoogte (fy). */
export const HANDVATTEN = Object.freeze([
  { naam: 'tl', fx: 0, fy: 0 }, { naam: 't', fx: 0.5, fy: 0 }, { naam: 'tr', fx: 1, fy: 0 },
  { naam: 'r', fx: 1, fy: 0.5 }, { naam: 'br', fx: 1, fy: 1 }, { naam: 'b', fx: 0.5, fy: 1 },
  { naam: 'bl', fx: 0, fy: 1 }, { naam: 'l', fx: 0, fy: 0.5 },
]);

const LINKS = new Set(['tl', 'l', 'bl']);
const RECHTS = new Set(['tr', 'r', 'br']);
const BOVEN = new Set(['tl', 't', 'tr']);
const ONDER = new Set(['bl', 'b', 'br']);
const HOEKEN = new Set(['tl', 'tr', 'br', 'bl']);

/**
 * Het nieuwe kader na een sleep van (dx, dy).
 * @param {{x:number,y:number,width:number,height:number}} orig
 * @param {'move'|'tl'|'t'|'tr'|'r'|'br'|'b'|'bl'|'l'} modus
 * @param {{vrij?:boolean, min?:number}} opties  vrij: hoeken vervormen toestaan; min: kleinste breedte/hoogte
 */
export function sleepKader(orig, modus, dx, dy, { vrij = false, min = 4 } = {}) {
  if (modus === 'move') {
    return { x: orig.x + dx, y: orig.y + dy, width: orig.width, height: orig.height };
  }
  let links = orig.x;
  let rechts = orig.x + orig.width;
  let boven = orig.y;
  let onder = orig.y + orig.height;
  if (LINKS.has(modus)) links += dx;
  if (RECHTS.has(modus)) rechts += dx;
  if (BOVEN.has(modus)) boven += dy;
  if (ONDER.has(modus)) onder += dy;

  // Nooit omklappen of kleiner dan het minimum: de bewegende rand stopt.
  if (LINKS.has(modus)) links = Math.min(links, rechts - min);
  if (RECHTS.has(modus)) rechts = Math.max(rechts, links + min);
  if (BOVEN.has(modus)) boven = Math.min(boven, onder - min);
  if (ONDER.has(modus)) onder = Math.max(onder, boven + min);

  let breedte = rechts - links;
  let hoogte = onder - boven;

  if (HOEKEN.has(modus) && !vrij) {
    // Verhouding behouden: de grootste relatieve verandering wint, de
    // tegenoverliggende hoek blijft staan.
    const verhouding = orig.width / orig.height;
    const f = Math.max(breedte / orig.width, hoogte / orig.height);
    breedte = Math.max(min, orig.width * f);
    hoogte = breedte / verhouding;
    if (hoogte < min) { hoogte = min; breedte = hoogte * verhouding; }
    if (LINKS.has(modus)) links = (orig.x + orig.width) - breedte;
    else rechts = orig.x + breedte;
    if (BOVEN.has(modus)) boven = (orig.y + orig.height) - hoogte;
    else onder = orig.y + hoogte;
  }
  return { x: links, y: boven, width: rechts - links, height: onder - boven };
}
