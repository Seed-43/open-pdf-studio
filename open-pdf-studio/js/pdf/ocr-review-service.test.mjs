// The OCR review service: a correction the OCR font cannot show, or accepting
// such a recognized text, is refused in the dialog, before it reaches the
// document (the save would refuse it, #657); stored compact reviews are
// listed read-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const FONT = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
let fontAvailable = false;
globalThis.__TAURI__ = {
  path: { resourceDir: async () => 'C:/app/resources', join: async (...parts) => parts.join('/') },
  core: { invoke: async () => undefined },
  fs: {
    readFile: async (path) => {
      if (!fontAvailable) throw new Error(`failed to open file at path: ${path}`);
      return new Uint8Array(FONT);
    },
  },
};

const { state } = await import('../core/state.js');
const { listOcrReview, updateOcrReview } = await import('./ocr-review-service.js');
const { writeOcrReview } = await import('./ocr-review.js');

const word = (text, confidence = 20) => ({ text, confidence, left: 10, top: 10, width: 40, height: 12 });

async function openDocument(document = {}, bytes = null) {
  const data = bytes || await (await PDFDocument.create()).save();
  const pdfDoc = { getData: async () => data, numPages: 1 };
  state.documents = [{
    id: 'review', filePath: 'C:/ocr/review.pdf', pdfDoc, annotations: [], textEdits: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, ocrResults: {}, ...document,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

const request = (doc, extra) => ({
  documentId: doc.id, revision: doc.inhoudRevisie || 0, page: 1, index: 0, expectedText: 'room', ...extra,
});

test('without the OCR font the encodability check is skipped', async () => {
  const doc = await openDocument({ ocrResults: { 1: [word('room')] } });
  await updateOcrReview(request(doc, { action: 'correct', text: 'room 🙂' }));
  assert.equal(state.documents[0].ocrResults[1][0].text, 'room 🙂');
});

test('a correction with a glyph the OCR font lacks is refused and changes nothing', async () => {
  fontAvailable = true;
  const doc = await openDocument({ ocrResults: { 1: [word('room')] } });
  await assert.rejects(
    updateOcrReview(request(doc, { action: 'correct', text: 'room 🙂' })),
    (err) => err.message === 'OCR_REVIEW_TEXT_NOT_ENCODABLE' && err.characters.join('') === '🙂',
  );
  assert.equal(state.documents[0].ocrResults[1][0].text, 'room');
  assert.equal(state.documents[0].ocrResults[1][0].review, undefined);
  await updateOcrReview(request(doc, { action: 'correct', text: 'rooms' }));
  assert.equal(state.documents[0].ocrResults[1][0].text, 'rooms');
});

test('accepting a recognized text with a glyph the OCR font lacks is refused and changes nothing', async () => {
  fontAvailable = true;
  const doc = await openDocument({ ocrResults: { 1: [word('房間'), word('room')] } });
  await assert.rejects(
    updateOcrReview(request(doc, { action: 'accept', expectedText: '房間' })),
    (err) => err.message === 'OCR_REVIEW_TEXT_NOT_ENCODABLE' && err.characters.join('') === '房間',
  );
  assert.equal(state.documents[0].ocrResults[1][0].review, undefined);
  assert.equal(state.documents[0].undoStack.length, 0);
  await updateOcrReview(request(doc, { action: 'accept', index: 1 }));
  assert.equal(state.documents[0].ocrResults[1][1].review.status, 'accepted');
});

test('compact reviews stored in the file are listed as archived and cannot be changed', async () => {
  const pdf = await PDFDocument.create();
  writeOcrReview(pdf.addPage(), [word('plain', 99), { ...word('kept', 30), review: { status: 'accepted', originalText: 'kept' } }]);
  const doc = await openDocument({}, await pdf.save());
  const listed = await listOcrReview(doc.id, 80);
  assert.equal(listed.total, 1);
  assert.equal(listed.words[0].archived, true);
  assert.equal(listed.words[0].index, 1);
  assert.deepEqual(state.documents[0].ocrResults, {}, 'partial reviews never become OCR results');
  await assert.rejects(
    updateOcrReview(request(doc, { action: 'accept', index: 1, expectedText: 'kept' })),
    /OCR_WORD_NOT_FOUND/,
  );
});
