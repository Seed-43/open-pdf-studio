import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, degrees } from 'pdf-lib';
import { findReferences, validateIndex, textReferenceRect, relativePath, writeLinks } from './model.js';

const index = [{ id: 'a', path: 'a.pdf', page: 1, label: 'A-101', region: null }, { id: 'b', path: 'sub/b.pdf', page: 1, label: 'B-201', region: [0, 0, 100, 100] }];
test('explicit labels, ambiguous/missing references and literal prefixes', () => {
  const rows = validateIndex(index);
  assert.deepEqual(findReferences('See A-101 and B-201; not XA-101.', rows).map(r => r.label), ['A-101', 'B-201']);
  assert.equal(findReferences('A-101', [...rows, { ...rows[0], id: 'duplicate' }])[0].status, 'ambiguous');
  assert.equal(findReferences('SHEET M-999', rows, { prefix: 'SHEET ' })[0].status, 'missing');
  assert.equal(findReferences('sheet a-101', rows, { prefix: 'SHEET ' })[0].targets[0], 'a');
  assert.equal(relativePath('plans/a.pdf', 'details/b.pdf'), '../details/b.pdf');
  assert.throws(() => validateIndex([{ ...rows[0], path: '../x.pdf' }]));
  assert.deepEqual(textReferenceRect({ str: 'ABC DEF', width: 70, height: 10, transform: [10, 0, 0, 10, 20, 30] }, 4, 7), [60, 30, 90, 40]);
});
test('standard remote/local links preserve annotations and are idempotent across new index ids', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]).setRotation(degrees(90));
  const original = await pdf.save();
  const links = [{ page: 1, rect: [20, 30, 80, 40], target: index[1] }, { page: 2, rect: [20, 30, 80, 40], target: { ...index[0], page: 1 } }];
  const first = await writeLinks(original, 'a.pdf', links);
  assert.equal(first.added, 2);
  const loaded = await PDFDocument.load(first.bytes),
    ann = loaded.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0);
  assert.equal(ann.lookup(PDFName.of('A')).get(PDFName.of('S')).toString(), '/GoToR');
  assert.equal(ann.lookup(PDFName.of('A')).lookup(PDFName.of('F')).get(PDFName.of('UF')).decodeText(), 'sub/b.pdf');
  const again = await writeLinks(first.bytes, 'a.pdf', links.map(l => ({ ...l, target: { ...l.target, id: 'new-id' } })));
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.deepEqual(again.bytes, first.bytes);
  const changed = [{ ...links[0], target: { ...index[1], page: 2 } }];
  const preserve = await writeLinks(first.bytes, 'a.pdf', changed);
  assert.equal(preserve.skipped, 1);
  assert.equal(preserve.added, 0);
  const replace = await writeLinks(first.bytes, 'a.pdf', changed, { replaceExisting: true });
  assert.equal(replace.replaced, 1);
  assert.equal(replace.added, 1);
  assert.equal((await PDFDocument.load(replace.bytes)).getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size(), 1);
});
