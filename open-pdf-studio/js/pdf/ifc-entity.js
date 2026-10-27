// One `.ifcreport` entity per annotation (see ifc-export.js). Kept apart
// from the export itself (no app-state, dialog or i18n imports) so it can be
// tested under node --test.

import { getTemplate } from '../symbols/registry.js';
import { ifcCategoryForAnnotation } from '../solid/data/ifcCategoryMap.js';
import { migreerProfielParams } from '../symbols/koker-notatie.js';

function _ifcClassFor(ann) {
  return ifcCategoryForAnnotation(ann);
}

function _geometryOf(ann) {
  const g = {};
  for (const k of ['x', 'y', 'width', 'height', 'startX', 'startY', 'endX', 'endY', 'rotation']) {
    if (typeof ann[k] === 'number') g[k] = ann[k];
  }
  if (Array.isArray(ann.points)) g.points = ann.points.map(p => ({ x: p.x, y: p.y }));
  if (Array.isArray(ann.holes)) g.holes = ann.holes.map(h => h.map(p => ({ x: p.x, y: p.y })));
  if (Array.isArray(ann.path)) g.path = ann.path.map(p => ({ x: p.x, y: p.y }));
  return g;
}

// Steel profile symbols: built-in NL families (staal-*) and downloaded
// steel catalogs (steel-*). Their `maat` is the profile name.
function _isSteelProfile(symbolId) {
  return typeof symbolId === 'string' && /^(staal|steel)-/.test(symbolId);
}

/** One report entity for an annotation. */
export function ifcEntityFor(ann) {
  const cls = _ifcClassFor(ann);
  const props = {};
  if (ann.type === 'wall') {
    props.dikteMm = ann.dikteMm ?? 100;
    props.materiaal = ann.hatchPattern || null;
  }
  if (ann.type === 'parametricSymbol') {
    props.template = ann.symbolId;
    const tpl = getTemplate(ann.symbolId);
    if (tpl) props.templateNaam = tpl.name;
    // Older documents may still carry "Koker 100x100x5"; the report always
    // uses the current name (K100/5).
    if (ann.params) props.params = { ...migreerProfielParams(ann.symbolId, ann.params) };
    if (_isSteelProfile(ann.symbolId) && typeof props.params?.maat === 'string') {
      props.profileName = props.params.maat;
    }
  }
  // Symboolstempels (NEN 1414 e.d.): herkomst + IFC PredefinedType.
  if (ann.type === 'stamp') {
    if (ann.symbolId) props.symbol = ann.symbolId;
    if (ann.stampName) props.symbolNaam = ann.stampName;
  }
  if (ann.ifcPredefinedType) props.predefinedType = ann.ifcPredefinedType;
  if (ann.measureText) props.measureText = ann.measureText;
  if (ann.text) props.text = ann.text;
  if (ann.subject) props.subject = ann.subject;

  return {
    id: ann.id,
    class: cls,
    page: ann.page ?? 1,
    name: ann.params?.naam || props.profileName || ann.measureName || ann.subject || null,
    geometry: _geometryOf(ann),
    style: {
      color: ann.strokeColor || ann.color || null,
      lineWidth: ann.lineWidth ?? null,
      hatchPattern: ann.hatchPattern || null,
    },
    properties: props,
    createdAt: ann.createdAt || null,
    modifiedAt: ann.modifiedAt || null,
  };
}
