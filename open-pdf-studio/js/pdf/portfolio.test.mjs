import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import { inspectPortfolio, changePortfolio, extractComponent } from './portfolio.js';

const n = PDFName.of;

async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}
test('create nested collection, preserve binary data and Unicode descriptions through changes', async () => {
  const blob = new Uint8Array([0, 255, 1, 13, 10, 0, 42]);
  let result = await changePortfolio(await source(), {
    folders: [{ name: 'Project', parentId: 0 }, { name: 'Plans', parentId: 1 }],
    add: [{ name: 'data.bin', bytes: blob, folderId: 2, description: '日本語 – Δ' }]
  });
  assert.equal(result.portfolio.folders.length, 3);
  assert.equal(result.portfolio.items[0].folderId, 2);
  let pdf = await PDFDocument.load(result.bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(extractComponent(pdf, '<2>data.bin'), blob);
  assert.equal(pdf.catalog.lookup(n('Extensions')).lookup(n('ADBE')).lookup(n('ExtensionLevel')).asNumber(), 3);
  result = await changePortfolio(result.bytes, {
    add: [{ name: 'extra.txt', bytes: new TextEncoder().encode('extra'), folderId: 1 }],
    descriptions: [{ key: '<2>data.bin', description: 'Verified' }]
  });
  result = await changePortfolio(result.bytes, { remove: ['<1>extra.txt'] });
  pdf = await PDFDocument.load(result.bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(extractComponent(pdf, '<2>data.bin'), blob);
  assert.equal(inspectPortfolio(pdf).items[0].description, 'Verified');
});
test('retain schema, sort, collection item metadata and original file stream', async () => {
  const result = await changePortfolio(await source(), { add: [{ name: 'a.txt', bytes: new Uint8Array([7, 8]) }] });
  const pdf = await PDFDocument.load(result.bytes),
    collection = pdf.catalog.lookup(n('Collection'));
  collection.set(n('Schema'), pdf.context.obj({ Type: 'CollectionSchema', Status: { Subtype: 'S', N: PDFHexString.fromText('Status'), O: 0 } }));
  collection.set(n('Sort'), pdf.context.obj({ S: 'Status', A: false }));
  collection.set(n('D'), PDFHexString.fromText('a.txt'));
  const names = pdf.catalog.lookup(n('Names')).lookup(n('EmbeddedFiles')).lookup(n('Names'));
  const spec = names.lookup(1);
  spec.set(n('CI'), pdf.context.obj({ Type: 'CollectionItem', Status: PDFHexString.fromText('Approved') }));
  const schema = collection.lookup(n('Schema')).toString(),
    sort = collection.lookup(n('Sort')).toString(),
    ci = spec.lookup(n('CI')).toString(),
    stream = spec.lookup(n('EF')).lookup(n('F')).toString();
  const changed = await changePortfolio(await pdf.save(), {
    descriptions: [{ key: 'a.txt', description: 'new' }],
    add: [{ name: 'b.txt', bytes: new Uint8Array([9]) }]
  });
  const again = await PDFDocument.load(changed.bytes),
    c = again.catalog.lookup(n('Collection')),
    a = again.catalog.lookup(n('Names')).lookup(n('EmbeddedFiles')).lookup(n('Names')).lookup(1);
  assert.equal(c.lookup(n('Schema')).toString(), schema);
  assert.equal(c.lookup(n('Sort')).toString(), sort);
  assert.equal(a.lookup(n('CI')).toString(), ci);
  assert.equal(a.lookup(n('EF')).lookup(n('F')).toString(), stream);
  const removed = await changePortfolio(changed.bytes, { remove: ['a.txt'] });
  assert.equal((await PDFDocument.load(removed.bytes)).catalog.lookup(n('Collection')).has(n('D')), false);
});
test('reject invalid folders, duplicate components and unsafe names without mutating input', async () => {
  const bytes = await source(),
    copy = bytes.slice();
  await assert.rejects(changePortfolio(bytes, { add: [{ name: '../secret', bytes: new Uint8Array() }] }), /INVALID_NAME/);
  await assert.rejects(changePortfolio(bytes, { folders: [{ parentId: 55, name: 'Bad' }] }), /FOLDER_NOT_FOUND/);
  await assert.rejects(changePortfolio(bytes, { add: [{ name: 'a', bytes: new Uint8Array() }, { name: 'a', bytes: new Uint8Array() }] }), /DUPLICATE_COMPONENT/);
  assert.deepEqual(bytes, copy);
  const pdf = await PDFDocument.load((await changePortfolio(bytes, { folders: [{ name: 'A', parentId: 0 }] })).bytes);
  const root = pdf.catalog.lookup(n('Collection')).lookup(n('Folders'));
  root.set(n('Next'), pdf.context.getObjectRef(root));
  assert.throws(() => inspectPortfolio(pdf), /INVALID_FOLDER_TREE/);
});
test('shared embedded stream survives removal of one component', async () => {
  let result = await changePortfolio(await source(), { add: [{ name: 'a', bytes: new Uint8Array([1, 2, 3]) }, { name: 'b', bytes: new Uint8Array([1, 2, 3]) }] });
  const pdf = await PDFDocument.load(result.bytes),
    names = pdf.catalog.lookup(n('Names')).lookup(n('EmbeddedFiles')).lookup(n('Names'));
  names.lookup(3).set(n('EF'), names.lookup(1).lookup(n('EF')));
  result = await changePortfolio(await pdf.save(), { remove: ['a'] });
  assert.deepEqual(extractComponent(await PDFDocument.load(result.bytes), 'b'), new Uint8Array([1, 2, 3]));
});
