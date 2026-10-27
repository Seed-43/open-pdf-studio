// Copied pages bring their spatial zones along. A zone id that is already in
// use gets a fresh id (and its children follow), otherwise duplicate ids make
// every copy of the zone invalid.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { collectZones, relinkZoneIds } from '../annotations/spatial-zones.js';
import { relinkZonesInPages, zoneIdsInPages } from './spatial-zone-relink.js';
import { voegPdfsSamen } from './samenvoegen.js';
import { pdfTextString, decodePdfTextObject } from './saver/pdf-text.js';

const N = (s) => PDFName.of(s);

function addZone(doc, page, rect, zone) {
  const dict = doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: rect,
    OPS_SpatialZone: pdfTextString(JSON.stringify({ version: 1, ...zone })),
  });
  let annots = page.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = doc.context.obj([]);
    page.node.set(N('Annots'), annots);
  }
  annots.push(doc.context.register(dict));
}

async function zonedPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  addZone(doc, page, [0, 0, 400, 400], { id: 'building', name: 'Building', parentId: '' });
  addZone(doc, page, [10, 10, 200, 200], { id: 'room', name: 'Room', parentId: 'building' });
  return doc;
}

/** The zones in a PDF as app annotations (boxes), for collectZones. */
function zonesAsAnnotations(doc) {
  const annotations = [];
  doc.getPages().forEach((page, index) => {
    for (const ref of page.node.lookup(N('Annots'))?.asArray() || []) {
      const dict = doc.context.lookup(ref);
      const raw = dict.get(N('OPS_SpatialZone'));
      if (!raw) continue;
      const [x1, y1, x2, y2] = dict.lookup(N('Rect')).asArray().map((n) => n.asNumber());
      annotations.push({
        id: `a${annotations.length}`, type: 'box', page: index + 1, x: x1, y: y1, width: x2 - x1, height: y2 - y1,
        spatialZone: JSON.parse(decodePdfTextObject(raw)),
      });
    }
  });
  return annotations;
}

test('a taken zone id gets a fresh id; its children follow, others keep theirs', () => {
  const taken = new Set(['a']);
  const renamed = relinkZoneIds([
    { version: 1, id: 'a', name: 'A', parentId: '' },
    { version: 1, id: 'b', name: 'B', parentId: 'a' },
  ], taken);
  assert.deepEqual([...renamed], [['a', 'a_2']]);
  assert.ok(taken.has('a_2') && taken.has('b'));
});

test('merging the same file twice keeps all zones valid', async () => {
  const target = await zonedPdf();
  const sources = [{ doc: await zonedPdf(), naam: 'one.pdf' }, { doc: await zonedPdf(), naam: 'two.pdf' }];
  await voegPdfsSamen(target, sources, { invoegIndex: 1, positie: 'end' });
  const annotations = zonesAsAnnotations(target);
  assert.equal(annotations.length, 6);
  const zones = collectZones(annotations);
  assert.equal(zones.length, 6);
  assert.ok(zones.every((z) => z.valid), JSON.stringify(zones.map((z) => [z.zone.id, z.zone.parentId, z.valid])));
  assert.equal(new Set(zones.map((z) => z.zone.id)).size, 6);
  for (const room of zones.filter((z) => z.zone.name === 'Room')) {
    const parent = zones.find((z) => z.zone.id === room.zone.parentId);
    assert.equal(parent.ann.page, room.ann.page, 'each room stays in the building of its own copy');
  }
});

test('ids in use in the document model also count as taken', async () => {
  const target = await PDFDocument.create();
  target.addPage([400, 400]);
  await voegPdfsSamen(target, [{ doc: await zonedPdf(), naam: 'one.pdf' }], {
    invoegIndex: 1, positie: 'end', zoneIds: ['building'],
  });
  const ids = zonesAsAnnotations(target).map((a) => a.spatialZone.id);
  assert.ok(!ids.includes('building'));
  assert.ok(ids.includes('room'));
});

test('a duplicated page gets fresh zone ids', async () => {
  const doc = await zonedPdf();
  const taken = zoneIdsInPages(doc.context, doc.getPages());
  const [copy] = await doc.copyPages(doc, [0]);
  doc.addPage(copy);
  relinkZonesInPages(doc.context, [copy], taken);
  assert.ok(collectZones(zonesAsAnnotations(doc)).every((z) => z.valid));
});
