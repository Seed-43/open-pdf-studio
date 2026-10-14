// Systeemtypen-model versie 2 (#567): bibliotheek- en typerevisies,
// migratie 1→2, normalisatie zonder verzonnen maten, de keuze van het type
// voor de native tool en wat de geometrie doet met een onbevestigde maat.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SYSTEEMTYPE_VERSION, createDefaultSysteemTypen, migrateSysteemTypen, normalizeSysteemType,
  findSysteemType, mergeSysteemType, updateSysteemTypeIn, duplicateSysteemType,
  systeemTypeToJson, systeemTypeFromJson, kiesToolType, typeInstanceVelden,
  onbevestigdeMaten, isDoorGebruikerBewerkt,
} from './systeem-typen.js';
import { buildSysteemraster, sparingRegime, randstukkenVoorPaneel } from './systeemraster.js';

const K = 0.1;
function rectAnn(w, h, extra = {}) {
  return {
    type: 'systeemraster',
    points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    ...extra,
  };
}

// De ingebouwde typen zoals versie 1 ze kende (oude normalisatie).
const OUDE_INGEBOUWDE = {
  'st-plafond-600x600': { celXMm: 600, celYMm: 600, layout: 'raster', categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING' },
  'st-plafond-600x1200': { celXMm: 600, celYMm: 1200, layout: 'raster', categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING' },
  'st-bandraster-300x1200': { celXMm: 300, celYMm: 1200, layout: 'raster', categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING' },
  'st-stelcon-2000x2000': { celXMm: 2000, celYMm: 2000, layout: 'raster', categorie: 'vloer', ifcCategory: 'IfcCovering', ifcPredefinedType: 'FLOORING' },
  'st-kanaalplaat-1200': { celXMm: 1200, celYMm: 1200, layout: 'strook', categorie: 'vloer', ifcCategory: 'IfcSlab', ifcPredefinedType: 'FLOOR' },
};

test('versie 2: bibliotheekrevisie, grafstenen en een revisie per type', () => {
  assert.equal(SYSTEEMTYPE_VERSION, 2);
  const d = createDefaultSysteemTypen();
  assert.equal(d.version, 2);
  assert.equal(d.revisie, 0);
  assert.deepEqual(d.verwijderd, []);
  for (const t of d.typen) {
    assert.equal(t.revisie, 1, t.id);
    assert.equal('eigenaarRevisie' in t, false, 'app-typen hebben geen eigenaarrevisie');
  }
});

test('ingebouwde typen: vaste id\'s en dezelfde waarden, nu met expliciete strook- en sparingsmaten', () => {
  const d = createDefaultSysteemTypen();
  assert.deepEqual(d.typen.map(t => t.id), Object.keys(OUDE_INGEBOUWDE));
  for (const t of d.typen) {
    for (const [veld, waarde] of Object.entries(OUDE_INGEBOUWDE[t.id])) assert.equal(t[veld], waarde, `${t.id}.${veld}`);
    assert.equal(t.strookBreedteMm, 1200, t.id);
    assert.deepEqual(t.sparingRegels, { kleineSparingMaxMm: 400, raveelVanafMm: 800 }, t.id);
    assert.equal(t.edgeProfiel, 'geen');
    assert.deepEqual(onbevestigdeMaten(t), [], t.id);
  }
  // Rondgang door JSON (zoals de preferences-opslag): identiek na migratie.
  assert.deepEqual(migrateSysteemTypen(JSON.parse(JSON.stringify(d))), d);
});

test('normalisatie vult geen fysieke maten in; weergavekeuzes wel', () => {
  const t = normalizeSysteemType({ id: 'st-x' });
  for (const veld of ['celXMm', 'celYMm', 'strookBreedteMm', 'sparingRegels']) {
    assert.equal(veld in t, false, veld);
  }
  assert.equal(t.edgeProfiel, 'geen');
  assert.ok(t.paneelTypen.some(p => p.id === 'tegel'));
  assert.equal(t.revisie, 1);
  assert.deepEqual(onbevestigdeMaten(t), ['celXMm', 'celYMm', 'sparingRegels.kleineSparingMaxMm', 'sparingRegels.raveelVanafMm']);
  // Een half gegeven sparingsregel blijft half.
  const half = normalizeSysteemType({ id: 'st-y', sparingRegels: { kleineSparingMaxMm: 300, raveelVanafMm: 'x' } });
  assert.deepEqual(half.sparingRegels, { kleineSparingMaxMm: 300 });
  // Ongeldige maat (0, tekst, negatief) blijft weg.
  const fout = normalizeSysteemType({ id: 'st-z', celXMm: 0, celYMm: -5, strookBreedteMm: 'breed' });
  assert.equal('celXMm' in fout || 'celYMm' in fout || 'strookBreedteMm' in fout, false);
  // Een getal als tekst (uit een invoerveld) telt wel.
  assert.equal(normalizeSysteemType({ id: 'st-w', celXMm: '625' }).celXMm, 625);
});

test('migratie 1→2: revisie 1, onbekende velden weg, geen ruwe kortsluiting, dubbele id\'s eruit', () => {
  const v1 = {
    version: 1,
    typen: [
      { id: 'st-a', naam: 'A', categorie: 'plafond', ifcCategory: 'IfcCovering', celXMm: 600, celYMm: 600,
        edgeProfiel: 'geen', layout: 'raster', strookBreedteMm: 1200,
        sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 },
        paneelTypen: [{ id: 'tegel', naam: 'Plafondtegel', renderStijl: 'tegel' }], lagen: [],
        artikelnummer: 'X-1' },
      { id: 'st-a', naam: 'Dubbel', celXMm: 999, celYMm: 999 },
      { id: 'st-b', naam: 'B', celXMm: 300, celYMm: 300 },
    ],
  };
  const d = migrateSysteemTypen(v1);
  assert.notEqual(d, v1, 'nooit de ruwe invoer terug');
  assert.equal(d.version, 2);
  assert.equal(d.revisie, 0);
  assert.deepEqual(d.verwijderd, []);
  assert.deepEqual(d.typen.map(t => t.id), ['st-a', 'st-b']);
  assert.equal(findSysteemType(d, 'st-a').naam, 'A', 'het eerste exemplaar blijft');
  assert.equal('artikelnummer' in findSysteemType(d, 'st-a'), false);
  for (const t of d.typen) assert.equal(t.revisie, 1);
  // Een v2-bibliotheek die al genormaliseerd is, blijft inhoudelijk gelijk.
  assert.deepEqual(migrateSysteemTypen(JSON.parse(JSON.stringify(d))), d);
  // Ook versie 2 wordt altijd genormaliseerd (geen kortsluiting meer).
  const v2 = { version: 2, revisie: 4, verwijderd: [{ id: 'ext:a.b#c', revisie: 2 }, { kapot: true }],
    typen: [{ id: 'st-c', naam: 'C', onzin: 1, revisie: 3 }] };
  const m = migrateSysteemTypen(v2);
  assert.equal(m.revisie, 4);
  assert.deepEqual(m.verwijderd, [{ id: 'ext:a.b#c', revisie: 2 }]);
  assert.equal('onzin' in m.typen[0], false);
  assert.equal(m.typen[0].revisie, 3);
  // Nieuwer dan deze build: ongemoeid terug.
  const v3 = { version: 3, typen: [{ id: 'st-q' }] };
  assert.equal(migrateSysteemTypen(v3), v3);
});

test('snapshot-JSON: metadata reist mee; een oude snapshot laadt met revisie 1', () => {
  const t = normalizeSysteemType({ id: 'ext:test.synthetisch#k', naam: 'K', celXMm: 600, celYMm: 600, revisie: 4, eigenaarRevisie: 3 });
  const terug = systeemTypeFromJson(systeemTypeToJson(t));
  assert.deepEqual(terug, t);
  assert.equal(terug.revisie, 4);
  assert.equal(terug.eigenaarRevisie, 3);
  const oud = systeemTypeFromJson(JSON.stringify({ id: 'st-oud', naam: 'Oud', celXMm: 600, celYMm: 600 }));
  assert.equal(oud.revisie, 1);
  // ext-snapshot zonder eigenaarRevisie: telt als bewerkt door de gebruiker.
  const zonder = systeemTypeFromJson(JSON.stringify({ id: 'ext:test.synthetisch#k', naam: 'K' }));
  assert.equal('eigenaarRevisie' in zonder, false);
  assert.equal(isDoorGebruikerBewerkt(zonder), true);
  assert.equal(isDoorGebruikerBewerkt(t), true);
  assert.equal(isDoorGebruikerBewerkt({ ...t, revisie: 3 }), false);
  assert.equal(isDoorGebruikerBewerkt(normalizeSysteemType({ id: 'st-x', revisie: 9 })), false, 'app-typen hebben geen eigenaar');
  // eigenaarRevisie hoort alleen bij typen met een eigenaar.
  assert.equal('eigenaarRevisie' in normalizeSysteemType({ id: 'st-x', revisie: 2, eigenaarRevisie: 2 }), false);
});

test('mergeSysteemType: bestaand id wint; een grafsteen vervalt bij een PDF-import', () => {
  const d = createDefaultSysteemTypen();
  const m = mergeSysteemType(d, { id: 'st-x', naam: 'Extern', celXMm: 450, celYMm: 450 });
  assert.equal(findSysteemType(m, 'st-x').celXMm, 450);
  const m2 = mergeSysteemType(m, { id: 'st-x', celXMm: 999 });
  assert.equal(findSysteemType(m2, 'st-x').celXMm, 450);
  const metGraf = { ...d, verwijderd: [{ id: 'ext:a.b#c', revisie: 2 }] };
  const terug = mergeSysteemType(metGraf, { id: 'ext:a.b#c', naam: 'C', celXMm: 600, celYMm: 600, revisie: 2, eigenaarRevisie: 2 });
  assert.ok(findSysteemType(terug, 'ext:a.b#c'));
  assert.deepEqual(terug.verwijderd, []);
});

test('updateSysteemTypeIn: revisie +1 alleen bij een inhoudelijke wijziging', () => {
  const d = createDefaultSysteemTypen();
  const d2 = updateSysteemTypeIn(d, 'st-plafond-600x1200', { celYMm: 900 });
  assert.equal(findSysteemType(d2, 'st-plafond-600x1200').revisie, 2);
  assert.equal(findSysteemType(d2, 'st-plafond-600x600').revisie, 1);
  const d3 = updateSysteemTypeIn(d2, 'st-plafond-600x1200', { celYMm: 900 });
  assert.equal(d3, d2, 'geen wijziging, geen nieuwe data');
  // Metadata in de patch telt niet.
  const d4 = updateSysteemTypeIn(d2, 'st-plafond-600x1200', { revisie: 40 });
  assert.equal(findSysteemType(d4, 'st-plafond-600x1200').revisie, 2);
  // Een eigendomstype dat in het paneel bewerkt wordt, is daarna bewerkt.
  const met = mergeSysteemType(d, { id: 'ext:a.b#c', naam: 'C', celXMm: 600, celYMm: 600, revisie: 1, eigenaarRevisie: 1 });
  const bewerkt = updateSysteemTypeIn(met, 'ext:a.b#c', { celXMm: 650 });
  const t = findSysteemType(bewerkt, 'ext:a.b#c');
  assert.equal(t.revisie, 2);
  assert.equal(t.eigenaarRevisie, 1);
  assert.equal(isDoorGebruikerBewerkt(t), true);
});

test('dupliceren: nieuw st-id, revisie 1, geen eigenaar; zonder bron niets bevestigd', () => {
  const bron = normalizeSysteemType({ id: 'ext:a.b#c', naam: 'C', celXMm: 600, celYMm: 600, revisie: 5, eigenaarRevisie: 4 });
  const kopie = duplicateSysteemType(bron);
  assert.match(kopie.id, /^st-/);
  assert.equal(kopie.revisie, 1);
  assert.equal('eigenaarRevisie' in kopie, false);
  assert.equal(kopie.celXMm, 600);
  const leeg = duplicateSysteemType(null, 'Leeg');
  assert.deepEqual(onbevestigdeMaten(leeg).slice(0, 2), ['celXMm', 'celYMm']);
});

test('kiesToolType: gekozen type, anders het standaardplafond, anders het eerste', () => {
  const d = mergeSysteemType(createDefaultSysteemTypen(), { id: 'ext:a.b#c', naam: 'C', ifcCategory: 'IfcPlate', celXMm: 625, celYMm: 625 });
  assert.equal(kiesToolType(d, 'ext:a.b#c').id, 'ext:a.b#c');
  assert.equal(kiesToolType(d, 'bestaat-niet').id, 'st-plafond-600x600');
  assert.equal(kiesToolType(d, null).id, 'st-plafond-600x600');
  const zonderPlafond = { ...d, typen: d.typen.filter(t => t.id !== 'st-plafond-600x600') };
  assert.equal(kiesToolType(zonderPlafond, null).id, zonderPlafond.typen[0].id);
  assert.equal(kiesToolType({ version: 2, typen: [] }, null), null);
});

test('typeInstanceVelden: id, IFC en plaatmaat uit het type; onbevestigd blijft weg', () => {
  const t = normalizeSysteemType({ id: 'ext:a.b#c', naam: 'C', ifcCategory: 'IfcPlate', celXMm: 625, celYMm: 625 });
  assert.deepEqual(typeInstanceVelden(t), {
    systeemTypeId: 'ext:a.b#c', ifcCategory: 'IfcPlate', plaatBreedteMm: 625, plaatHoogteMm: 625,
  });
  const half = normalizeSysteemType({ id: 'st-h', naam: 'H', ifcPredefinedType: 'CEILING', celXMm: 625 });
  const v = typeInstanceVelden(half);
  assert.equal(v.ifcPredefinedType, 'CEILING');
  assert.equal(v.plaatBreedteMm, 625);
  assert.equal('plaatHoogteMm' in v, false);
  const strook = normalizeSysteemType({ id: 'st-s', layout: 'strook', strookBreedteMm: 1200, celYMm: 1200 });
  assert.equal(typeInstanceVelden(strook).plaatBreedteMm, 1200);
});

// ── geometrie met een onbevestigde maat (§2.3) ─────────────────────────────

test('onbevestigde celmaat: geen cellen of lijnen, wel contour en het label', () => {
  const typeDef = normalizeSysteemType({ id: 'st-o', naam: 'O', celXMm: 600 });
  const g = buildSysteemraster(rectAnn(500, 300, { tagTonen: false }), { pxPerMm: K, typeDef });
  assert.deepEqual(g.onbevestigd, ['celYMm']);
  assert.equal(g.panels.length, 0);
  assert.equal(g.linesV.length, 0);
  assert.equal(g.linesH.length, 0);
  assert.equal(g.contour.length, 4, 'de contour blijft');
  assert.equal(g.params.plaatBreedteMm, 600);
  assert.equal(g.params.plaatHoogteMm, null, 'geen standaardmaat');
  assert.equal(g.tag.text, 'maat onbevestigd');
  assert.deepEqual(g.randMm, { links: 0, rechts: 0, boven: 0, onder: 0 });
});

test('onbevestigde strookbreedte: geen stroken', () => {
  const typeDef = normalizeSysteemType({ id: 'st-k', layout: 'strook', celYMm: 1200 });
  const g = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K, typeDef });
  assert.deepEqual(g.onbevestigd, ['strookBreedteMm']);
  assert.equal(g.stroken.length, 0);
  assert.equal(g.linesV.length, 0);
  assert.equal(g.params.plaatBreedteMm, null);
});

test('volledig bevestigd type: geen onbevestigd, strook gebruikt de strookbreedte als plaatbreedte', () => {
  const typeDef = normalizeSysteemType({ id: 'st-k', layout: 'strook', strookBreedteMm: 1200, celYMm: 1000,
    sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 } });
  const g = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K, typeDef });
  assert.deepEqual(g.onbevestigd, []);
  assert.equal(g.params.plaatBreedteMm, 1200);
  assert.equal(g.stroken.length, 5);
});

test('legacy-raster zonder type houdt 2000 × 2000', () => {
  const g = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K });
  assert.deepEqual(g.onbevestigd, []);
  assert.equal(g.params.plaatBreedteMm, 2000);
  assert.equal(g.params.plaatHoogteMm, 2000);
  assert.equal(g.cellW, 200);
  assert.equal(g.tag.text, '2000x2000');
});

test('onbevestigde sparingsregels: elke sparing is een gewoon gat', () => {
  const typeDef = normalizeSysteemType({ id: 'st-k', layout: 'strook', strookBreedteMm: 1200, celYMm: 1200 });
  const ann = rectAnn(500, 300, { sparingen: [{ id: 's', xMm: 1300, yMm: 1000, bMm: 1200, hMm: 900 }] });
  const g = buildSysteemraster(ann, { pxPerMm: K, typeDef });
  assert.equal(g.sparingRegels, null);
  assert.equal(g.sparingen[0].regime, 'klein');
  assert.equal(g.raveels.length, 0);
  // Zonder type blijven de standaardregels gelden (legacy).
  assert.equal(sparingRegime(1200, 900, undefined, 'strook'), 'raveel');
  assert.equal(sparingRegime(1200, 900, null, 'strook'), 'klein');
});

test('randstukken in het paneel: bij een onbevestigde maat geen "volle plaat", maar onbevestigd', () => {
  const zonderY = normalizeSysteemType({ id: 'ext:test.synthetisch#vloer', naam: 'Vloer', celXMm: 600 });
  const g = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K, typeDef: zonderY });
  const r = randstukkenVoorPaneel(g);
  assert.deepEqual(r, { onbevestigd: ['celYMm'], randMm: null }, 'geen randmaten die op een indeling lijken');
  // Volledig bevestigd: de randmaten van de geometrie.
  const bevestigd = normalizeSysteemType({ id: 'st-b', naam: 'B', celXMm: 600, celYMm: 600 });
  const gb = buildSysteemraster(rectAnn(500, 300), { pxPerMm: K, typeDef: bevestigd });
  assert.deepEqual(randstukkenVoorPaneel(gb), { onbevestigd: [], randMm: gb.randMm });
  assert.equal(randstukkenVoorPaneel(null), null);
});
