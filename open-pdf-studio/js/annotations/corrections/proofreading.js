// Proofreading mode (#508, part 2): the rules between keys, the text model
// (text-model.js) and the correction annotations of model.js.
//
// - Typing at a cursor: an insert (caret with the typed text).
// - Typing over a selection: a replace (caret parent with intent 'Replace'
//   at the end of the selection, plus a strike-through child linked by
//   inReplyTo / replyType 'group' / groupId).
// - Delete or Backspace: a strike-through with intent 'StrikeOutTextEdit';
//   pressing again extends it.
// The struck text goes into markedText (saved as /OPS_MarkedText), never into
// the comment (/Contents).
//
// Pure: no DOM, no app state.

import {
  totalLength, charAt, moveCursor, rangeText, rangeRects, caretAt, hitTest,
} from './text-model.js';
import { caretGlyphBox, quadCorners } from './geometry.js';
import { CORRECTION_COLORS, correctionKind } from './model.js';

/** Is there a selection (anchor and focus apart)? */
export function hasSelection(selection) {
  return !!selection && Number.isFinite(selection.anchor) && Number.isFinite(selection.focus)
    && selection.anchor !== selection.focus;
}

/**
 * The range between two positions, in order, without line breaks at its
 * edges; null if nothing but line breaks (or nothing) lies in between.
 * @returns {{start: number, end: number} | null}
 */
export function normalizeRange(model, a, b) {
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  while (start < end && charAt(model, start) === '\n') start++;
  while (end > start && charAt(model, end - 1) === '\n') end--;
  return end > start ? { start, end } : null;
}

const omhullende = (rects) => {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Geometry and struck text of a strike-through over `range`: bounding box,
 * one rectangle per line, reading direction and markedText. null without
 * characters.
 */
export function strikeProps(model, range) {
  if (!range || !(range.end > range.start)) return null;
  const { rects, textDir } = rangeRects(model, range.start, range.end);
  if (rects.length === 0) return null;
  return {
    ...omhullende(rects),
    rects: rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
    textDir,
    markedText: rangeText(model, range.start, range.end),
  };
}

/** Insert at position `g`: a caret glyph at the baseline point. null without text. */
export function makeInsert(model, g, text, { page } = {}) {
  const c = caretAt(model, g);
  if (!c || typeof text !== 'string' || text === '') return null;
  return {
    type: 'caret',
    page,
    ...caretGlyphBox(c.P, c.h, c.textDir),
    textDir: c.textDir,
    text,
    color: CORRECTION_COLORS.insert,
    opacity: 1,
  };
}

/** Delete of `range`: a red strike-through. null without characters. */
export function makeDelete(model, range, { page } = {}) {
  const geo = strikeProps(model, range);
  if (!geo) return null;
  return {
    type: 'textStrikethrough',
    intent: 'StrikeOutTextEdit',
    page,
    ...geo,
    color: CORRECTION_COLORS.delete,
    opacity: 1,
  };
}

/**
 * Replace of `range` by `text`: the caret (parent, id `caretId`) at the end
 * of the range and the strike-through (child). Both purple, one group.
 * @returns {{ caret: object, strike: object } | null}
 */
export function makeReplace(model, range, text, { page, caretId } = {}) {
  const geo = strikeProps(model, range);
  const c = geo ? caretAt(model, range.end) : null;
  if (!geo || !c || typeof text !== 'string' || text === '' || caretId == null) return null;
  const caret = {
    id: caretId,
    type: 'caret',
    intent: 'Replace',
    groupId: caretId,
    page,
    ...caretGlyphBox(c.P, c.h, c.textDir),
    textDir: c.textDir,
    text,
    color: CORRECTION_COLORS.replace,
    opacity: 1,
  };
  const strike = {
    type: 'textStrikethrough',
    intent: 'StrikeOutTextEdit',
    inReplyTo: caretId,
    replyType: 'group',
    groupId: caretId,
    page,
    ...geo,
    color: CORRECTION_COLORS.replace,
    opacity: 1,
  };
  return { caret, strike };
}

/**
 * One more step of a strike-through: forward (Delete) at its end or
 * backward (Backspace) at its start, by one character or one word. A start
 * range may be empty ({start: g, end: g}: the cursor). A line break alone
 * never counts as a step. null when the page has nothing more on that side.
 * @param {'forward'|'backward'} dir
 * @param {'char'|'word'} [unit]
 */
export function strikeStep(model, range, dir, unit = 'char') {
  const n = totalLength(model);
  const oud = normalizeRange(model, range.start, range.end);
  let start = range.start;
  let end = range.end;
  for (let poging = 0; poging < 4; poging++) {
    if (dir === 'forward') {
      if (end >= n) return null;
      end = unit === 'word' ? moveCursor(model, end, 'wordRight').pos : end + 1;
      while (end < n && charAt(model, end - 1) === '\n' && end - 1 >= start && unit !== 'word') end++;
    } else {
      if (start <= 0) return null;
      start = unit === 'word' ? moveCursor(model, start, 'wordLeft').pos : start - 1;
      while (start > 0 && charAt(model, start) === '\n' && unit !== 'word') start--;
    }
    const nieuw = normalizeRange(model, start, end);
    if (nieuw && (!oud || nieuw.start < oud.start || nieuw.end > oud.end)) return nieuw;
  }
  return null;
}

/**
 * Where a correction sits in the text model of its page: the insertion point
 * of a caret, or the range of a strike-through (from the begin side of its
 * first rectangle to the end side of its last one, in reading direction).
 * @returns {{ pos: number, range?: {start: number, end: number} }}
 */
export function correctionPosition(model, ann) {
  if (ann?.type === 'caret') {
    return { pos: hitTest(model, ann.x + ann.width / 2, ann.y + ann.height / 2) };
  }
  const rects = Array.isArray(ann?.rects) && ann.rects.length > 0
    ? ann.rects : [{ x: ann?.x ?? 0, y: ann?.y ?? 0, width: ann?.width ?? 0, height: ann?.height ?? 0 }];
  const eerste = quadCorners(rects[0], ann?.textDir ?? 0);
  const laatste = quadCorners(rects[rects.length - 1], ann?.textDir ?? 0);
  const begin = { x: (eerste[0].x + eerste[2].x) / 2, y: (eerste[0].y + eerste[2].y) / 2 };
  const eind = { x: (laatste[1].x + laatste[3].x) / 2, y: (laatste[1].y + laatste[3].y) / 2 };
  const a = hitTest(model, begin.x, begin.y);
  const b = hitTest(model, eind.x, eind.y);
  const range = { start: Math.min(a, b), end: Math.max(a, b) };
  return { pos: range.start, range };
}

/** Tab stops: inserts, deletes and replaces (the strike of a replace belongs to its caret). */
export function isTabStop(ann, byId) {
  const soort = correctionKind(ann, byId);
  return soort === 'insert' || soort === 'delete' || soort === 'replace';
}

const vergelijk = (a, b) => (a.page - b.page) || (a.pos - b.pos);

/** Corrections {id, page, pos} in reading order: page, then position; ties keep their order. */
export function sortCorrections(entries) {
  return (entries || []).map((e, i) => ({ e, i }))
    .sort((x, y) => vergelijk(x.e, y.e) || (x.i - y.i))
    .map(({ e }) => e);
}

/**
 * The correction Tab (dir 1) or Shift+Tab (dir -1) goes to. From the current
 * correction the one after or before it; otherwise the first one at or after
 * the cursor, or the last one before it. Wraps around.
 * @param {Array<{id: string, page: number, pos: number}>} sorted  from sortCorrections
 * @param {{ page: number, pos: number, currentId?: string|null }} from
 */
export function nextCorrection(sorted, from, dir) {
  const lijst = sorted || [];
  if (lijst.length === 0) return null;
  const stap = dir < 0 ? -1 : 1;
  const i = from?.currentId != null ? lijst.findIndex((e) => e.id === from.currentId) : -1;
  if (i >= 0) return lijst[(i + stap + lijst.length) % lijst.length];
  const cursor = { page: from?.page ?? 1, pos: from?.pos ?? 0 };
  if (stap > 0) return lijst.find((e) => vergelijk(e, cursor) >= 0) || lijst[0];
  for (let k = lijst.length - 1; k >= 0; k--) if (vergelijk(lijst[k], cursor) < 0) return lijst[k];
  return lijst[lijst.length - 1];
}

/** What Esc does now: close the input, clear the selection, or leave the mode. */
export function escapeStep({ inputOpen = false, selection = null } = {}) {
  if (inputOpen) return 'closeInput';
  if (hasSelection(selection)) return 'clearSelection';
  return 'exitMode';
}

const PIJLEN = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn']);

/**
 * The command for a keydown in the mode, or null to let the app handle it
 * (Ctrl/Alt shortcuts such as undo and save, function keys, lone modifiers).
 * Every printable key without Ctrl or Alt is text, so no tool shortcut fires.
 * @param {{key: string, ctrlKey?: boolean, shiftKey?: boolean, altKey?: boolean, metaKey?: boolean}} e
 * @param {{ inputOpen?: boolean }} [opties]
 */
export function keyCommand(e, { inputOpen = false } = {}) {
  const key = String(e?.key ?? '');
  const ctrl = !!(e?.ctrlKey || e?.metaKey);
  const shift = !!e?.shiftKey;
  const alt = !!e?.altKey;
  const geen = !ctrl && !alt;
  if (key === 'F2' && geen && !shift) return { type: 'toggle' };
  if (inputOpen) {
    if (key === 'Enter' && geen && !shift) return { type: 'commit' };
    if (key === 'Escape') return { type: 'escape' };
    if (key === 'Tab' && geen) return { type: 'commitAndTab', dir: shift ? -1 : 1 };
    return { type: 'input' };
  }
  if (MODIFIERS.has(key)) return null;
  if (key === 'Escape' && geen) return { type: 'escape' };
  if (key === 'Tab') return geen ? { type: 'tab', dir: shift ? -1 : 1 } : null;
  if (PIJLEN[key] && !alt) {
    const how = PIJLEN[key];
    const woord = ctrl && (how === 'left' || how === 'right');
    return { type: 'move', how: woord ? (how === 'left' ? 'wordLeft' : 'wordRight') : how, extend: shift };
  }
  if ((key === 'Home' || key === 'End') && !alt) {
    const how = ctrl ? (key === 'Home' ? 'docStart' : 'docEnd') : (key === 'Home' ? 'lineStart' : 'lineEnd');
    return { type: 'move', how, extend: shift };
  }
  if ((key === 'PageDown' || key === 'PageUp') && geen) return { type: 'page', dir: key === 'PageDown' ? 1 : -1 };
  if ((key === 'Delete' || key === 'Backspace') && !alt) {
    return { type: 'strike', dir: key === 'Delete' ? 'forward' : 'backward', unit: ctrl ? 'word' : 'char' };
  }
  // Text: one character; with AltGr (Ctrl+Alt on Windows) too.
  if (Array.from(key).length === 1 && (geen || (ctrl && alt && !e?.metaKey))) return { type: 'type', text: key };
  if (ctrl && !alt && !shift) {
    const k = key.toLowerCase();
    if (k === 'a') return { type: 'selectAll' };
    if (k === 'c') return { type: 'copy' };
    if (k === 'v') return { type: 'paste' };
    if (k === 'x') return { type: 'swallow' };
  }
  if (ctrl || alt) return null;
  if (/^F\d{1,2}$/.test(key)) return null;
  return { type: 'swallow' };
}
