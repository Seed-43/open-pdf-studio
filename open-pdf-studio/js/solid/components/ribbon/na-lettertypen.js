// Opnieuw meten zodra de lettertypen geladen zijn, zonder de opstart op te
// houden (#707).
//
// Het lint meet zijn breedtes opnieuw als een weblettertype later binnenkomt
// (document.fonts.ready). Alleen al het LEZEN van document.fonts.ready laat de
// browser stijl en layout van de hele pagina meteen uitrekenen. In onMount
// viel dat midden in de opstarttaak: in de gehoste bouw zo'n 190 ms extra in
// één lange taak. Daarom pas in het eerstvolgende frame, waar die layout toch
// al gebeurt.
//
// Venster van buiten, zodat dit zonder DOM te testen is (na-lettertypen.test.mjs).

/**
 * Roep `meet` aan zodra de lettertypen klaar zijn, gevraagd in het volgende
 * frame.
 * @param {() => void} meet
 * @param {Window|object} [venster]
 * @returns {() => void} annuleren (bij onCleanup): daarna wordt er niet meer gemeten
 */
export function naLettertypen(meet, venster = globalThis.window) {
  if (!venster || typeof venster.requestAnimationFrame !== 'function') return () => {};
  let weg = false;
  const raf = venster.requestAnimationFrame(() => {
    const klaar = venster.document?.fonts?.ready;
    if (weg || !klaar || typeof klaar.then !== 'function') return;
    klaar.then(() => { if (!weg) meet(); });
  });
  return () => {
    weg = true;
    venster.cancelAnimationFrame?.(raf);
  };
}
