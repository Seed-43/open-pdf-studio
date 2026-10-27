// Callout plaatsen in twee klikken (#613): klik 1 is de punt van de
// aanhaallijn, klik 2 is waar het tekstvak komt. Tussen de klikken toont de
// tool een voorbeeld (shape-tool.js). Een sleep plaatst de callout zoals
// vanouds in één gebaar: van de punt (indrukken) naar het tekstvak (loslaten).
// Puur: geen DOM, geen app-state.

export function maakCalloutPlaatsing() {
  /** @type {null | {x:number, y:number, pagina:number}} */
  let punt = null;

  return {
    /** Er staat een punt, klik 2 volgt nog. */
    get actief() { return punt !== null; },
    get punt() { return punt; },

    /**
     * De muis gaat los.
     * @param {{start:{x,y}, eind:{x,y}, klik:boolean, pagina:number}} o
     *   start/eind: indruk- en loslaatpunt van dit gebaar (paginaruimte),
     *   klik: niet gesleept, pagina: de pagina van dit gebaar.
     * @returns {{soort:'punt'} | {soort:'niets'} | {soort:'plaats', punt:{x,y}, notitie:{x,y}}}
     */
    loslaten({ start, eind, klik, pagina }) {
      if (punt && punt.pagina === pagina) {
        const r = { soort: 'plaats', punt: { x: punt.x, y: punt.y }, notitie: { x: eind.x, y: eind.y } };
        punt = null;
        return r;
      }
      if (!klik && !punt) {
        return { soort: 'plaats', punt: { x: start.x, y: start.y }, notitie: { x: eind.x, y: eind.y } };
      }
      // Klik 1, of klik 2 op een andere pagina: daar begint een nieuwe callout.
      if (!Number.isFinite(start.x) || !Number.isFinite(start.y)) {
        punt = null;
        return { soort: 'niets' };
      }
      punt = { x: start.x, y: start.y, pagina };
      return { soort: 'punt' };
    },

    stop() { punt = null; },
  };
}
