// Spatial zones on copied PDF pages (merge, insert pages, paste/duplicate).
//
// A zone travels in its annotation dictionary as /OPS_SpatialZone. A copied
// page keeps the ids of the original, and two zones with one id make both
// invalid (spatial-zones.js collectZones). Here every copy gets fresh ids
// where its ids are already in use.
//
// Only pdf-lib: runs under node in the unit tests.

import { PDFName, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import { zoneDefinition, relinkZoneIds, relinkedZone } from '../annotations/spatial-zones.js';
import { pdfTextString, decodePdfTextObject } from './saver/pdf-text.js';

const ZONE_KEY = PDFName.of('OPS_SpatialZone');
const MAX_ZONE_TEXT = 2000;

function lookup(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

/** Every annotation with a valid zone on `pages`: `{ dict, zone }`. */
function zoneEntries(context, pages) {
  const entries = [];
  for (const page of pages) {
    const annots = lookup(context, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (const raw of annots.asArray()) {
      const dict = lookup(context, raw);
      if (!(dict instanceof PDFDict)) continue;
      const text = decodePdfTextObject(lookup(context, dict.get(ZONE_KEY)));
      if (typeof text !== 'string' || text.length > MAX_ZONE_TEXT) continue;
      let zone = null;
      try {
        zone = zoneDefinition(JSON.parse(text));
      } catch {
        zone = null;
      }
      if (zone) entries.push({ dict, zone });
    }
  }
  return entries;
}

/** The zone ids on `pages`. */
export function zoneIdsInPages(context, pages) {
  return new Set(zoneEntries(context, pages).map((entry) => entry.zone.id));
}

/** The zone ids of the annotations in a document model. */
export function zoneIdsInAnnotations(annotations) {
  const ids = new Set();
  for (const ann of annotations || []) {
    const zone = zoneDefinition(ann?.spatialZone);
    if (zone) ids.add(zone.id);
  }
  return ids;
}

/**
 * Give the zones on the copied `pages` fresh ids where theirs are in `taken`
 * (updated in place). Returns the renamed ids (old -> new).
 */
export function relinkZonesInPages(context, pages, taken) {
  const entries = zoneEntries(context, pages);
  const renamed = relinkZoneIds(entries.map((entry) => entry.zone), taken);
  if (!renamed.size) return renamed;
  for (const { dict, zone } of entries) {
    const next = relinkedZone(zone, renamed);
    if (next.id !== zone.id || next.parentId !== zone.parentId) {
      dict.set(ZONE_KEY, pdfTextString(JSON.stringify(next)));
    }
  }
  return renamed;
}
