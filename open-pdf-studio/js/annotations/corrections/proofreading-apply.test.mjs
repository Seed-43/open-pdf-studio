// Proofreading mode (#508, part 2) in the real app modules: corrections land
// in the document through createAnnotation and the undo manager, every
// correction is one undo step, and a strike-through that grows with repeated
// Delete presses stays that one step.
//
// The modules run under node with the app's load hooks (core/app-test-hooks.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const undo = await import('../../core/undo-manager.js');
const { buildTextModel } = await import('./text-model.js');
const { applyInsert, applyReplace, applyStrike } = await import('./proofreading-apply.js');
const { correctionKind, linkPlanForSave, CORRECTION_COLORS } = await import('./model.js');

const V0 = [1, 0, 0, -1, 0, 792];
const item = (str, x, y, extra = {}) => ({
  str, dir: 'ltr', width: str.length * 5, height: 10, transform: [10, 0, 0, 10, x, y], hasEOL: false, ...extra,
});
// 'Teh quick' (0..9) | 'brown fox' (10..19)
const model = buildTextModel([item('Teh quick', 72, 700, { hasEOL: true }), item('brown fox', 72, 686)], { transform: V0 });

function openen() {
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}
const doc = () => state.documents[0];

test('an insert is one caret and one undo step', async () => {
  openen();
  const ann = applyInsert(doc(), model, 1, 3, 'x');
  assert.equal(ann.type, 'caret');
  assert.equal(ann.text, 'x');
  assert.equal(ann.author, state.defaultAuthor, 'author as for every new annotation');
  assert.equal(doc().annotations.length, 1);
  assert.equal(doc().undoStack.length, 1);
  assert.equal(doc().modified, true);
  await undo.undo();
  assert.equal(doc().annotations.length, 0);
  await undo.redo();
  assert.equal(doc().annotations[0].text, 'x');
});

test('a replace is a linked caret and strike in one undo step', async () => {
  openen();
  const { caret, strike } = applyReplace(doc(), model, 1, { start: 0, end: 3 }, 'The');
  assert.equal(doc().undoStack.length, 1);
  assert.equal(doc().undoStack[0].type, 'bulkAdd');
  assert.deepEqual(doc().annotations.map((a) => a.id), [strike.id, caret.id], 'the strike below its caret');
  assert.equal(correctionKind(caret, doc().annotations), 'replace');
  assert.equal(correctionKind(strike, doc().annotations), 'replaceChild');
  assert.equal(strike.inReplyTo, caret.id);
  assert.equal(strike.groupId, caret.id);
  assert.equal(caret.groupId, caret.id);
  assert.deepEqual(linkPlanForSave(doc().annotations).links, [{ childId: strike.id, parentId: caret.id }]);
  await undo.undo();
  assert.equal(doc().annotations.length, 0, 'both halves gone');
  await undo.redo();
  assert.equal(doc().annotations.length, 2);
  assert.equal(correctionKind(doc().annotations.find((a) => a.type === 'textStrikethrough'), doc().annotations), 'replaceChild');
});

test('Delete twice: one strike that grows, still one undo step', async () => {
  openen();
  const een = applyStrike(doc(), model, 1, { cursor: 4, dir: 'forward' });
  assert.equal(een.cursor, 5);
  assert.deepEqual(een.last, { id: een.annotation.id, page: 1, start: 4, end: 5 });
  assert.equal(een.annotation.markedText, 'q');
  assert.equal(een.annotation.color, CORRECTION_COLORS.delete);
  const twee = applyStrike(doc(), model, 1, { cursor: een.cursor, last: een.last, dir: 'forward' });
  assert.equal(twee.annotation.id, een.annotation.id, 'the same annotation');
  assert.equal(twee.cursor, 6);
  assert.equal(doc().annotations.length, 1);
  assert.equal(doc().annotations[0].markedText, 'qu');
  assert.equal(doc().annotations[0].rects.length, 1);
  assert.equal(doc().undoStack.length, 1, 'one step');
  assert.equal(doc().undoStack[0].annotation.markedText, 'qu', 'the step holds the grown strike');
  const terug = applyStrike(doc(), model, 1, { cursor: twee.cursor, last: twee.last, dir: 'backward' });
  assert.equal(terug.annotation.markedText, ' qu', 'Backspace extends at the start');
  assert.equal(terug.cursor, 3);
  assert.equal(doc().undoStack.length, 1);
  await undo.undo();
  assert.equal(doc().annotations.length, 0, 'one undo removes the whole strike');
  await undo.redo();
  assert.equal(doc().annotations[0].markedText, ' qu');
});

test('after a save the growth is its own step, so undo goes back to the saved state', async () => {
  openen();
  const een = applyStrike(doc(), model, 1, { cursor: 4, dir: 'forward' });
  doc().savedUndoStackLength = doc().undoStack.length;
  doc().modified = false;
  applyStrike(doc(), model, 1, { cursor: een.cursor, last: een.last, dir: 'forward' });
  assert.equal(doc().undoStack.length, 2);
  assert.equal(doc().undoStack[1].type, 'modifyAnnotation');
  await undo.undo();
  assert.equal(doc().annotations[0].markedText, 'q');
  assert.equal(doc().modified, false);
});

test('a strike over a selection, a stale last strike and a cursor elsewhere start a new strike', async () => {
  openen();
  const sel = applyStrike(doc(), model, 1, { cursor: 7, selection: { anchor: 7, focus: 2 }, dir: 'forward' });
  assert.equal(sel.annotation.markedText, 'h qui');
  assert.equal(sel.cursor, 7);
  const ander = applyStrike(doc(), model, 1, { cursor: 12, last: sel.last, dir: 'forward' });
  assert.notEqual(ander.annotation.id, sel.annotation.id, 'cursor not at the last strike: a new one');
  assert.equal(ander.annotation.markedText, 'o');
  await undo.undo();
  const verlopen = applyStrike(doc(), model, 1, { cursor: 13, last: ander.last, dir: 'forward' });
  assert.notEqual(verlopen.annotation.id, ander.annotation.id, 'the last strike was undone: a new one');
  assert.equal(doc().annotations.length, 2);
  assert.equal(applyStrike(doc(), model, 1, { cursor: 19, dir: 'forward' }).annotation, null, 'nothing after the end');
  assert.equal(doc().undoStack.length, 2, 'no step for nothing');
});

test('the inserted text is never empty and nothing is added without a model position', () => {
  openen();
  assert.equal(applyInsert(doc(), model, 1, 3, ''), null);
  assert.equal(applyReplace(doc(), model, 1, { start: 9, end: 10 }, 'x'), null, 'only a line break');
  assert.equal(doc().annotations.length, 0);
  assert.equal(doc().undoStack.length, 0);
});
