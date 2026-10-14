/**
 * Toetsenbordbediening van de lint-tabstrook en de verdeling van
 * extensietabbladen over strook en overloopmenu (#551). Zuivere functies;
 * Ribbon.jsx en ExtensionRibbonTab.jsx (ExtensionTabStrip) doen het
 * DOM-werk eromheen.
 */

/** Ruimte die de »-knop van het overloopmenu inneemt, in px (22 + marge + tussenruimte). */
export const MEER_KNOP_BREEDTE = 26;

/**
 * Het tabblad waar een toets naartoe gaat, of null als de toets niets doet.
 * Pijl links en rechts lopen rond; bij rechts-naar-links (`rtl`) zijn ze
 * gespiegeld. Home en End gaan naar het eerste en laatste tabblad.
 * @param {string[]} tabs     tab-id's in weergavevolgorde
 * @param {string} huidig
 * @param {string} toets      KeyboardEvent.key
 * @param {boolean} rtl
 */
export function volgendeTab(tabs, huidig, toets, rtl) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  const i = tabs.indexOf(huidig);
  let stap = 0;
  if (toets === 'ArrowRight') stap = rtl ? -1 : 1;
  else if (toets === 'ArrowLeft') stap = rtl ? 1 : -1;
  else if (toets === 'Home') return tabs[0];
  else if (toets === 'End') return tabs[tabs.length - 1];
  else return null;
  if (i < 0) return stap > 0 ? tabs[0] : tabs[tabs.length - 1];
  return tabs[(i + stap + tabs.length) % tabs.length];
}

/**
 * Verdeel de extensietabbladen over de strook en het overloopmenu.
 * Past alles, dan is alles zichtbaar. Anders gaan de achterste naar het menu
 * en blijft er ruimte voor de »-knop; het actieve tabblad blijft altijd
 * zichtbaar.
 * @param {number[]} breedtes   natuurlijke breedte per tabblad, in volgorde
 * @param {number} beschikbaar  beschikbare breedte in px
 * @param {number} actief       index van het actieve tabblad, of -1
 * @returns {{ zichtbaar: number[], verborgen: number[] }}
 */
export function verdeelTabbladen(breedtes, beschikbaar, actief) {
  const totaal = breedtes.reduce((s, b) => s + b, 0);
  const alle = breedtes.map((_, i) => i);
  if (totaal <= beschikbaar) return { zichtbaar: alle, verborgen: [] };
  let budget = beschikbaar - MEER_KNOP_BREEDTE;
  const zichtbaar = new Set();
  if (actief >= 0 && actief < breedtes.length) {
    zichtbaar.add(actief);
    budget -= breedtes[actief];
  }
  for (const i of alle) {
    if (zichtbaar.has(i)) continue;
    if (breedtes[i] > budget) break;
    zichtbaar.add(i);
    budget -= breedtes[i];
  }
  return {
    zichtbaar: alle.filter((i) => zichtbaar.has(i)),
    verborgen: alle.filter((i) => !zichtbaar.has(i)),
  };
}
