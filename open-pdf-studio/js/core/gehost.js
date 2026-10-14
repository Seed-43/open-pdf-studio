// Draait de app als gast in een andere site (#544)?
//
// In de OpenAEC-site staat de bundel als statische bestanden onder een subpad
// en delen alle gereedschappen één oorsprong. Dat verandert een paar dingen:
// sleutels zonder voorvoegsel in de browseropslag zijn dan niet van ons
// (core/opslag.js), en diensten op andere hosts staan uit (core/webfuncties.js).
//
// Twee signalen, elk is genoeg:
//  - de bouw: `npm run build:hosted` (vite build --mode hosted). Die bundel
//    weet het vanaf de eerste regel, nog vóór de gastpagina iets doet.
//  - de gastpagina: die zet vóór het laden `window.__OPDS_HOST__` neer (het
//    opslagcontract, zie core/platform.js).
//
// Vrij van imports, zodat elke module hem kan gebruiken zonder kringen.

const env = import.meta.env || {};

/** De Vite-modus van de gastbouw. */
export const GAST_MODUS = 'hosted';

/** Het object dat de gastpagina neerzet, of null. */
export function gastObject() {
  if (typeof window === 'undefined') return null;
  return window.__OPDS_HOST__ || null;
}

export function isGehost() {
  return env.MODE === GAST_MODUS || gastObject() !== null;
}
