// Lagen aan- en uitzetten vanuit het paneel Lagen (#684).
//
// De stand staat per document in een OptionalContentConfig van pdf.js: die
// kent de lagen, hun beginstand en de keuzegroepen (/RBGroups: één laag aan
// zet de andere van de groep uit). Het paneel leest hem, de PDF.js-paden
// (webversie, voorvertoning, miniaturen) tekenen ermee.
//
// Op de desktop tekent PDFium, uit het bestand. Daar maakt elke wissel een
// weergavekopie (laagstand.js: het bestand plus één incrementele update met de
// nieuwe /OFF-lijst) in de tijdelijke map, en leidt Rust de render-opdrachten
// van het document daarheen (set_layer_view). Het document zelf, zijn pad en
// opslaan blijven ongemoeid: de laagstand is een weergave, zoals in andere
// PDF-lezers, en gaat niet mee in het bestand.
//
// De stand hoort bij één PDF.js-document en één pad. Vervangt een
// paginabewerking de bytes (nieuw pdfDoc, nieuw werkbestand), dan geldt weer
// de beginstand van het document.

import { getActiveDocument } from '../core/state.js';
import { isBeginstand, laagstandBasis, laagstandUpdate, uitgezet, weergaveBytes } from './laagstand.js';

/** doc.id → { pdfDoc, pad, config, kopie, basis, bytes, rij } */
const standen = new Map();
/** Paden waarvoor Rust nu uit een weergavekopie tekent. */
const omgeleid = new Set();

function geldig(doc, stand) {
  return !!stand && stand.pdfDoc === doc?.pdfDoc && stand.pad === (doc?.filePath || null);
}

/** Tekent Rust de pagina's van dit pad nu uit een weergavekopie? */
export function tekentUitKopie(pad) {
  return omgeleid.has(pad);
}

/**
 * De laagstand van het document om te tonen en mee te tekenen: de eigen stand
 * na een wissel, anders null (dan geldt de beginstand van het document).
 */
export function eigenLaagConfig(doc = getActiveDocument()) {
  const stand = doc ? standen.get(doc.id) : null;
  return geldig(doc, stand) ? stand.config : null;
}

/** Extra opties voor `page.render()` van PDF.js: de eigen laagstand. */
export function pdfjsLaagOpties(doc = getActiveDocument()) {
  const config = eigenLaagConfig(doc);
  return config ? { optionalContentConfigPromise: Promise.resolve(config) } : {};
}

async function platform() {
  return import('../core/platform.js');
}

/** Ruimt een weergavekopie op: Rust-caches, vasthouden en het bestand. */
async function ruimKopieOp(doc, kopie) {
  if (!kopie) return;
  const vrijgave = await import('./document-release.js');
  vrijgave.laatWerkbestandLos(kopie);
  await vrijgave.ruimWerkbestandenOp(doc, [kopie]);
}

/** Alle beelden van dit pad weg, en wat er nu te zien is opnieuw tekenen. */
async function tekenOpnieuw(doc, pad) {
  const [bitmaps, tegels, renderer, vector] = await Promise.all([
    import('./page-bitmap-cache.js'),
    import('./tile-cache.js'),
    import('./renderer.js'),
    import('./vector-renderer.js'),
  ]);
  if (pad) {
    bitmaps.invalidateDocumentBitmaps(pad);
    tegels.tileCacheClearForFile(pad);
    renderer.clearBitmapJSCacheForFile(pad);
    vector.invalidateDocumentCache(pad);
  }
  renderer.clearLowResCache();
  try {
    const paneel = await import('../ui/panels/left-panel.js');
    const aantal = doc.pdfDoc?.numPages || 0;
    paneel.invalidateThumbnails(Array.from({ length: aantal }, (_, i) => i + 1));
  } catch (e) {
    console.warn('[lagen] miniaturen niet ververst:', e);
  }
  if (doc !== getActiveDocument()) return;
  // Zelfde verversing als bij Thin Lines: het beeld van de huidige weergave,
  // en wat later in beeld komt mist de cache vanzelf.
  const { refreshAfterThinLinesChange } = await import('./thin-lines.js');
  await refreshAfterThinLinesChange();
}

/** Meldt de kopie voor dit pad aan bij Rust (of af met null). */
async function meldKopie(pad, kopie) {
  const { invoke } = await platform();
  await invoke('set_layer_view', { path: pad, view: kopie });
  if (kopie) omgeleid.add(pad);
  else omgeleid.delete(pad);
}

/** Schrijft de weergavekopie voor deze stand; null als de beginstand geldt. */
async function schrijfKopie(doc, stand, begin) {
  if (isBeginstand(stand.config, begin)) return null;
  const { readBinaryFile, writeBinaryFile, invoke } = await platform();
  if (!stand.bytes) {
    const { getCachedPdfBytes } = await import('./loader.js');
    stand.bytes = getCachedPdfBytes(stand.pad) || new Uint8Array(await readBinaryFile(stand.pad));
  }
  if (stand.basis === undefined) stand.basis = await laagstandBasis(stand.bytes);
  if (!stand.basis) throw new Error('document heeft geen /OCProperties /D');
  const bytes = weergaveBytes(stand.bytes, laagstandUpdate(stand.basis, uitgezet(stand.config)));

  const map = await window.__TAURI__.path.tempDir();
  const sep = (map.endsWith('/') || map.endsWith('\\')) ? '' : '/';
  const kopie = `${map}${sep}opds-lagen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  try { await invoke('allow_fs_scope', { path: kopie }); } catch { /* scope bestaat al */ }
  await writeBinaryFile(kopie, bytes);
  const vrijgave = await import('./document-release.js');
  vrijgave.houdWerkbestandVast(kopie);
  vrijgave.onthoudWerkbestand(doc, kopie);
  return kopie;
}

/**
 * De stand van het document, aangemaakt bij de eerste wissel. Een stand van
 * een vorige versie van het document (andere bytes of ander pad) gaat eerst
 * weg, met zijn kopie.
 */
async function standVoor(doc) {
  const oud = standen.get(doc.id);
  if (geldig(doc, oud)) return oud;
  standen.delete(doc.id);
  if (oud) await laatOudeStandLos(doc, oud);
  const config = await doc.pdfDoc.getOptionalContentConfig();
  const stand = { pdfDoc: doc.pdfDoc, pad: doc.filePath || null, config, kopie: null, basis: undefined, bytes: null, rij: Promise.resolve() };
  standen.set(doc.id, stand);
  return stand;
}

async function laatOudeStandLos(doc, oud) {
  try {
    if (oud.pad && oud.kopie && omgeleid.has(oud.pad)) await meldKopie(oud.pad, null);
    await ruimKopieOp(doc, oud.kopie);
  } catch (e) {
    console.warn('[lagen] oude weergavekopie niet opgeruimd:', e);
  }
}

/**
 * Is er een stand van een vorige versie van dit document? Dan geldt weer de
 * beginstand (het paneel roept dit aan voor het de lijst opbouwt).
 */
export async function vergeetVerouderdeStand(doc = getActiveDocument()) {
  if (!doc) return;
  const oud = standen.get(doc.id);
  if (!oud || geldig(doc, oud)) return;
  standen.delete(doc.id);
  await laatOudeStandLos(doc, oud);
}

/**
 * Zet een laag aan of uit en tekent de weergave opnieuw. Wissels na elkaar
 * lopen in volgorde; elke wissel tekent uit de stand na alle wissels ervoor.
 * @returns {Promise<boolean>} de stand van de laag na de wissel
 */
export async function zetLaagZichtbaar(doc, id, zichtbaar) {
  if (!doc?.pdfDoc) return false;
  const stand = await standVoor(doc);
  stand.config.setVisibility(id, !!zichtbaar);
  const klaar = stand.rij.then(() => pasStandToe(doc, stand));
  stand.rij = klaar.catch(() => {});
  await klaar;
  return stand.config.getGroup(id)?.visible !== false;
}

async function pasStandToe(doc, stand) {
  if (!geldig(doc, stand)) return;
  const { isTauri } = await platform();
  if (isTauri() && stand.pad) {
    const begin = await doc.pdfDoc.getOptionalContentConfig();
    const vorige = stand.kopie;
    const kopie = await schrijfKopie(doc, stand, begin);
    await meldKopie(stand.pad, kopie);
    stand.kopie = kopie;
    console.log('[lagen] uit:', uitgezet(stand.config).join(',') || '-', kopie ? `kopie ${kopie}` : 'beginstand');
    await tekenOpnieuw(doc, stand.pad);
    await ruimKopieOp(doc, vorige);
  } else {
    await tekenOpnieuw(doc, null);
  }
}
