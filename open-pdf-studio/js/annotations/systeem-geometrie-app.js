// Geometriesnapshot van een systeem in het actieve document (#567, punt 7):
// de app-kant. Zoekt de annotatie, de tekenschaal op die plek en het type op
// (dezelfde resolutie als het tekenen: systeemrasterBuildOpts) en laat de
// pure module systeem-geometrie.js de snapshot maken. Leest alleen: geen
// opslag, geen hertekenen, geen melding. Zoom en weergaverotatie worden niet
// gelezen; annotaties leven in paginaruimte.
import { getActiveDocument } from '../core/state.js';
import { systeemrasterBuildOpts } from './systeemraster-scale.js';
import { systeemGeometrie, controleerGeometrieOpties, documentRevisie } from './systeem-geometrie.js';
import { SysteemTypeFout } from './systeem-typen-contract.js';

/**
 * De snapshot van het systeem `annotationId` in het actieve document, of null
 * als daar geen systeem met dat id is. Gooit SysteemTypeFout bij ongeldige
 * argumenten of een verouderde verwachte revisie.
 */
export function systeemInstanceGeometrie(annotationId, opties) {
  if (typeof annotationId !== 'string' || !annotationId) {
    throw new SysteemTypeFout('invalid-argument', 'annotationId must be a non-empty string');
  }
  controleerGeometrieOpties(opties);
  const doc = getActiveDocument();
  const ann = (doc?.annotations || []).find(a => a && a.id === annotationId && a.type === 'systeemraster');
  if (!ann) return null;
  const { pxPerMm, typeDef } = systeemrasterBuildOpts(ann);
  return systeemGeometrie({ documentId: doc.id ?? null, ann, pxPerMm, typeDef, opties });
}

/**
 * De geometrierevisie ('g1-…') van een systeem-instance, met de tekenschaal
 * op die plek: dezelfde waarde als `document.revision` van de snapshot.
 * Voor de instancerevisie van de plugin-API (#574). Leest alleen.
 */
export function systeemGeometrieRevisie(ann) {
  const { pxPerMm } = systeemrasterBuildOpts(ann);
  return documentRevisie(ann, pxPerMm);
}
