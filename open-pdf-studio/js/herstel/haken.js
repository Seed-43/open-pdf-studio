// Haken tussen de rest van de app en de herstelbewaking (herstel.js).
//
// Zonder afhankelijkheden, zodat de saver en de tabbladen ze kunnen
// importeren zonder een kringverwijzing. Zolang de bewaking niet draait
// (browser, tests) doen ze niets.

const tellers = new Map();
let ontvanger = null;

/** Een wijziging buiten de undo-geschiedenis (formuliervelden e.d.). */
export function meldWijziging(doc) {
  if (!doc?.id) return;
  tellers.set(doc.id, (tellers.get(doc.id) || 0) + 1);
}

export function wijzigTeller(docId) {
  return tellers.get(docId) || 0;
}

/** Het document is opgeslagen: zijn momentopname is niet meer nodig. */
export function meldOpgeslagen(doc) {
  try { ontvanger?.opgeslagen?.(doc); } catch (e) { console.warn('[herstel] na opslaan:', e); }
}

/** Het tabblad is gesloten (opgeslagen of bewust niet): momentopname weg. */
export function meldGesloten(doc) {
  if (doc?.id) tellers.delete(doc.id);
  try { ontvanger?.gesloten?.(doc); } catch (e) { console.warn('[herstel] na sluiten:', e); }
}

/**
 * Alle tabbladen zijn gesloten of verworpen en de app sluit af: eigen
 * momentopnamen weg en de Rust-kant mag de markering opruimen.
 */
export async function meldSchoonAfsluiten() {
  try { await ontvanger?.schoonAfsluiten?.(); } catch (e) { console.warn('[herstel] schoon afsluiten:', e); }
}

export function zetOntvanger(o) {
  ontvanger = o;
}
