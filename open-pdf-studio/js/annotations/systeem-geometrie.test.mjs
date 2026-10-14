// Documentgebonden geometrie van een systeem-instance (#567, punt 7): een
// losgekoppelde, gevalideerde snapshot uit de native geometrie
// (buildSysteemraster) in millimeters in het eigen assenstelsel van het
// systeem, met document- en typerevisie en de bevestiging van de maten.
// Puur: de app-laag (systeem-geometrie-app.js) zoekt alleen de annotatie, de
// schaal en het type op.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GEOMETRIE_SCHEMA, systeemGeometrie, documentRevisie,
} from './systeem-geometrie.js';
import { buildSysteemraster, rotToWorld, PX_PER_MM_1_100 } from './systeemraster.js';
import { normalizeSysteemType } from './systeem-typen.js';

const K = 0.1; // paginapunten per werkelijke mm (een gekalibreerde schaal)

const PLAFOND = normalizeSysteemType({
  id: 'ext:test.synthetisch#mineraal', naam: 'Mineraal', categorie: 'plafond', ifcCategory: 'IfcCovering',
  ifcPredefinedType: 'CEILING', layout: 'raster', celXMm: 600, celYMm: 600,
  sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 }, revisie: 3, eigenaarRevisie: 3,
});

function instance(extra = {}) {
  return {
    id: 'sg-1', type: 'systeemraster', page: 2, systeemTypeId: PLAFOND.id,
    points: [{ x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 340 }, { x: 100, y: 340 }],
    system: { type: 'plafond', layers: [{ panels: { '1,1': 'licht' }, edge: { profiel: 'geen' } }] },
    ...extra,
  };
}

/** Een L-vormige (concave) contour met een gedraaid raster en een sparing. */
function lVorm(extra = {}) {
  return instance({
    points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }],
    rasterHoek: 30,
    originXMm: 150,
    sparingen: [{ id: 'sp-1', xMm: 300, yMm: 400, bMm: 500, hMm: 300 }],
    ...extra,
  });
}

const geometrie = (ann, extra = {}) => systeemGeometrie({
  documentId: 'doc-1', ann, pxPerMm: K, typeDef: PLAFOND, ...extra,
});

function oppervlak(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function gooit(fn, code) {
  let fout = null;
  try { fn(); } catch (e) { fout = e; }
  assert.ok(fout, `verwacht ${code}`);
  assert.equal(fout.name, 'SystemTypeError', fout.message);
  assert.equal(fout.code, code, fout.message);
  return fout;
}

test('vorm: schema, document- en typerevisie, eenheden en assenstelsel', () => {
  const g = geometrie(instance());
  assert.equal(GEOMETRIE_SCHEMA, 1);
  assert.equal(g.schema, 1);
  assert.equal(g.annotationId, 'sg-1');
  assert.deepEqual(g.document, { id: 'doc-1', revision: documentRevisie(instance(), K) });
  assert.match(g.document.revision, /^g1-[0-9a-f]+$/);
  assert.equal(g.page, 2);
  assert.deepEqual(g.type, { id: PLAFOND.id, revision: 3 });
  assert.equal(g.units, 'mm');
  assert.equal(g.coordinateSpace, 'system');
  assert.deepEqual(g.placement, { page: 2, origin: { x: 100, y: 100 }, angleDeg: 0, pagePointsPerMm: K, scaleKnown: true });
  assert.equal(g.confirmed, true);
  assert.deepEqual(g.unconfirmed, []);
  assert.deepEqual(g.problems, []);
  assert.equal(g.layout, 'raster');
  assert.deepEqual(g.bounds, { width: 3600, height: 2400 });
  assert.equal(g.areaMm2, 3600 * 2400);
  assert.deepEqual(g.contour, [{ x: 0, y: 0 }, { x: 3600, y: 0 }, { x: 3600, y: 2400 }, { x: 0, y: 2400 }]);
  assert.deepEqual(g.grid, { origin: { x: 0, y: 0 }, cellWidth: 600, cellHeight: 600 });
  // Alleen geometrie en identiteit: geen PDF-bytes, preferences of UI (tag).
  assert.deepEqual(Object.keys(g).sort(), [
    'annotationId', 'areaMm2', 'bounds', 'components', 'confirmed', 'contour', 'coordinateSpace', 'document',
    'edgePieces', 'edges', 'fitLines', 'grid', 'layout', 'lines', 'openings', 'page', 'panels', 'placement',
    'problems', 'schema', 'strips', 'trimmers', 'type', 'unconfirmed', 'units',
  ]);
});

test('stemt overeen met de native geometrie: panelen, lijnen, randstukken en paneeltypen', () => {
  const ann = instance();
  const native = buildSysteemraster(ann, { pxPerMm: K, typeDef: PLAFOND });
  const g = geometrie(ann);
  assert.equal(g.panels.length, native.panels.length);
  assert.equal(g.panels.length, 6 * 4);
  assert.equal(g.lines.vertical.length, native.linesV.length);
  assert.equal(g.lines.horizontal.length, native.linesH.length);
  for (const [i, l] of native.linesV.entries()) {
    assert.equal(g.lines.vertical[i].x, Math.round(((l.x - native.rasterAabb.x) / K) * 1000) / 1000);
    assert.equal(g.lines.vertical[i].segments.length, l.segs.length);
  }
  const licht = g.panels.find((p) => p.ix === 1 && p.iy === 1);
  assert.deepEqual([licht.panelType, licht.renderStyle, licht.edge], ['licht', 'licht', false]);
  assert.deepEqual([licht.x, licht.y, licht.width, licht.height], [600, 600, 600, 600]);
  assert.deepEqual(licht.outline, [{ x: 600, y: 600 }, { x: 1200, y: 600 }, { x: 1200, y: 1200 }, { x: 600, y: 1200 }]);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  assert.deepEqual(g.edgePieces, { left: r3(native.randMm.links), right: r3(native.randMm.rechts),
    top: r3(native.randMm.boven), bottom: r3(native.randMm.onder) });
});

test('geknipte randen en sparingen bij een concave contour met een gedraaid raster', () => {
  const ann = lVorm();
  const native = buildSysteemraster(ann, { pxPerMm: K, typeDef: PLAFOND });
  const g = geometrie(ann);
  assert.equal(g.placement.angleDeg, 30);
  assert.equal(g.panels.length, native.panels.length);
  assert.ok(g.panels.some((p) => p.edge), 'er zijn geknipte randpanelen');
  assert.ok(Math.abs(g.areaMm2 - (4000 * 4000 - 2000 * 2000)) < 1);
  // De geknipte omtrekken liggen binnen de contour. De native indeling neemt
  // een cel op als een van haar negen meetpunten binnen ligt; een
  // hoekpuntje dat geen meetpunt raakt, telt (net als in de preview) niet
  // mee — bij een gedraaid raster blijft er daardoor een fractie over.
  const totaal = g.panels.reduce((s, p) => s + oppervlak(p.outline), 0);
  assert.ok(totaal <= g.areaMm2 + 1 && totaal > 0.99 * g.areaMm2, `${totaal} ≈ ${g.areaMm2}`);
  // Zonder rasterhoek vullen de geknipte omtrekken de contour precies.
  const recht = geometrie(lVorm({ rasterHoek: 0 }));
  const totaalRecht = recht.panels.reduce((s, p) => s + oppervlak(p.outline), 0);
  assert.ok(Math.abs(totaalRecht - recht.areaMm2) < 1e-6 * recht.areaMm2, `${totaalRecht} ≈ ${recht.areaMm2}`);
  assert.ok(recht.panels.some((p) => p.edge && oppervlak(p.outline) < p.width * p.height - 1));
  for (const p of g.panels) {
    const a = oppervlak(p.outline);
    if (p.edge) assert.ok(a < p.width * p.height - 1e-6, 'een randpaneel is kleiner dan zijn cel');
    else assert.ok(Math.abs(a - p.width * p.height) < 1e-6);
    for (const q of p.outline) {
      assert.ok(q.x >= p.x - 1e-3 && q.x <= p.x + p.width + 1e-3 && q.y >= p.y - 1e-3 && q.y <= p.y + p.height + 1e-3);
    }
  }
  // Sparing: positie en maat in hetzelfde assenstelsel (mm vanaf de raster-AABB).
  assert.deepEqual(g.openings, [{ id: 'sp-1', x: 300, y: 400, width: 500, height: 300, regime: 'verzwaard' }]);
  // Rasterlijnen stoppen op de sparing: geen segment loopt erdoorheen.
  for (const l of g.lines.vertical) {
    if (l.x <= 300 || l.x >= 800) continue;
    for (const s of l.segments) assert.ok(s.to <= 400 + 1e-3 || s.from >= 700 - 1e-3);
  }
});

test('plaatsing: met origin, hoek en schaal liggen de coördinaten weer precies op de pagina', () => {
  for (const ann of [instance(), lVorm(), lVorm({ rasterHoek: 117.5 })]) {
    const native = buildSysteemraster(ann, { pxPerMm: K, typeDef: PLAFOND });
    const g = geometrie(ann);
    const { origin, angleDeg, pagePointsPerMm: k } = g.placement;
    const r = (angleDeg * Math.PI) / 180;
    const naarPagina = (p) => ({
      x: origin.x + k * (p.x * Math.cos(r) - p.y * Math.sin(r)),
      y: origin.y + k * (p.x * Math.sin(r) + p.y * Math.cos(r)),
    });
    assert.equal(g.contour.length, native.contour.length);
    g.contour.forEach((p, i) => {
      const q = naarPagina(p);
      assert.ok(Math.hypot(q.x - native.contour[i].x, q.y - native.contour[i].y) < 1e-3, `contourpunt ${i}`);
    });
    // De rasteroorsprong valt op de native oorsprong.
    const o = naarPagina(g.grid.origin);
    assert.ok(Math.hypot(o.x - native.originWorld.x, o.y - native.originWorld.y) < 1e-3);
    // Componentposities en randsegmenten in hetzelfde stelsel.
    native.edgeSegs.forEach((s, i) => {
      const q = naarPagina(g.edges[i].points[0]);
      assert.ok(Math.hypot(q.x - s.pts[0].x, q.y - s.pts[0].y) < 1e-3);
      assert.equal(g.edges[i].profile, s.profiel);
    });
    assert.deepEqual(rotToWorld(native.rot, { x: native.rasterAabb.x, y: native.rasterAabb.y }).x.toFixed(3),
      origin.x.toFixed(3));
  }
});

test('componenten: positie (celmidden) en symbool uit de paneel-override', () => {
  const ann = instance({
    system: { type: 'plafond', layers: [{ panels: { '2,1': { soort: 'component', symbolId: 'lamp-1', naam: 'Lamp' } } }] },
  });
  const g = geometrie(ann);
  assert.deepEqual(g.components, [{ ix: 2, iy: 1, symbolId: 'lamp-1', naam: 'Lamp', center: { x: 1500, y: 900 } }]);
  assert.deepEqual(g.panels.find((p) => p.ix === 2 && p.iy === 1).component, { symbolId: 'lamp-1', naam: 'Lamp' });
});

test('strook-layout: stroken, passtroken, raveels', () => {
  const kanaal = normalizeSysteemType({
    id: 'mcp:kanaal', naam: 'Kanaal', categorie: 'vloer', ifcCategory: 'IfcSlab', layout: 'strook',
    strookBreedteMm: 1200, celYMm: 1200, sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 },
  });
  const ann = instance({ systeemTypeId: kanaal.id, originXMm: 300, sparingen: [{ id: 'r', xMm: 1300, yMm: 600, bMm: 1000, hMm: 900 }] });
  const native = buildSysteemraster(ann, { pxPerMm: K, typeDef: kanaal });
  const g = geometrie(ann, { typeDef: kanaal });
  assert.equal(g.layout, 'strook');
  assert.equal(g.strips.length, native.stroken.length);
  assert.ok(g.strips.some((s) => s.fit), 'passtroken');
  assert.equal(g.fitLines.length, native.pasLijnen.length);
  assert.equal(g.trimmers.length, 2);
  assert.deepEqual(g.trimmers.map((t) => [t.openingId, t.y]), [['r', 600], ['r', 1500]]);
  assert.equal(g.panels.length, 0);
  assert.equal(g.grid.cellWidth, 1200);
});

test('onbevestigde maten en een onbekende schaal geven nooit een bevestigde snapshot', () => {
  const zonderY = normalizeSysteemType({ id: 'ext:test.synthetisch#vloer', naam: 'V', layout: 'raster', celXMm: 600 });
  const g = geometrie(instance({ systeemTypeId: zonderY.id }), { typeDef: zonderY });
  assert.equal(g.confirmed, false);
  assert.deepEqual(g.unconfirmed, ['celYMm']);
  assert.deepEqual([g.panels, g.lines.vertical, g.lines.horizontal], [[], [], []]);
  assert.deepEqual(g.grid, { origin: { x: 0, y: 0 }, cellWidth: 600, cellHeight: null });
  assert.equal(g.edgePieces, null, 'geen randstukken zonder indeling');
  assert.equal(g.areaMm2, 3600 * 2400, 'de oppervlakte blijft beschikbaar');
  // Sparingsregels tellen alleen mee als er sparingen zijn.
  const zonderRegels = normalizeSysteemType({ ...PLAFOND, sparingRegels: undefined });
  assert.equal(geometrie(instance(), { typeDef: zonderRegels }).confirmed, true);
  const metSparing = geometrie(instance({ sparingen: [{ id: 's', xMm: 0, yMm: 0, bMm: 100, hMm: 100 }] }), { typeDef: zonderRegels });
  assert.equal(metSparing.confirmed, false);
  assert.deepEqual(metSparing.unconfirmed, ['sparingRegels.kleineSparingMaxMm', 'sparingRegels.raveelVanafMm']);
  // Geen schaal op die plek: de terugval op 1:100 is geen bevestigde maat.
  const zonderSchaal = geometrie(instance(), { pxPerMm: 0 });
  assert.equal(zonderSchaal.placement.scaleKnown, false);
  assert.equal(zonderSchaal.placement.pagePointsPerMm, PX_PER_MM_1_100);
  assert.deepEqual(zonderSchaal.unconfirmed, ['scale']);
  assert.equal(zonderSchaal.confirmed, false);
  // Een opgeslagen maat buiten schema 1 is een probleem, geen bevestiging.
  const rommel = normalizeSysteemType({ ...PLAFOND, celXMm: 30 });
  const r = geometrie(instance(), { typeDef: rommel });
  assert.deepEqual(r.problems, ['celXMm']);
  assert.equal(r.confirmed, false);
});

test('zonder type (legacy): de plaatmaat van de instance; standaard-sparingsregels zijn onbevestigd', () => {
  const ann = instance({ systeemTypeId: undefined, plaatBreedteMm: 2000, plaatHoogteMm: 1000 });
  const g = geometrie(ann, { typeDef: null });
  assert.equal(g.type, null);
  assert.equal(g.confirmed, true);
  assert.deepEqual(g.grid, { origin: { x: 0, y: 0 }, cellWidth: 2000, cellHeight: 1000 });
  const zonderMaat = geometrie(instance({ systeemTypeId: undefined }), { typeDef: null });
  assert.deepEqual(zonderMaat.unconfirmed, ['plaatBreedteMm', 'plaatHoogteMm']);
  const metSparing = geometrie({ ...ann, sparingen: [{ id: 's', xMm: 0, yMm: 0, bMm: 100, hMm: 100 }] }, { typeDef: null });
  assert.deepEqual(metSparing.unconfirmed, ['sparingRegels.kleineSparingMaxMm', 'sparingRegels.raveelVanafMm']);
});

test('revisies: een verouderde document- of typerevisie wordt geweigerd', () => {
  const ann = instance();
  const g = geometrie(ann);
  assert.deepEqual(geometrie(ann, { opties: { expectedDocumentRevision: g.document.revision, expectedTypeRevision: 3 } }), g);
  // De instance verandert (punt verschoven, override, sparing, rasterhoek): nieuwe revisie.
  for (const wijzig of [
    (a) => { a.points[1].x += 10; },
    (a) => { a.system.layers[0].panels['0,0'] = 'ventilatie'; },
    (a) => { a.sparingen = [{ id: 's', xMm: 0, yMm: 0, bMm: 100, hMm: 100 }]; },
    (a) => { a.rasterHoek = 15; },
    (a) => { a.systeemTypeId = 'st-plafond-600x600'; },
  ]) {
    const b = JSON.parse(JSON.stringify(ann));
    wijzig(b);
    assert.notEqual(documentRevisie(b, K), g.document.revision);
    const f = gooit(() => geometrie(b, { opties: { expectedDocumentRevision: g.document.revision } }), 'stale-revision');
    assert.equal(f.field, 'expectedDocumentRevision');
    assert.equal(f.currentRevision, documentRevisie(b, K));
  }
  // Een andere schaal op die plek is ook een andere geometrie.
  assert.notEqual(documentRevisie(ann, 0.2), g.document.revision);
  // Niet-geometrische velden (kleur, selectie) veranderen de revisie niet.
  assert.equal(documentRevisie({ ...ann, color: '#ff0000', selectedSub: { kind: 'paneel' } }, K), g.document.revision);
  const t = gooit(() => geometrie(ann, { opties: { expectedTypeRevision: 2 } }), 'stale-revision');
  assert.equal(t.field, 'expectedTypeRevision');
  assert.equal(t.currentRevision, 3);
  // Zonder type is elke verwachte typerevisie verouderd.
  const legacy = instance({ systeemTypeId: undefined });
  assert.equal(gooit(() => geometrie(legacy, { typeDef: null, opties: { expectedTypeRevision: 1 } }), 'stale-revision').currentRevision, null);
});

test('opties en argumenten worden gecontroleerd', () => {
  const ann = instance();
  gooit(() => geometrie(ann, { opties: { verwachtRevisie: 1 } }), 'invalid-argument');
  gooit(() => geometrie(ann, { opties: { expectedTypeRevision: 1.5 } }), 'invalid-argument');
  gooit(() => geometrie(ann, { opties: { expectedDocumentRevision: 3 } }), 'invalid-argument');
  gooit(() => geometrie(ann, { opties: { schema: 2 } }), 'unsupported-version');
  gooit(() => geometrie(ann, { opties: 'x' }), 'invalid-argument');
  assert.equal(geometrie(ann, { opties: { schema: 1 } }).schema, 1);
});

test('losgekoppeld: muteren raakt de annotatie en een volgende snapshot niet', () => {
  const ann = instance();
  const voor = JSON.stringify(ann);
  const g = geometrie(ann);
  g.panels[0].outline[0].x = -1;
  g.contour.length = 0;
  g.placement.origin.x = 0;
  assert.equal(JSON.stringify(ann), voor);
  assert.equal(geometrie(ann).contour.length, 4);
  assert.equal(geometrie(ann).placement.origin.x, 100);
  // Onafhankelijk van zoom en weergaverotatie: zie system-type-api.test.mjs
  // (de app-laag leest alleen annotatie, schaal en type).
});
