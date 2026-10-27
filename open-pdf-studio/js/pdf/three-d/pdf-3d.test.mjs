// 3D annotations in a PDF (#599): finding them, their views and default
// view, the model stream (also behind a /3DRef), PRC models, and the
// /OPS_3DSnapshot page record of 3D markup pages.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

import { find3DAnnotations, findThreeDSnapshots, parseSnapshotRecord, SNAPSHOT_KEY } from './pdf-3d.js';
import { readU3D } from './u3d-reader.js';
import { buildBoxU3D, build3DPdf } from './u3d-fixture.testhulp.mjs';

const C2W_FRONT = [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0.5, -10, 0.5];
const C2W_TOP = [-1, 0, 0, 0, 1, 0, 0, 0, -1, 0.5, 0.5, 10];

async function reload(pdf) {
  return PDFDocument.load(await pdf.save());
}

test('finds the 3D annotation with its views, rectangle and model stream', async () => {
  const model = buildBoxU3D();
  const pdf = await reload(await build3DPdf({
    model,
    views: [
      { name: 'Front', c2w: C2W_FRONT, co: 10, fov: 40, ps: 'H' },
      { name: 'Top', c2w: C2W_TOP, ortho: true },
    ],
    dv: 1,
  }));
  const [a, ...rest] = find3DAnnotations(pdf);
  assert.equal(rest.length, 0);
  assert.equal(a.page, 1);
  assert.deepEqual(a.rect, [40, 40, 802, 540]);
  assert.equal(a.subtype, 'U3D');
  assert.equal(a.defaultView, 1);
  assert.deepEqual(a.views.map(v => [v.name, v.ortho, v.fov, v.fovBinding, v.co]), [
    ['Front', false, 40, 'H', 10],
    ['Top', true, 30, 'W', 0],
  ]);
  assert.deepEqual(a.views[0].c2w, C2W_FRONT);
  // The decoded bytes are the U3D file; the raw ones inflate to it.
  assert.deepEqual(a.getBytes(), model);
  const raw = a.getSource(true);
  assert.equal(raw.deflated, true);
  assert.deepEqual(new Uint8Array(inflateSync(raw.bytes)), model);
  const plain = a.getSource(false);
  assert.equal(plain.deflated, false);
  assert.deepEqual(plain.bytes, model);
  assert.equal(readU3D(plain.bytes).triangles, 12);
});

test('the model stream behind a /3DRef dictionary is found too', async () => {
  const pdf = await reload(await build3DPdf({ model: buildBoxU3D(), useRef: true }));
  const [a] = find3DAnnotations(pdf);
  assert.equal(a.subtype, 'U3D');
  assert.equal(readU3D(a.getBytes()).triangles, 12);
  assert.deepEqual(a.views, []);
  assert.equal(a.defaultView, 0);
});

test('a PRC model is reported with its format, so the viewer can say it is not supported', async () => {
  const pdf = await reload(await build3DPdf({ subtype: 'PRC', model: new TextEncoder().encode('PRC') }));
  const [a] = find3DAnnotations(pdf);
  assert.equal(a.subtype, 'PRC');
});

test('default view: annotation /3DV before stream /DV; index, /F, /L, /D and internal names', async () => {
  const views = [
    { name: 'One', internalName: 'v1', c2w: C2W_FRONT },
    { name: 'Two', internalName: 'v2', c2w: C2W_TOP },
    { name: 'Three', internalName: 'v3', c2w: C2W_FRONT },
  ];
  const cases = [
    [{ dv: 1 }, 1],
    [{ dv: 1, annot3DV: 2 }, 2],
    [{ dv: 2, annot3DV: 'F' }, 0],
    [{ dv: 0, annot3DV: 'L' }, 2],
    [{ dv: 2, annot3DV: 'D' }, 2],
    [{ annot3DV: PDFString.of('v2') }, 1],
    [{ dv: PDFString.of('v3') }, 2],
    [{ dv: 99 }, 2],
    [{ dv: -5 }, 0],
    [{}, 0],
  ];
  for (const [opts, want] of cases) {
    const pdf = await reload(await build3DPdf({ model: buildBoxU3D(), views, ...opts }));
    assert.equal(find3DAnnotations(pdf)[0].defaultView, want, JSON.stringify(opts));
  }
});

test('broken view entries fall back instead of failing', async () => {
  const pdf = await build3DPdf({ model: buildBoxU3D(), views: [{ name: 'Short', c2w: [1, 2, 3] }] });
  const [a] = find3DAnnotations(await reload(pdf));
  assert.equal(a.views[0].c2w, null);
  assert.equal(a.views[0].fov, 30);
});

test('a PDF without 3D content has no 3D annotations and no markup pages', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const back = await reload(pdf);
  assert.deepEqual(find3DAnnotations(back), []);
  assert.deepEqual(findThreeDSnapshots(back), []);
});

test('the snapshot page record is read field by field', () => {
  const rec = parseSnapshotRecord(JSON.stringify({
    sourcePage: 1, name: 'Markup view 1', c2w: C2W_FRONT, co: 12.5, fov: 35, ortho: false, hidden: ['Box', 7, 'Roof'],
  }), 2);
  assert.deepEqual(rec, {
    sourcePage: 1, name: 'Markup view 1', c2w: C2W_FRONT, co: 12.5, fov: 35, ortho: false, hidden: ['Box', 'Roof'],
  });
  // Foreign or damaged records.
  assert.equal(parseSnapshotRecord('not json', 2), null);
  assert.equal(parseSnapshotRecord('[1,2]', 2), null);
  assert.equal(parseSnapshotRecord('null', 2), null);
  const odd = parseSnapshotRecord(JSON.stringify({ sourcePage: 99, name: 5, c2w: [1, 'x'], co: -3, fov: 'wide', ortho: 'yes', hidden: 'Box' }), 2);
  assert.deepEqual(odd, { sourcePage: 1, name: '', c2w: null, co: 0, fov: 30, ortho: false, hidden: [] });
  const proto = parseSnapshotRecord('{"__proto__": {"polluted": true}, "sourcePage": 2}', 2);
  assert.equal(proto.sourcePage, 2);
  assert.equal({}.polluted, undefined);
});

test('markup pages are found by their page key, in text or hex strings', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage(); pdf.addPage();
  const record = JSON.stringify({ sourcePage: 1, name: 'Markup view 1', c2w: C2W_TOP, co: 3, fov: 30 });
  pdf.getPage(1).node.set(PDFName.of(SNAPSHOT_KEY), PDFHexString.fromText(record));
  pdf.getPage(2).node.set(PDFName.of(SNAPSHOT_KEY), PDFString.of(record.replace('1"', '2"').replace('view 1', 'view 2')));
  pdf.getPage(0).node.set(PDFName.of(SNAPSHOT_KEY), PDFName.of('NotOurs'));
  const found = findThreeDSnapshots(await reload(pdf));
  assert.deepEqual(found.map(s => [s.page, s.sourcePage, s.name]), [[2, 1, 'Markup view 1'], [3, 1, 'Markup view 2']]);
  assert.deepEqual(found[0].c2w, C2W_TOP);
});
