/**
 * De app-kant van systeem-instances in de plugin-API (#574): de echte host
 * voor system-instance-api.js en wat het paneel (ScopedInstancePanels.jsx)
 * nodig heeft om namens een extensie een snapshot te lezen en een
 * werkversie toe te passen. Een wijziging is één undo-stap (recordModify),
 * tekent opnieuw en ververst het eigenschappenpaneel als de instance
 * geselecteerd is; dat laatste meldt de selectie opnieuw, zodat de open
 * formulieren hun nieuwe revisie zien.
 */

import { getActiveDocument } from '../core/state.js';
import { recordModify } from '../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { systeemInstanceGeometrie, systeemGeometrieRevisie } from '../annotations/systeem-geometrie-app.js';
import { systeemTypeSnapshot, getSysteemTypeById } from '../annotations/systeem-typen-registry.js';
import { createSystemInstanceApi, instanceSnapshot } from './system-instance-api.js';

export function systeemInstanceHost() {
  return {
    actiefDocument: () => getActiveDocument(),
    geometrieRevisie: (ann) => systeemGeometrieRevisie(ann),
    geometrie: (annotationId) => systeemInstanceGeometrie(annotationId),
    typeSnapshot: (id) => systeemTypeSnapshot(id),
    typeDefinitie: (id) => getSysteemTypeById(id) ?? null,
    wijzig(doc, ann, muteer) {
      const voor = JSON.parse(JSON.stringify(ann));
      muteer(ann);
      recordModify(ann.id, voor, ann);
      if (doc.viewMode === 'continuous') redrawContinuous();
      else redrawAnnotations();
      const enkel = (doc.selectedAnnotations?.length ?? 0) <= 1;
      if (enkel && doc.selectedAnnotation?.id === ann.id) {
        import('../ui/panels/properties-panel.js').then((m) => {
          if (getActiveDocument() === doc && doc.selectedAnnotation?.id === ann.id) m.showProperties(ann, { redraw: false });
        }).catch((e) => console.warn('[extensies] properties not refreshed', e));
      }
    },
  };
}

/** Voor het paneel: lezen en toepassen namens een extensie. */
export const paneelAfhankelijkheden = {
  snapshotVoor(extId, annotationId) {
    const doc = getActiveDocument();
    const ann = (doc?.annotations || []).find((a) => a && a.id === annotationId && a.type === 'systeemraster');
    return ann ? instanceSnapshot(extId, doc, ann, systeemInstanceHost()) : null;
  },
  pasToe(extId, annotationId, changes) {
    return createSystemInstanceApi(extId, systeemInstanceHost()).updateSystemInstance(annotationId, changes);
  },
};
