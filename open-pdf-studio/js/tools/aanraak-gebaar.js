// Vingerinvoer op de pagina (#671).
//
// Een vingerveeg is voor de browser standaard een scrollgebaar: na een paar
// millimeter neemt hij hem over en stuurt hij pointercancel, waarna er geen
// pointermove of pointerup meer komt. Met selecteren en de hand is dat precies
// goed (met de vinger door het document scrollen); met elk ander gereedschap
// hoort de veeg bij het gereedschap, en brak een streek daardoor halverwege af.
// cursor.js zet daarom per gereedschap touch-action op het tekenvlak (zie
// layout.css), en de dispatcher rondt een afgebroken gebaar netjes af.

const BLADEREN = new Set(['select', 'hand', 'selectComments']);

/** 'auto' als een vingerveeg mag scrollen, 'none' als hij bij het gereedschap hoort. */
export function aanraakActie(tool) {
  return BLADEREN.has(tool) ? 'auto' : 'none';
}

/**
 * Het event waarmee een afgebroken gebaar (pointercancel) wordt afgerond.
 * pointercancel draagt zelf geen betrouwbare positie; de laatste beweging van
 * dezelfde aanwijzer wel.
 */
export function eindEventBijAfbreken(afgebroken, laatsteBeweging) {
  return laatsteBeweging && laatsteBeweging.pointerId === afgebroken.pointerId ? laatsteBeweging : afgebroken;
}
