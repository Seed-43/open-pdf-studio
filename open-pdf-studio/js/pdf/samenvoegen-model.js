// Het model van de app rond het samenvoegen van PDF's (samenvoegen.js doet de
// bytes): welk bronbestand al open staat, en de bladwijzers na het
// samenvoegen. Geen imports uit de app: de unit-tests draaien hier onder node op.

/** Een pad om te vergelijken: slashes gelijk, hoofdletters weg (Windows). */
export function padSleutel(pad) {
  return String(pad || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Het geopende document dat bij `pad` hoort, of null. Een document dat na een
 * paginabewerking uit een werkkopie wordt getoond, hoort bij zijn origineel
 * (saveTargetPath); een naamloos document heeft geen bestand.
 */
export function openDocumentVoorPad(documenten, pad) {
  const sleutel = padSleutel(pad);
  if (!sleutel) return null;
  for (const doc of documenten || []) {
    if (!doc?.pdfDoc) continue;
    const eigen = doc.saveTargetPath || (doc.isUntitled ? null : doc.filePath);
    if (eigen && padSleutel(eigen) === sleutel) return doc;
  }
  return null;
}

/**
 * Bladwijzers na het samenvoegen: die van het document zelf (op hun nieuwe
 * paginanummer) en per samengevoegd bestand de bladwijzer met de naam van het
 * bestand en zijn bladwijzers eronder, zoals ze uit het samengevoegde
 * document gelezen zijn.
 *
 * @param {object[]} model         doc.bookmarks vóór het samenvoegen
 * @param {object[]} uitBytes      loadBookmarksFromPdf van het resultaat
 * @param {{groepIndexen:number[], pageMapping:object, invoegIndex:number, positie:string, idVoorvoegsel?:string}} o
 *   groepIndexen: de plaats van elke bestandsbladwijzer onder de bovenste
 *   bladwijzers van het resultaat; invoegIndex: het aantal pagina's vóór de
 *   ingevoegde.
 * @returns {object[]}
 */
export function bladwijzersNaSamenvoegen(model, uitBytes, o) {
  const { groepIndexen = [], pageMapping = {}, invoegIndex = 0, positie = 'end' } = o || {};
  const voorvoegsel = o?.idVoorvoegsel || `bm_m${Date.now().toString(36)}_`;
  const eigen = (model || []).map((b) => ({ ...b, page: pageMapping[b.page] ?? b.page }));

  const sorteer = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0);
  const bovenUit = (uitBytes || []).filter((b) => !b.parentId).sort(sorteer);
  const kinderen = new Map();
  for (const b of uitBytes || []) {
    if (!b.parentId) continue;
    if (!kinderen.has(b.parentId)) kinderen.set(b.parentId, []);
    kinderen.get(b.parentId).push(b);
  }
  let teller = 0;
  const nieuw = [];
  const neemOver = (b, ouderId) => {
    const id = `${voorvoegsel}${++teller}`;
    nieuw.push({ ...b, id, parentId: ouderId });
    for (const k of kinderen.get(b.id) || []) neemOver(k, id);
    return id;
  };
  const groepen = [];
  for (const i of groepIndexen) {
    const g = bovenUit[i];
    if (!g) continue;
    const id = neemOver(g, null);
    groepen.push(nieuw.find((b) => b.id === id));
  }

  // De volgorde bovenaan: de groepen op de plek van de ingevoegde pagina's.
  const boven = eigen.filter((b) => !b.parentId).sort(sorteer);
  let plek;
  if (positie === 'start') plek = 0;
  else if (positie === 'end') plek = boven.length;
  else {
    plek = 0;
    const oud = (model || []).filter((b) => !b.parentId).sort(sorteer);
    oud.forEach((b, i) => { if (b.page <= invoegIndex) plek = i + 1; });
  }
  const volgorde = [...boven.slice(0, plek), ...groepen, ...boven.slice(plek)];
  volgorde.forEach((b, i) => { b.sortOrder = i; });
  return [...eigen, ...nieuw];
}
