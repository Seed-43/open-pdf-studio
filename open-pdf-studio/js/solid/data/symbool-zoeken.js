// Zoeken in het symbolenpalet — PURE module (geen Solid- of app-imports), los
// testbaar onder node --test.
//
// Een symbool past bij de zoekterm als zijn naam of id hem bevat, of — voor
// een parametrisch symbool — een van zijn extra zoektermen (de maten uit de
// keuzelijst, plus wat het template opgeeft, zoals de oude schrijfwijze
// "Koker 100x100x5" naast "K100/5"). Zo vinden "koker 100" en "K100" allebei
// het kokerprofiel.

function _plat(tekst) {
  return String(tekst ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {{name?:string, id?:string, parametricId?:string}} symbool
 * @param {string} zoekterm
 * @param {(templateId:string) => string[]} [termenVoor]  Extra zoektermen per
 *        parametrisch template (registry.searchTermsFor).
 * @returns {boolean}
 */
export function symboolPastBijZoekterm(symbool, zoekterm, termenVoor) {
  const q = _plat(zoekterm);
  if (!q) return true;
  if (_plat(symbool?.name).includes(q) || _plat(symbool?.id).includes(q)) return true;
  if (!symbool?.parametricId || typeof termenVoor !== 'function') return false;
  return (termenVoor(symbool.parametricId) || []).some(t => _plat(t).includes(q));
}
