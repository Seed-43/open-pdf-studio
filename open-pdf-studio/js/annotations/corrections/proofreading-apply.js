// Proofreading mode (#508, part 2): corrections into the document.
//
// Every correction is one undo step: an insert or a delete is one add, a
// replace (caret plus strike) one bulk add. A strike-through that grows with
// repeated Delete or Backspace presses updates its own add step
// (amendLastAdd), so one undo removes it as a whole.
//
// The annotation pushed into doc.annotations may be stored as a copy, so
// everything after the push works on the stored one (found by id).

import { createAnnotation, cloneAnnotation } from '../factory.js';
import { recordAdd, recordBulkAdd, recordModify, amendLastAdd } from '../../core/undo-manager.js';
import {
  makeInsert, makeReplace, makeDelete, strikeProps, strikeStep, normalizeRange, hasSelection,
} from './proofreading.js';

const opgeslagen = (doc, id) => (doc?.annotations || []).find((a) => a && a.id === id) || null;
const nieuwId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 11);

/** Insert `text` at position `pos`; returns the stored caret or null. */
export function applyInsert(doc, model, page, pos, text) {
  const props = doc ? makeInsert(model, pos, text, { page }) : null;
  if (!props) return null;
  const ann = createAnnotation(props);
  doc.annotations.push(ann);
  recordAdd(ann);
  return opgeslagen(doc, ann.id) || ann;
}

/** Replace `range` by `text`; returns the stored { caret, strike } or null. */
export function applyReplace(doc, model, page, range, text) {
  const r = doc && range ? normalizeRange(model, range.start, range.end) : null;
  const delen = r ? makeReplace(model, r, text, { page, caretId: nieuwId() }) : null;
  if (!delen) return null;
  const caret = createAnnotation(delen.caret);
  const strike = createAnnotation(delen.strike);
  // The strike first: the caret is drawn on top of it.
  doc.annotations.push(strike, caret);
  recordBulkAdd([strike, caret]);
  return { caret: opgeslagen(doc, caret.id) || caret, strike: opgeslagen(doc, strike.id) || strike };
}

/**
 * Delete or Backspace.
 * - Over a selection: a new strike over it.
 * - Right after a strike (the cursor at its end or start, `last` still in
 *   the document): that strike grows by one step.
 * - Otherwise: a new strike of one character (or word) next to the cursor.
 * The cursor goes to the far side of the strike in the direction of the key.
 * @param {{ cursor: number, selection?: {anchor:number,focus:number}|null,
 *   last?: {id:string,page:number,start:number,end:number}|null,
 *   dir: 'forward'|'backward', unit?: 'char'|'word' }} opties
 * @returns {{ annotation: object|null, cursor: number, last: object|null }}
 */
export function applyStrike(doc, model, page, { cursor, selection = null, last = null, dir, unit = 'char' }) {
  const niets = { annotation: null, cursor, last };
  if (!doc) return niets;
  const naar = (range) => (dir === 'forward' ? range.end : range.start);

  const vorige = last && last.page === page ? opgeslagen(doc, last.id) : null;
  if (!hasSelection(selection) && vorige && (cursor === last.end || cursor === last.start)) {
    const groter = strikeStep(model, last, dir, unit);
    const geo = groter ? strikeProps(model, groter) : null;
    if (!geo) return niets;
    const oud = cloneAnnotation(vorige);
    Object.assign(vorige, geo, { modifiedAt: new Date().toISOString() });
    if (!amendLastAdd(vorige)) recordModify(vorige.id, oud, vorige);
    return { annotation: vorige, cursor: naar(groter), last: { id: vorige.id, page, ...groter } };
  }

  const range = hasSelection(selection)
    ? normalizeRange(model, selection.anchor, selection.focus)
    : strikeStep(model, { start: cursor, end: cursor }, dir, unit);
  const props = range ? makeDelete(model, range, { page }) : null;
  if (!props) return niets;
  const ann = createAnnotation(props);
  doc.annotations.push(ann);
  recordAdd(ann);
  const stored = opgeslagen(doc, ann.id) || ann;
  return { annotation: stored, cursor: naar(range), last: { id: stored.id, page, ...range } };
}
