// Proofreading mode (#508, part 2): from cursor and selection to corrections,
// extending a strike-through, the Tab order, the Esc levels and the key map.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTextModel, indexOf } from './text-model.js';
import {
  normalizeRange, makeInsert, makeDelete, makeReplace, strikeProps, strikeStep,
  correctionPosition, sortCorrections, nextCorrection, escapeStep, keyCommand, hasSelection,
} from './proofreading.js';
import { caretGlyphBox } from './geometry.js';
import { CORRECTION_COLORS, correctionKind, linkPlanForSave, groupMembers, listPreview } from './model.js';

const V0 = [1, 0, 0, -1, 0, 792];
const V90 = [0, 1, 1, 0, 0, 0];
const item = (str, x, y, extra = {}) => ({
  str, dir: 'ltr', width: str.length * 5, height: 10, transform: [10, 0, 0, 10, x, y], hasEOL: false, ...extra,
});
// 'Teh quick' (0..9) | 'brown fox' (10..19)
const twee = () => buildTextModel([item('Teh quick', 72, 700, { hasEOL: true }), item('brown fox', 72, 686)], { transform: V0 });
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const vak = (r) => [r.x, r.y, r.width, r.height].map(r6);

test('normalizeRange orders the ends and drops line breaks at the edges', () => {
  const m = twee();
  assert.deepEqual(normalizeRange(m, 7, 2), { start: 2, end: 7 });
  assert.deepEqual(normalizeRange(m, 9, 12), { start: 10, end: 12 }, 'starts after the line break');
  assert.deepEqual(normalizeRange(m, 4, 10), { start: 4, end: 9 }, 'ends before the line break');
  assert.equal(normalizeRange(m, 9, 10), null, 'only a line break');
  assert.equal(normalizeRange(m, 3, 3), null, 'empty');
});

test('typing at a cursor makes an insert: a caret glyph at the baseline point, blue', () => {
  const m = twee();
  const ins = makeInsert(m, 3, 'x', { page: 2 });
  assert.equal(ins.type, 'caret');
  assert.equal(ins.page, 2);
  assert.equal(ins.text, 'x');
  assert.equal(ins.textDir, 0);
  assert.equal(ins.color, CORRECTION_COLORS.insert);
  assert.equal(ins.intent, undefined);
  assert.deepEqual(vak(ins), vak(caretGlyphBox({ x: 87, y: 92 }, 10, 0)));
  assert.equal(correctionKind(ins), 'insert');
  assert.equal(makeInsert(m, 3, '', { page: 1 }), null, 'nothing typed: nothing made');
});

test('an insert on a page with /Rotate 90 follows the text direction', () => {
  const m = buildTextModel([item('Abc', 100, 200)], { transform: V90 });
  const ins = makeInsert(m, 1, 'y', { page: 1 });
  assert.equal(ins.textDir, 90);
  assert.deepEqual(vak(ins), vak(caretGlyphBox({ x: 200, y: 105 }, 10, 90)));
});

test('Delete over a selection makes a red strike-through with the struck text in markedText only', () => {
  const m = twee();
  const del = makeDelete(m, normalizeRange(m, 2, 13), { page: 1 });
  assert.equal(del.type, 'textStrikethrough');
  assert.equal(del.intent, 'StrikeOutTextEdit');
  assert.equal(del.color, CORRECTION_COLORS.delete);
  assert.equal(del.markedText, 'h quick bro');
  assert.equal(del.subject, undefined, 'nothing for /Contents');
  assert.equal(del.text, undefined);
  assert.deepEqual(del.rects.map(vak), [[82, 84, 35, 10], [72, 98, 15, 10]]);
  assert.deepEqual(vak(del), [72, 84, 45, 24], 'bounding box of the lines');
  assert.equal(correctionKind(del), 'delete');
  assert.equal(listPreview(del), '- h quick bro', 'the comments panel shows the struck text');
});

test('typing over a selection makes a replace: purple caret parent at the end plus a linked strike child', () => {
  const m = twee();
  const { caret, strike } = makeReplace(m, normalizeRange(m, 0, 3), 'The', { page: 1, caretId: 'k1' });
  assert.equal(caret.id, 'k1');
  assert.equal(caret.type, 'caret');
  assert.equal(caret.intent, 'Replace');
  assert.equal(caret.text, 'The');
  assert.equal(caret.groupId, 'k1');
  assert.equal(caret.color, CORRECTION_COLORS.replace);
  assert.deepEqual(vak(caret), vak(caretGlyphBox({ x: 87, y: 92 }, 10, 0)), 'caret at the end of the struck text');
  assert.equal(strike.type, 'textStrikethrough');
  assert.equal(strike.intent, 'StrikeOutTextEdit');
  assert.equal(strike.inReplyTo, 'k1');
  assert.equal(strike.replyType, 'group');
  assert.equal(strike.groupId, 'k1');
  assert.equal(strike.markedText, 'Teh');
  assert.equal(strike.color, CORRECTION_COLORS.replace);
  const strikeMetId = { ...strike, id: 's1' };
  const pagina = [caret, strikeMetId];
  assert.equal(correctionKind(caret, pagina), 'replace');
  assert.equal(correctionKind(strikeMetId, pagina), 'replaceChild');
  assert.deepEqual(linkPlanForSave(pagina).links, [{ childId: 's1', parentId: 'k1' }], 'saved as one group');
  assert.deepEqual(groupMembers(pagina, strikeMetId).map((a) => a.id), ['k1', 's1']);
  assert.equal(listPreview(caret, pagina), 'Teh -> The');
  assert.equal(makeReplace(m, normalizeRange(m, 0, 3), '', { page: 1, caretId: 'k2' }), null);
});

test('Delete and Backspace strike one character; pressing again extends the strike', () => {
  const m = twee();
  const eerste = strikeStep(m, { start: 4, end: 4 }, 'forward');
  assert.deepEqual(eerste, { start: 4, end: 5 }, "Delete at 4 strikes 'q'");
  const tweede = strikeStep(m, eerste, 'forward');
  assert.deepEqual(tweede, { start: 4, end: 6 }, 'Delete again: one more');
  assert.equal(strikeProps(m, tweede).markedText, 'qu');
  assert.deepEqual(strikeStep(m, tweede, 'backward'), { start: 3, end: 6 }, 'Backspace extends at the start');
  assert.deepEqual(strikeStep(m, { start: 4, end: 4 }, 'backward'), { start: 3, end: 4 }, 'Backspace at 4 strikes the space');
});

test('extending crosses a line break without striking nothing; at the page ends it stops', () => {
  const m = twee();
  assert.deepEqual(strikeStep(m, { start: 8, end: 9 }, 'forward'), { start: 8, end: 11 }, "'k' then 'b' of the next line");
  assert.deepEqual(strikeStep(m, { start: 9, end: 9 }, 'forward'), { start: 10, end: 11 }, 'Delete at a line end');
  assert.deepEqual(strikeStep(m, { start: 10, end: 11 }, 'backward'), { start: 8, end: 11 });
  assert.equal(strikeStep(m, { start: 18, end: 19 }, 'forward'), null, 'nothing after the last character');
  assert.equal(strikeStep(m, { start: 0, end: 2 }, 'backward'), null, 'nothing before the first');
  const tweeRegels = strikeProps(m, { start: 8, end: 11 });
  assert.equal(tweeRegels.rects.length, 2);
  assert.equal(tweeRegels.markedText, 'k b');
});

test('Ctrl+Delete and Ctrl+Backspace strike by word', () => {
  const m = twee();
  assert.deepEqual(strikeStep(m, { start: 4, end: 4 }, 'forward', 'word'), { start: 4, end: 9 }, "'quick' (the line break is dropped)");
  assert.deepEqual(strikeStep(m, { start: 4, end: 9 }, 'forward', 'word'), { start: 4, end: 16 }, "then 'brown' and its space");
  assert.deepEqual(strikeStep(m, { start: 4, end: 4 }, 'backward', 'word'), { start: 0, end: 4 });
});

test('correctionPosition finds an insert at its point and a strike by its rectangles', () => {
  const m = twee();
  assert.equal(correctionPosition(m, { ...makeInsert(m, 13, 'x', { page: 1 }), id: 'a' }).pos, 13);
  const del = makeDelete(m, { start: 8, end: 12 }, { page: 1 });
  assert.deepEqual(correctionPosition(m, del), { pos: 8, range: { start: 8, end: 12 } });
  // Rotated page.
  const r = buildTextModel([item('Abcdef', 100, 200)], { transform: V90 });
  assert.equal(correctionPosition(r, makeInsert(r, 4, 'z', { page: 1 })).pos, 4);
  assert.deepEqual(correctionPosition(r, makeDelete(r, { start: 1, end: 3 }, { page: 1 })).range, { start: 1, end: 3 });
});

test('Tab order: by page, then reading order; Tab and Shift+Tab wrap around', () => {
  const lijst = sortCorrections([
    { id: 'c', page: 2, pos: 5 },
    { id: 'b', page: 1, pos: 30 },
    { id: 'a', page: 1, pos: 4 },
    { id: 'd', page: 2, pos: 5 },
  ]);
  assert.deepEqual(lijst.map((e) => e.id), ['a', 'b', 'c', 'd'], 'same place: original order');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 0 }, 1).id, 'a');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 4 }, 1).id, 'a', 'a correction at the cursor is next');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 4, currentId: 'a' }, 1).id, 'b', 'from the current one: the one after');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 31 }, 1).id, 'c', 'on to the next page');
  assert.equal(nextCorrection(lijst, { page: 3, pos: 0 }, 1).id, 'a', 'wraps to the first');
  assert.equal(nextCorrection(lijst, { page: 2, pos: 5, currentId: 'c' }, -1).id, 'b');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 4 }, -1).id, 'd', 'Shift+Tab before the first wraps to the last');
  assert.equal(nextCorrection(lijst, { page: 1, pos: 10 }, -1).id, 'a');
  assert.equal(nextCorrection([], { page: 1, pos: 0 }, 1), null);
});

test('Esc steps back one level per press: input, selection, mode', () => {
  assert.equal(escapeStep({ inputOpen: true, selection: { anchor: 1, focus: 5 } }), 'closeInput');
  assert.equal(escapeStep({ inputOpen: false, selection: { anchor: 1, focus: 5 } }), 'clearSelection');
  assert.equal(escapeStep({ inputOpen: false, selection: { anchor: 3, focus: 3 } }), 'exitMode');
  assert.equal(escapeStep({}), 'exitMode');
  assert.equal(hasSelection({ anchor: 2, focus: 2 }), false);
  assert.equal(hasSelection({ anchor: 2, focus: 4 }), true);
});

const toets = (key, extra = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...extra });

test('key map: cursor keys, Shift selects, Ctrl moves by word', () => {
  assert.deepEqual(keyCommand(toets('ArrowRight')), { type: 'move', how: 'right', extend: false });
  assert.deepEqual(keyCommand(toets('ArrowLeft', { shiftKey: true })), { type: 'move', how: 'left', extend: true });
  assert.deepEqual(keyCommand(toets('ArrowRight', { ctrlKey: true, shiftKey: true })), { type: 'move', how: 'wordRight', extend: true });
  assert.deepEqual(keyCommand(toets('ArrowLeft', { ctrlKey: true })), { type: 'move', how: 'wordLeft', extend: false });
  assert.deepEqual(keyCommand(toets('ArrowUp')), { type: 'move', how: 'up', extend: false });
  assert.deepEqual(keyCommand(toets('ArrowDown', { shiftKey: true })), { type: 'move', how: 'down', extend: true });
  assert.deepEqual(keyCommand(toets('Home')), { type: 'move', how: 'lineStart', extend: false });
  assert.deepEqual(keyCommand(toets('End', { shiftKey: true })), { type: 'move', how: 'lineEnd', extend: true });
  assert.deepEqual(keyCommand(toets('Home', { ctrlKey: true })), { type: 'move', how: 'docStart', extend: false });
  assert.deepEqual(keyCommand(toets('End', { ctrlKey: true })), { type: 'move', how: 'docEnd', extend: false });
  assert.deepEqual(keyCommand(toets('PageDown')), { type: 'page', dir: 1 });
  assert.deepEqual(keyCommand(toets('PageUp')), { type: 'page', dir: -1 });
});

test('key map: typing, Delete, Tab, Esc and F2', () => {
  assert.deepEqual(keyCommand(toets('h')), { type: 'type', text: 'h' }, 'a tool letter is text in the mode');
  assert.deepEqual(keyCommand(toets('H', { shiftKey: true })), { type: 'type', text: 'H' });
  assert.deepEqual(keyCommand(toets(' ')), { type: 'type', text: ' ' });
  assert.deepEqual(keyCommand(toets('@', { ctrlKey: true, altKey: true })), { type: 'type', text: '@' }, 'AltGr');
  assert.deepEqual(keyCommand(toets('é')), { type: 'type', text: 'é' });
  assert.deepEqual(keyCommand(toets('Delete')), { type: 'strike', dir: 'forward', unit: 'char' });
  assert.deepEqual(keyCommand(toets('Backspace')), { type: 'strike', dir: 'backward', unit: 'char' });
  assert.deepEqual(keyCommand(toets('Delete', { ctrlKey: true })), { type: 'strike', dir: 'forward', unit: 'word' });
  assert.deepEqual(keyCommand(toets('Tab')), { type: 'tab', dir: 1 });
  assert.deepEqual(keyCommand(toets('Tab', { shiftKey: true })), { type: 'tab', dir: -1 });
  assert.deepEqual(keyCommand(toets('Escape')), { type: 'escape' });
  assert.deepEqual(keyCommand(toets('F2')), { type: 'toggle' });
  assert.deepEqual(keyCommand(toets('a', { ctrlKey: true })), { type: 'selectAll' });
  assert.deepEqual(keyCommand(toets('c', { ctrlKey: true })), { type: 'copy' });
  assert.deepEqual(keyCommand(toets('v', { ctrlKey: true })), { type: 'paste' });
  assert.deepEqual(keyCommand(toets('x', { ctrlKey: true })), { type: 'swallow' }, 'no annotation cut');
  assert.deepEqual(keyCommand(toets('Enter')), { type: 'swallow' });
  assert.deepEqual(keyCommand(toets('Insert')), { type: 'swallow' });
});

test('key map: app shortcuts with Ctrl, Alt and function keys pass through', () => {
  for (const e of [
    toets('z', { ctrlKey: true }), toets('y', { ctrlKey: true }), toets('s', { ctrlKey: true }),
    toets('Z', { ctrlKey: true, shiftKey: true }), toets('f', { metaKey: true }), toets('h', { altKey: true }),
    toets('F3'), toets('Shift', { shiftKey: true }), toets('Control', { ctrlKey: true }), toets('Tab', { ctrlKey: true }),
  ]) {
    assert.equal(keyCommand(e), null, JSON.stringify(e));
  }
  // Every plain printable key is caught, so no tool shortcut can fire.
  for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789-=[];\',./`') {
    assert.equal(keyCommand(toets(ch)).type, 'type', ch);
  }
});

test('key map with the inline input open: Enter commits, Esc closes, Tab commits and jumps, the rest types', () => {
  const open = { inputOpen: true };
  assert.deepEqual(keyCommand(toets('Enter'), open), { type: 'commit' });
  assert.deepEqual(keyCommand(toets('Escape'), open), { type: 'escape' });
  assert.deepEqual(keyCommand(toets('Tab'), open), { type: 'commitAndTab', dir: 1 });
  assert.deepEqual(keyCommand(toets('Tab', { shiftKey: true }), open), { type: 'commitAndTab', dir: -1 });
  assert.deepEqual(keyCommand(toets('F2'), open), { type: 'toggle' });
  for (const e of [toets('h'), toets('Backspace'), toets('ArrowLeft'), toets('Delete'), toets('z', { ctrlKey: true }), toets('a', { ctrlKey: true })]) {
    assert.deepEqual(keyCommand(e, open), { type: 'input' }, JSON.stringify(e));
  }
});
