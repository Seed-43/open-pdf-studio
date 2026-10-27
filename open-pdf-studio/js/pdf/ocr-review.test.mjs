import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PDFDocument, PDFName, PDFArray, PDFBool, StandardFonts, degrees, decodePDFRawStream,
} from 'pdf-lib';
import {
  reviewQueue, reviewWord, readOcrReview, writeOcrReview, validOcrWords, unencodableCharacters,
  archivedReviewQueue,
} from './ocr-review.js';
import { pdfTextString } from './saver/pdf-text.js';
import { writeOcrTextLayer, embedOcrFont } from './saver/ocr-text-layer.js';

const word = (text, confidence) => ({ text, confidence, left: 30, top: 40, width: 50, height: 12 });

function ownedStreams(pdf, page) {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => pdf.context.lookup(ref))
    .filter((stream) => stream.dict.get(PDFName.of('OPS_OCRLayer')) === PDFBool.True);
}

test('unknown and low confidence sort first; mixed-language and numeric corrections preserve confidence', () => {
  const results = { 2: [word('房間', 50), word('123,45', 90)], 1: [word('unavailable', undefined), word('foo', 10)] };
  assert.deepEqual(reviewQueue(results).map((w) => w.text), ['unavailable', 'foo', '房間']);
  const changed = reviewWord(word('12B', 20), { action: 'correct', text: '128', expectedText: '12B' });
  assert.equal(changed.confidence, 20);
  assert.equal(changed.review.originalText, '12B');
  assert.throws(() => reviewWord(changed, { action: 'accept', expectedText: '12B' }), /STALE/);
});

test('invalid words are skipped without shifting the index of the others', () => {
  const results = {
    1: [{ ...word('empty', 10), width: 0 }, { ...word('nan', 10), left: NaN }, word('x'.repeat(2001), 10), word('kept', 10)],
  };
  const queue = reviewQueue(results);
  assert.deepEqual(queue.map((w) => [w.text, w.index]), [['kept', 3]]);
  assert.deepEqual(validOcrWords(results[1]).map((w) => w.text), ['kept']);
  assert.deepEqual(validOcrWords('not a list'), []);
});

test('verified text layer replaces only owned OCR, retains artwork and rotation, and reopens once', async () => {
  let pdf = await PDFDocument.create();
  let page = pdf.addPage([300, 400]);
  page.setRotation(degrees(90));
  page.drawText('VISIBLE ORIGINAL');
  let font = await pdf.embedFont(StandardFonts.Helvetica);
  writeOcrTextLayer(page, [word('Wrong', 12)], font);
  pdf = await PDFDocument.load(await pdf.save());
  page = pdf.getPage(0);
  assert.equal(page.node.get(PDFName.of('OPS_OCRReview')), undefined, 'no reviews, no review metadata');
  font = await pdf.embedFont(StandardFonts.Helvetica);
  const corrected = reviewWord(word('Wrong', 12), { action: 'correct', text: 'Correct 123.45', expectedText: 'Wrong' });
  writeOcrTextLayer(page, [corrected], font);
  pdf = await PDFDocument.load(await pdf.save());
  page = pdf.getPage(0);
  assert.equal(ownedStreams(pdf, page).length, 1);
  const contents = page.node.Contents();
  const all = (contents instanceof PDFArray ? contents.asArray() : [contents]).map((ref) => pdf.context.lookup(ref));
  const text = all.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');
  assert.ok(text.includes('3 Tr'));
  assert.ok(text.includes('436F7272656374203132332E3435'));
  assert.ok(!text.includes('57726F6E67'));
  assert.equal(page.getRotation().angle, 90);
  const stored = readOcrReview(pdf).reviewsOnly[1][0];
  assert.equal(stored.review.status, 'corrected');
  assert.equal(stored.text, 'Correct 123.45');
  assert.equal(stored.review.originalText, 'Wrong');
  assert.equal(stored.index, 0);
});

test('Unicode review metadata roundtrips without inventing confidence', async () => {
  let pdf = await PDFDocument.create();
  const page = pdf.addPage();
  writeOcrReview(page, [{ ...word('日本語 ١٢٣', undefined), review: { status: 'accepted', originalText: '日本語 ١٢٣' } }]);
  pdf = await PDFDocument.load(await pdf.save());
  const restored = readOcrReview(pdf).reviewsOnly[1][0];
  assert.equal(restored.text, '日本語 ١٢٣');
  assert.equal(restored.confidence, null);
});

test('review metadata stores only the reviewed words, the original text only where it differs', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const accepted = { ...word('same', 40), review: { status: 'accepted', originalText: 'same' } };
  writeOcrReview(page, [word('plain', 99), accepted]);
  const raw = page.node.lookup(PDFName.of('OPS_OCRReview')).decodeText();
  const data = JSON.parse(raw);
  assert.equal(data.version, 2);
  assert.deepEqual(data.reviews.map((r) => r.index), [1]);
  assert.equal('originalText' in data.reviews[0], false);
  assert.ok(!raw.includes('plain'));
  writeOcrReview(page, [word('plain', 99)]);
  assert.equal(page.node.get(PDFName.of('OPS_OCRReview')), undefined, 'no reviews left: metadata removed');
});

test('files with the old full review form still load as complete OCR results', async () => {
  let pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const words = [word('one', 90), { ...word('two', 20), review: { status: 'corrected', originalText: 'tw0' } }];
  page.node.set(PDFName.of('OPS_OCRReview'), pdfTextString(JSON.stringify({ version: 1, words })));
  pdf = await PDFDocument.load(await pdf.save());
  const { complete, reviewsOnly } = readOcrReview(pdf);
  assert.deepEqual(complete[1].map((w) => w.text), ['one', 'two']);
  assert.equal(complete[1][1].review.originalText, 'tw0');
  assert.deepEqual(reviewsOnly, {});
});

test('stored reviews without full results are listed as archived', () => {
  const archive = { 1: [{ ...word('kept', 30), index: 4, review: { status: 'accepted', originalText: 'kept' } }], 2: [] };
  const queue = archivedReviewQueue(archive, {});
  assert.equal(queue.length, 1);
  assert.equal(queue[0].archived, true);
  assert.equal(queue[0].page, 1);
  assert.deepEqual(archivedReviewQueue(archive, { 1: [word('new', 10)] }), [], 'fresh OCR results replace the archive');
});

test('unencodable characters are reported once each, whitespace never', () => {
  const codePoints = new Set([...'room'].map((ch) => ch.codePointAt(0)));
  assert.deepEqual(unencodableCharacters('room 🙂🙂 房', codePoints), ['🙂', '房']);
  assert.deepEqual(unencodableCharacters('room room', codePoints), []);
});

test('a reviewed glyph outside font coverage fails instead of silently becoming notdef', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const before = page.node.get(PDFName.of('Contents'));
  const fontBytes = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
  const font = await embedOcrFont(pdf, fontBytes);
  const corrected = reviewWord(word('room', 10), { action: 'correct', expectedText: 'room', text: '房間' });
  assert.throws(() => writeOcrTextLayer(page, [corrected], font), /OCR_REVIEW_TEXT_NOT_ENCODABLE/);
  assert.equal(page.node.get(PDFName.of('Contents')), before, 'the page is unchanged');
});

test('without strict reviews (recovery snapshot) the word is left out and the correction stays in the metadata', async () => {
  let pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const fontBytes = readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
  const font = await embedOcrFont(pdf, fontBytes);
  const corrected = reviewWord(word('room', 10), { action: 'correct', expectedText: 'room', text: '房間' });
  const warnings = [];
  const old = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.doesNotThrow(() => writeOcrTextLayer(page, [corrected, word('wall', 12)], font, { strictReviews: false }));
  } finally {
    console.warn = old;
  }
  assert.equal(warnings.length, 1);
  pdf = await PDFDocument.load(await pdf.save());
  const [stream] = ownedStreams(pdf, pdf.getPage(0));
  const text = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.equal((text.match(/Tj/g) || []).length, 1, 'only the unreviewed word is in the layer');
  assert.equal(readOcrReview(pdf).reviewsOnly[1][0].text, '房間', 'the correction stays in the metadata');
});
