// Ties normal markups to saved 3D views.
//
// A markup drawn while a 3D markup session is running (the Markup button in
// the 3D toolbar) gets `threeDViewId` = the saved view it was drawn on. Such
// a markup is only drawn and clickable while that view is shown, because it
// points at parts of the model as seen from that camera. The link is saved
// in the PDF as /OPS_3DView on the annotation (saver.js, color-extraction.js).
//
// No app-state imports here: view-filters.js and undo-manager.js use this on
// every draw and every new markup.

const activeByAnnot = new Map(); // 3D annotation key -> view id shown and locked
let activeIds = new Set();
let session = null; // { viewId, page } while marking up

function refresh() {
  activeIds = new Set([...activeByAnnot.values()].filter(Boolean));
  Promise.all([import('../../annotations/rendering.js'), import('../../core/state.js')])
    .then(([r, st]) => {
      if (st.getActiveDocument()?.viewMode === 'continuous') r.redrawContinuous();
      else r.redrawAnnotations();
    })
    .catch(() => {});
}

/** The view shown (and locked) for one 3D annotation, or null. */
export function setActive3DView(annotKey, viewId) {
  if (viewId) activeByAnnot.set(annotKey, viewId);
  else activeByAnnot.delete(annotKey);
  refresh();
}

/** Start or stop tagging new markups with a saved view. */
export function setMarkupSession(next) {
  session = next || null;
}

export function markupSession() {
  return session;
}

/** Hidden because it belongs to a saved 3D view that is not shown. */
export function isHiddenBy3DView(ann) {
  return !!(ann && ann.threeDViewId && !activeIds.has(ann.threeDViewId));
}

/** Called for every new markup (undo-manager recordAdd). */
export function tagNewMarkup(ann) {
  if (session && ann && typeof ann === 'object' && !ann.threeDViewId && ann.page === session.page) {
    ann.threeDViewId = session.viewId;
  }
}
