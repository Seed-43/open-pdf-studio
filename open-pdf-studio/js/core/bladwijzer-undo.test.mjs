// Eén undo-stap voor een wijziging aan meerdere bladwijzers (#689 stijl op een
// selectie, #690 verplaatsen/nesten): de hele lijst ervoor en erna. Met de
// echte state-store en undo-manager (zie ./app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('./state.ts');
const undo = await import('./undo-manager.js');

const kloon = (x) => JSON.parse(JSON.stringify(x));
const bm = (id, parentId, sortOrder, extra = {}) => ({
  id, title: id, page: 1, parentId, sortOrder, expanded: true, bold: false, italic: false, color: null, ...extra,
});

function openen(bookmarks) {
  state.documents = [{
    id: 'doc-bm', filePath: null, pdfDoc: { numPages: 3 }, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks, pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('setBookmarks: één Ctrl+Z zet de hele lijst terug, Ctrl+Y weer vooruit', async () => {
  const voor = [bm('a', null, 0), bm('b', null, 1), bm('c', null, 2)];
  const doc = openen(kloon(voor));
  // Kleur op twee bladwijzers en c onder a: in één keer, zoals de app het doet.
  const na = [bm('a', null, 0, { color: '#e81123' }), bm('b', null, 1, { color: '#e81123', bold: true }), bm('c', 'a', 0)];
  doc.bookmarks = kloon(na);
  undo.recordBookmarksChange(voor, na);
  assert.equal(doc.undoStack.length, 1, 'één stap');

  await undo.undo();
  assert.deepEqual(kloon(state.documents[0].bookmarks), voor);
  await undo.redo();
  assert.deepEqual(kloon(state.documents[0].bookmarks), na);
});

test('setBookmarks bewaart kopieën: latere wijzigingen lekken niet in de stap', async () => {
  const voor = [bm('a', null, 0)];
  const na = [bm('a', null, 0, { italic: true })];
  const doc = openen(kloon(na));
  undo.recordBookmarksChange(voor, na);
  voor[0].title = 'gewijzigd';
  na[0].title = 'ook gewijzigd';
  await undo.undo();
  assert.equal(state.documents[0].bookmarks[0].title, 'a');
  assert.equal(state.documents[0].bookmarks[0].italic, false);
  await undo.redo();
  assert.equal(state.documents[0].bookmarks[0].title, 'a');
  assert.equal(state.documents[0].bookmarks[0].italic, true);
  assert.equal(doc.undoStack.length, 1);
});
