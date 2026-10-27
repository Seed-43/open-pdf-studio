// Sleutels, bestandsnamen en het manifest van een herstelmomentopname.
//
// Pure regels (getest in manifest.test.mjs). Per document staat er in
// <datamap>/OpenPDFStudio/herstel/<sleutel>/:
//   manifest.json            dit manifest (wordt als laatste geschreven)
//   momentopname-<n>.pdf     de momentopname waar het manifest naar wijst
//
// De sleutel bevat de instantie (pid + starttijd), de frontendsessie en het
// document-id, zodat twee instanties en een herladen WebView elkaars
// momentopnamen nooit overschrijven. Er staat geen documentinhoud in het
// manifest: alleen pad, titel, tijden, aantallen en groottes.

export const MANIFEST_VERSIE = 1;
export const MANIFEST_NAAM = 'manifest.json';
const PDF_PATROON = /^momentopname-(\d+)\.pdf$/;

/** Alleen tekens die de Rust-kant in een padnaam toestaat (herstel.rs). */
export function veiligDeel(tekst, max = 60) {
  const schoon = String(tekst ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, max);
  return schoon || 'x';
}

/** Sleutel (mapnaam) van de momentopname van één document in één sessie. */
export function sleutelVoor(instantieId, sessie, docId) {
  return `${veiligDeel(instantieId, 40)}_${veiligDeel(sessie, 8)}_${veiligDeel(docId, 60)}`;
}

/** Begin van alle sleutels van één sessie (voor het opruimen bij afsluiten). */
export function sessieVoorvoegsel(instantieId, sessie) {
  return `${veiligDeel(instantieId, 40)}_${veiligDeel(sessie, 8)}_`;
}

export function pdfNaam(generatie) {
  return `momentopname-${generatie}.pdf`;
}

/** Generatie uit een bestandsnaam, of null als het geen momentopname is. */
export function generatieVan(naam) {
  const m = PDF_PATROON.exec(String(naam || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Het pad van het origineel waar opslaan naartoe schrijft, of null voor een
 * document dat nog nooit is opgeslagen.
 */
export function origineelPadVan(doc) {
  if (!doc) return null;
  if (doc.saveTargetPath) return doc.saveTargetPath;
  if (doc.isUntitled) return null;
  return doc.originalFilePath || doc.filePath || null;
}

/**
 * @param {object} o
 * @param {string} o.sleutel
 * @param {{id:string,pid:number,gestartMs:number}} o.instantie
 * @param {string} o.sessie
 * @param {{id:string, fileName?:string, pdfDoc?:{numPages:number}}} o.doc
 * @param {string|null} o.origineelPad
 * @param {{grootte:number, gewijzigdMs:number}|null} o.origineel  stand van het origineel bij openen
 * @param {string} o.appVersie
 * @param {number} o.nu
 * @param {string} [o.reden]  'gepland' | 'nood:<soort>'
 */
export function maakManifest({ sleutel, instantie, sessie, doc, origineelPad, origineel, appVersie, nu, reden = 'gepland' }) {
  return {
    versie: MANIFEST_VERSIE,
    sleutel,
    docId: String(doc?.id ?? ''),
    instantie: {
      id: String(instantie?.id ?? ''),
      pid: Number(instantie?.pid) || 0,
      gestartMs: Number(instantie?.gestartMs) || 0,
    },
    sessie: String(sessie ?? ''),
    titel: String(doc?.fileName || ''),
    origineelPad: origineelPad || null,
    origineel: origineel && Number.isFinite(origineel.grootte)
      ? { grootte: origineel.grootte, gewijzigdMs: Number(origineel.gewijzigdMs) || 0 }
      : null,
    tijd: new Date(nu).toISOString(),
    tijdMs: nu,
    paginas: Number(doc?.pdfDoc?.numPages) || 0,
    appVersie: String(appVersie || ''),
    reden,
  };
}

/** Manifest uit tekst; null als het ontbreekt, kapot is of iets mist. */
export function leesManifest(tekst) {
  if (typeof tekst !== 'string' || !tekst) return null;
  let m;
  try { m = JSON.parse(tekst); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  if (m.versie !== MANIFEST_VERSIE) return null;
  if (typeof m.sleutel !== 'string' || !m.sleutel) return null;
  if (!m.instantie || typeof m.instantie.id !== 'string') return null;
  if (typeof m.pdf !== 'string' || generatieVan(m.pdf) == null) return null;
  if (!Number.isFinite(m.tijdMs)) return null;
  return m;
}

/**
 * Is het origineel veranderd sinds het document geopend werd? null als dat
 * niet te zeggen is (geen origineel, of de stand van toen is onbekend).
 */
export function origineelGewijzigd(manifest, nuInfo) {
  const toen = manifest?.origineel;
  if (!manifest?.origineelPad || !toen) return null;
  if (!nuInfo) return true; // weg of onleesbaar
  return nuInfo.grootte !== toen.grootte || Math.abs((nuInfo.gewijzigdMs || 0) - (toen.gewijzigdMs || 0)) > 2000;
}
