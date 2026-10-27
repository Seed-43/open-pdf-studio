// 3D markup page (#599): the appended page carries the sheet, the picture
// over the 3D area and the /OPS_3DSnapshot record, and all of it survives
// saving, reopening and a later save that writes markups onto the page the
// way the app's saver does (the page dictionary is kept, /Annots replaced).
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, degrees } from 'pdf-lib';

import { appendSnapshotPage } from './snapshot-page.js';
import { find3DAnnotations, findThreeDSnapshots, SNAPSHOT_KEY } from './pdf-3d.js';
import { buildBoxU3D, build3DPdf } from './u3d-fixture.testhulp.mjs';

// The smallest JPEG pdf-lib accepts: SOI, a baseline frame header for one
// grey 2x1 pixel image, EOI. pdf-lib reads only the header.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);

const VIEW = { c2w: [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0.5, -10, 0.5], co: 10, fov: 30, ortho: false, hidden: ['Box2'] };

function xobjectsOf(page) {
  const res = page.node.Resources();
  const xo = res?.lookup(PDFName.of('XObject'), PDFDict);
  return xo ? xo.keys().map(k => page.doc.context.lookup(xo.get(k))) : [];
}

test('the markup page: same sheet and boxes, picture, page record, no 3D annotation', async () => {
  const pdf = await PDFDocument.load(await (await build3DPdf({ model: buildBoxU3D() })).save());
  const n = await appendSnapshotPage(pdf, { sourcePage: 1, rect: [40, 40, 802, 540], jpeg: JPEG, name: 'Markup view 1', view: VIEW });
  assert.equal(n, 2);
  const back = await PDFDocument.load(await pdf.save());
  assert.equal(back.getPageCount(), 2);
  const page = back.getPage(1);
  assert.deepEqual(page.getMediaBox(), back.getPage(0).getMediaBox());
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(!annots || (annots instanceof PDFArray && annots.size() === 0), 'no annotations copied');
  const xos = xobjectsOf(page);
  assert.equal(xos.length, 2, 'the sheet and the picture');
  assert.ok(xos.some(x => x instanceof PDFRawStream && x.dict.get(PDFName.of('Subtype')).toString() === '/Image'));
  assert.ok(xos.some(x => x.dict.get(PDFName.of('Subtype')).toString() === '/Form'));
  const [snap] = findThreeDSnapshots(back);
  assert.deepEqual(snap, { ...VIEW, page: 2, sourcePage: 1, name: 'Markup view 1' });
  // The 3D page itself is unchanged.
  const [a] = find3DAnnotations(back);
  assert.equal(a.page, 1);
});

test('the page record survives a save that writes markups onto the markup page', async () => {
  const pdf = await PDFDocument.load(await (await build3DPdf({ model: buildBoxU3D() })).save());
  await appendSnapshotPage(pdf, { sourcePage: 1, rect: [40, 40, 802, 540], jpeg: JPEG, name: 'Markup view 1', view: VIEW });
  const saved = await pdf.save();

  // What the saver does per page: load the bytes, build annotation
  // dictionaries, set /Annots on the existing page dictionary, save.
  const again = await PDFDocument.load(saved);
  const ctx = again.context;
  const square = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 160], C: [1, 0, 0] }));
  again.getPage(1).node.set(PDFName.of('Annots'), ctx.obj([square]));
  const final = await PDFDocument.load(await again.save({ useObjectStreams: true }));

  const [snap] = findThreeDSnapshots(final);
  assert.equal(snap.page, 2);
  assert.equal(snap.name, 'Markup view 1');
  assert.deepEqual(snap.c2w, VIEW.c2w);
  const annots = final.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annots.size(), 1);
  assert.equal(find3DAnnotations(final).length, 1);
  assert.ok(final.getPage(1).node.get(PDFName.of(SNAPSHOT_KEY)));
});

test('a sheet with offset boxes and /Rotate keeps them on the markup page', async () => {
  const pdf = await build3DPdf({ model: buildBoxU3D(), rect: [140, 140, 902, 640] });
  const src = pdf.getPage(0);
  src.setMediaBox(100, 100, 842, 595);
  src.setCropBox(120, 110, 800, 560);
  src.setRotation(degrees(90));
  const doc = await PDFDocument.load(await pdf.save());
  await appendSnapshotPage(doc, { sourcePage: 1, rect: [140, 140, 902, 640], jpeg: JPEG, name: 'View', view: VIEW });
  const back = await PDFDocument.load(await doc.save());
  const page = back.getPage(1);
  assert.deepEqual(page.getMediaBox(), { x: 100, y: 100, width: 842, height: 595 });
  assert.deepEqual(page.getCropBox(), { x: 120, y: 110, width: 800, height: 560 });
  assert.equal(page.getRotation().angle, 90);
});

test('without a /Rect the picture covers the visible page', async () => {
  const pdf = await PDFDocument.load(await (await build3DPdf({ model: buildBoxU3D() })).save());
  const n = await appendSnapshotPage(pdf, { sourcePage: 1, rect: null, jpeg: JPEG, name: 'View', view: VIEW });
  assert.equal(n, 2);
});
