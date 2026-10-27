import { isLayerLocked } from './annotatie-lagen.js';
import { getActiveDocument, getAnnotationBounds } from '../core/state.js';
import { collectZones, locationFor, zoneDefinition, zonePolygon } from './spatial-zones.js';
import { recordModify } from '../core/undo-manager.js';
import { cloneAnnotation } from './factory.js';
import { redrawAnnotations } from './rendering.js';

export function inspectLocations(doc = getActiveDocument()) {
  if (!doc) throw new Error('NO_DOCUMENT');
  const zones = collectZones(doc.annotations);
  return {
    documentId: doc.id,
    complete: (doc._annotationPagesReady?.size || 0) >= (doc.pdfDoc?.numPages || 0),
    zones: zones.map(z => ({ annotationId: z.ann.id, ...z.zone, page: z.ann.page, path: z.path, valid: z.valid })),
    locations: doc.annotations.map(a => ({ annotationId: a.id, page: a.page, ...locationFor(a, zones, getAnnotationBounds(a)) }))
  };
}

export function updateLocation(request) {
  const doc = getActiveDocument();
  if (!doc || doc.id !== request.documentId) throw new Error('DOCUMENT_CHANGED');
  const ann = doc.annotations.find(a => a.id === request.annotationId);
  if (!ann || ann.locked || ann.readOnly || isLayerLocked(doc, ann)) throw new Error('ANNOTATION_UNAVAILABLE');
  const before = cloneAnnotation(ann);
  if (request.action === 'zone') {
    if (!zonePolygon(ann)) throw new Error('ZONE_REQUIRES_SIMPLE_POLYGON_OR_BOX');
    const zone = zoneDefinition({
      version: 1,
      id: ann.spatialZone?.id || crypto.randomUUID(),
      name: request.name,
      parentId: request.parentId || ''
    });
    if (!zone) throw new Error('INVALID_ZONE');
    const candidate = { ...ann, spatialZone: zone };
    const zones = collectZones(doc.annotations.map(a => a === ann ? candidate : a));
    if (!zones.find(z => z.ann === candidate)?.valid) throw new Error('INVALID_HIERARCHY');
    ann.spatialZone = zone;
  } else if (request.action === 'removeZone') {
    if (doc.annotations.some(a => a.spatialZone?.parentId === ann.spatialZone?.id && ann.spatialZone?.id)) throw new Error('ZONE_HAS_CHILDREN');
    delete ann.spatialZone;
  } else if (request.action === 'override') {
    if (typeof request.value !== 'string' || request.value.length > 1000) throw new Error('INVALID_LOCATION');
    ann.locationOverride = request.value;
  } else if (request.action === 'automatic') delete ann.locationOverride;
  else throw new Error('INVALID_ACTION');
  recordModify(ann.id, before, cloneAnnotation(ann));
  redrawAnnotations();
  return inspectLocations(doc);
}
