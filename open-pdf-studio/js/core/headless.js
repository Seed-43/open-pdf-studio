// Headless testinstantie (OPDS_HEADLESS=1, zie src-tauri/src/headless.rs).
//
// De Rust-kant zet `window.__OPDS_HEADLESS__ = true` via een init-script, parkeert
// het venster buiten beeld en vervangt de native dialogen. Hier staat wat de
// frontend zelf moet laten: vensters tonen of focussen (dat activeert het
// venster en haalt het naar voren), maximaliseren of volledig scherm (dat zet
// het venster op een monitor), en externe programma's openen.
//
// Elke functie neemt het globale object als optionele parameter, zodat de
// tests zonder echte WebView kunnen draaien.

/** Draait deze WebView in een headless testinstantie? */
export function isHeadless(g = globalThis) {
  return g?.__OPDS_HEADLESS__ === true;
}

/** Logregel voor een onderdrukte handeling (zelfde vorm als aan de Rust-kant). */
export function meldOnderdrukt(wat, g = globalThis) {
  try { g?.console?.warn?.(`[headless] ${wat} suppressed`); } catch (_) { /* geen console */ }
}

/**
 * Opties voor een nieuw Tauri-venster. Headless start het venster onzichtbaar,
 * zonder focus, niet-activeerbaar en zonder taakbalkknop; de Rust-kant parkeert
 * het daarna buiten beeld en toont het zonder te activeren. Buiten headless
 * komt hetzelfde object ongewijzigd terug.
 */
export function headlessVensterOpties(opties, g = globalThis) {
  if (!isHeadless(g)) return opties;
  return {
    ...opties,
    visible: false,
    focus: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    maximized: false,
    fullscreen: false,
    center: false,
  };
}

/**
 * Een venster tonen en naar voren halen. Headless gebeurt er niets (een
 * logregel): het venster staat dan al zichtbaar buiten beeld.
 */
export async function toonEnFocus(venster, g = globalThis) {
  if (!venster) return;
  if (isHeadless(g)) {
    meldOnderdrukt('window show/setFocus', g);
    return;
  }
  await venster.show();
  await venster.setFocus();
}

/**
 * Voor handelingen die headless niet mogen: geeft `true` (en logt) als de
 * handeling overgeslagen moet worden.
 */
export function slaOverInHeadless(wat, g = globalThis) {
  if (!isHeadless(g)) return false;
  meldOnderdrukt(wat, g);
  return true;
}
