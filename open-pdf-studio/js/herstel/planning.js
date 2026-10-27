// Wanneer maakt de app een herstelmomentopname van een document?
//
// Pure regels, zonder DOM of Tauri (getest in planning.test.mjs). De
// bewaking (herstel.js) kijkt elke TIK_MS naar de open documenten en houdt per
// document een plan bij:
//
// * een document zonder niet-opgeslagen wijzigingen krijgt geen opname;
// * na een wijziging volgt een opname zodra het STILTE_MS stil is gebleven
//   (ongeveer 30 s na de laatste wijziging);
// * blijft de gebruiker doorwerken, dan toch uiterlijk MAX_WACHT_MS na de
//   eerste wijziging die nog niet vastligt (hooguit elke 2 minuten);
// * duurde een opname lang (een groot document), dan wacht de volgende
//   minstens tien keer zo lang, zodat de app niet voortdurend bezig is.
//
// Een wijziging herkent de bewaking aan de vingerafdruk van het document:
// inhoudsrevisie (elke stap in de undo-geschiedenis), lengtes van de lijsten
// die opslaan meeneemt, het werkpad (paginabewerkingen) en een teller voor
// wijzigingen buiten de undo-geschiedenis (formuliervelden, haken.js).

export const TIK_MS = 5_000;
export const STILTE_MS = 30_000;
export const MAX_WACHT_MS = 120_000;
/** Bovengrens van de extra wachttijd na een trage opname. */
export const MAX_TUSSENPOOS_MS = 10 * 60_000;

/** Vingerafdruk van wat opslaan zou schrijven; goedkoop, geen inhoud. */
export function vingerafdruk(doc, extraTeller = 0) {
  if (!doc) return '';
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return [
    Number.isInteger(doc.inhoudRevisie) ? doc.inhoudRevisie : 0,
    n(doc.undoStack),
    n(doc.redoStack),
    n(doc.annotations),
    n(doc.textEdits),
    n(doc.watermarks),
    n(doc.bookmarks),
    doc.pdfDoc?.numPages ?? 0,
    doc.filePath || '',
    extraTeller || 0,
  ].join('|');
}

export function nieuwPlan() {
  return {
    /** Vingerafdruk van de laatste opname (null: nog geen). */
    vastgelegd: null,
    /** Laatst geziene vingerafdruk. */
    gezien: null,
    /** Eerste wijziging die nog niet in een opname staat (ms). */
    eersteWijziging: null,
    /** Laatste geziene wijziging (ms). */
    laatsteWijziging: null,
    /** Einde van de laatste opname (ms). */
    laatsteOpname: null,
    /** Extra wachttijd na een trage opname (ms). */
    tussenpoos: 0,
  };
}

/**
 * Verwerk wat de bewaking nu ziet.
 * @param {object} plan
 * @param {{fp:string, gewijzigd:boolean}} waarneming
 * @param {number} nu
 */
export function werkBij(plan, { fp, gewijzigd }, nu) {
  const p = { ...plan };
  if (!gewijzigd) {
    // Opgeslagen of terug naar de opgeslagen stand: niets te bewaren.
    p.gezien = fp;
    p.eersteWijziging = null;
    p.laatsteWijziging = null;
    return p;
  }
  if (fp !== p.gezien) {
    p.gezien = fp;
    p.laatsteWijziging = nu;
    if (p.eersteWijziging == null) p.eersteWijziging = nu;
  } else if (p.eersteWijziging == null && p.vastgelegd !== fp) {
    // Gewijzigd, maar nog nooit vastgelegd (bv. was al gewijzigd bij het
    // eerste zien): telt als wijziging van nu.
    p.eersteWijziging = nu;
    p.laatsteWijziging = nu;
  }
  return p;
}

/** Is een opname nu aan de beurt? */
export function isAanDeBeurt(plan, nu, { stilte = STILTE_MS, maxWacht = MAX_WACHT_MS } = {}) {
  if (plan.eersteWijziging == null || plan.laatsteWijziging == null) return false;
  if (plan.gezien === plan.vastgelegd) return false;
  if (plan.laatsteOpname != null && nu - plan.laatsteOpname < (plan.tussenpoos || 0)) return false;
  return nu - plan.laatsteWijziging >= stilte || nu - plan.eersteWijziging >= maxWacht;
}

/** Extra wachttijd na een opname van `duurMs`: pas boven 5 s, tien keer zo lang. */
export function tussenpoosNaDuur(duurMs) {
  if (!(duurMs > 5_000)) return 0;
  return Math.min(MAX_TUSSENPOOS_MS, Math.round(duurMs * 10));
}

/**
 * Na een geslaagde opname van vingerafdruk `fp` (gemeten bij de START van de
 * opname). Wat daarna nog veranderde, wacht op de volgende opname.
 */
export function naOpname(plan, fp, nu, duurMs = 0) {
  const p = { ...plan, vastgelegd: fp, laatsteOpname: nu, tussenpoos: tussenpoosNaDuur(duurMs) };
  if (p.gezien === fp) {
    p.eersteWijziging = null;
    p.laatsteWijziging = null;
  } else {
    p.eersteWijziging = nu;
  }
  return p;
}

/** Na het openen van een herstelde kopie: die staat al vast. */
export function vastgelegdPlan(fp, nu) {
  return { ...nieuwPlan(), vastgelegd: fp, gezien: fp, laatsteOpname: nu };
}
