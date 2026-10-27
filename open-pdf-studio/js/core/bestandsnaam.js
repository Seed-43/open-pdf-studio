// Leesbare bestandsnaam uit een pad of een Android content://-URI (#596).
//
// "Openen met" en de bestandskiezer op Android leveren een content://-URI
// met een opaak document-id (`.../document/msf%3A19`). De echte naam kent
// alleen de ContentResolver (OpenableColumns.DISPLAY_NAME); de Android-
// activiteit (src-tauri/android/MainActivity.kt) geeft die door als
// `window.OpdsAndroid.displayName(uri)`. Zonder die brug, of als de provider
// geen naam heeft, maken we er zelf iets leesbaars van.

const ANDROID_NAMEN = new Map();
const STANDAARDNAAM = 'Document.pdf';

/** Weergavenaam van een content://-URI volgens Android, of null. */
export function androidWeergaveNaam(uri, brug = globalThis.OpdsAndroid) {
  if (typeof uri !== 'string' || !uri.startsWith('content://')) return null;
  if (ANDROID_NAMEN.has(uri)) return ANDROID_NAMEN.get(uri);
  if (!brug || typeof brug.displayName !== 'function') return null;
  let naam = null;
  try {
    naam = brug.displayName(uri);
  } catch {
    naam = null;
  }
  naam = typeof naam === 'string' ? naam.replace(/[\\/]/g, '_').trim() || null : null;
  ANDROID_NAMEN.set(uri, naam);
  return naam;
}

/** Naam afgeleid uit de URI zelf; een opaak nummer wordt "Document.pdf". */
export function naamUitContentUri(uri) {
  let tekst = uri;
  try {
    tekst = decodeURIComponent(uri);
  } catch { /* half gecodeerd: zo laten */ }
  // .../document/primary:Download/plan.pdf of raw:/storage/.../plan.pdf
  const pdf = tekst.match(/[/:]([^/:]+\.pdf)$/i);
  if (pdf) return pdf[1];
  const delen = tekst.replace(/^content:\/\//, '').split(/[/:]+/).filter(Boolean);
  const laatste = delen.length > 1 ? delen[delen.length - 1] : '';
  if (!laatste || /^\d+$/.test(laatste)) return STANDAARDNAAM;
  return laatste;
}

/** Bestandsnaam voor tabblad en titel, voor een pad of een content://-URI. */
export function bestandsnaamUitPad(pad, brug) {
  if (!pad) return null;
  if (pad.startsWith('content://')) return androidWeergaveNaam(pad, brug) || naamUitContentUri(pad);
  return pad.split(/[\\/]/).pop() || null;
}
