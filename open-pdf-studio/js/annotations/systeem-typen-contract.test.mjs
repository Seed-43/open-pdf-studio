// Het publieke contract voor systeemtypen (#567): validatie per veld,
// eigendom in het id, registreren (vijf uitkomsten), bijwerken met een
// revisiecontrole en losgekoppelde snapshots. Alles puur: de registry en de
// plugin-API bouwen hierop (zie docs/plugin-systeemtypen.md).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SYSTEEMTYPE_SCHEMA, SysteemTypeFout, valideerDefinitie, typeIdVoor, eigenaarVanId,
  planRegistratie, planBijwerking, publiekeSnapshot, planEditorToepassen,
} from './systeem-typen-contract.js';
import {
  createDefaultSysteemTypen, findSysteemType, mergeSysteemType, updateSysteemTypeIn,
} from './systeem-typen.js';

const EXT = { kind: 'extension', extensionId: 'test.synthetisch' };
const ANDER = { kind: 'extension', extensionId: 'test.ander' };
const MCP = { kind: 'mcp' };

const DEF = Object.freeze({
  naam: 'Mineraalplaat 600x600',
  categorie: 'plafond',
  ifcCategory: 'IfcCovering',
  ifcPredefinedType: 'CEILING',
  layout: 'raster',
  celXMm: 600,
  celYMm: 600,
  edgeProfiel: 'schaduwvoeg',
});

const kloon = (x) => JSON.parse(JSON.stringify(x));

/** Verwacht een SystemTypeError met deze code (en eventueel dit veld). */
function gooit(fn, code, field) {
  let fout = null;
  try { fn(); } catch (e) { fout = e; }
  assert.ok(fout, `verwacht een fout met code ${code}`);
  assert.equal(fout.name, 'SystemTypeError', `${fout.name}: ${fout.message}`);
  assert.equal(fout.code, code, fout.message);
  assert.ok(fout instanceof SysteemTypeFout);
  assert.ok(fout instanceof Error);
  if (field !== undefined) assert.equal(fout.field, field);
  return fout;
}

function geregistreerd(data = createDefaultSysteemTypen(), def = DEF, key = 'mineraal-600x600') {
  return planRegistratie(data, EXT, key, def);
}

// ── validatie per veld (§4.3) ──────────────────────────────────────────────

test('schema 1 en een geldige definitie: alleen de gegeven velden komen terug', () => {
  assert.equal(SYSTEEMTYPE_SCHEMA, 1);
  const v = valideerDefinitie({ ...DEF, naam: '  Mineraalplaat  ' }, 'registreren');
  assert.equal(v.naam, 'Mineraalplaat', 'naam wordt getrimd');
  assert.equal(v.celXMm, 600);
  assert.equal('strookBreedteMm' in v, false);
});

test('onbekende velden worden geweigerd, ook genest', () => {
  gooit(() => valideerDefinitie({ ...DEF, artikelnummer: 'A-1' }, 'registreren'), 'unknown-field', 'artikelnummer');
  gooit(() => valideerDefinitie({ ...DEF, sparingRegels: { kleineSparingMaxMm: 400, foo: 1 } }, 'registreren'),
    'unknown-field', 'sparingRegels.foo');
  gooit(() => valideerDefinitie({ ...DEF, paneelTypen: [{ id: 'tegel', naam: 'T', renderStijl: 'tegel', prijs: 3 }] }, 'registreren'),
    'unknown-field', 'paneelTypen[0].prijs');
});

test('metadata en snapshotvelden zijn alleen-lezen', () => {
  for (const veld of ['id', 'revisie', 'eigenaarRevisie', 'revision', 'owner', 'ownerRevision', 'userEdited', 'schema', 'definition', 'unconfirmed', 'problems']) {
    gooit(() => valideerDefinitie({ ...DEF, [veld]: 1 }, 'registreren'), 'readonly-field', veld);
    gooit(() => valideerDefinitie({ [veld]: 1 }, 'bijwerken'), 'readonly-field', veld);
  }
});

test('maten buiten bereik worden geweigerd en niet geklemd', () => {
  gooit(() => valideerDefinitie({ ...DEF, celXMm: 49 }, 'registreren'), 'invalid-field', 'celXMm');
  gooit(() => valideerDefinitie({ ...DEF, celYMm: 20001 }, 'registreren'), 'invalid-field', 'celYMm');
  gooit(() => valideerDefinitie({ ...DEF, strookBreedteMm: '600' }, 'registreren'), 'invalid-field', 'strookBreedteMm');
  gooit(() => valideerDefinitie({ ...DEF, celXMm: Number.NaN }, 'registreren'), 'invalid-field', 'celXMm');
  assert.equal(valideerDefinitie({ ...DEF, celXMm: 50, celYMm: 20000 }, 'registreren').celYMm, 20000);
});

test('enums, naam en sparingsregels', () => {
  gooit(() => valideerDefinitie({ ...DEF, categorie: 'dak' }, 'registreren'), 'invalid-field', 'categorie');
  gooit(() => valideerDefinitie({ ...DEF, layout: 'tegels' }, 'registreren'), 'invalid-field', 'layout');
  gooit(() => valideerDefinitie({ ...DEF, ifcCategory: 'IfcBeam' }, 'registreren'), 'invalid-field', 'ifcCategory');
  gooit(() => valideerDefinitie({ ...DEF, ifcPredefinedType: 'WALL' }, 'registreren'), 'invalid-field', 'ifcPredefinedType');
  gooit(() => valideerDefinitie({ ...DEF, edgeProfiel: 'plint' }, 'registreren'), 'invalid-field', 'edgeProfiel');
  gooit(() => valideerDefinitie({ ...DEF, naam: '   ' }, 'registreren'), 'invalid-field', 'naam');
  gooit(() => valideerDefinitie({ ...DEF, naam: 'x'.repeat(201) }, 'registreren'), 'invalid-field', 'naam');
  gooit(() => valideerDefinitie({ ...DEF, sparingRegels: { kleineSparingMaxMm: 900, raveelVanafMm: 800 } }, 'registreren'),
    'invalid-field', 'sparingRegels');
  gooit(() => valideerDefinitie({ ...DEF, sparingRegels: { kleineSparingMaxMm: 9 } }, 'registreren'),
    'invalid-field', 'sparingRegels.kleineSparingMaxMm');
  gooit(() => valideerDefinitie({ ...DEF, sparingRegels: {} }, 'registreren'), 'invalid-field', 'sparingRegels');
  assert.deepEqual(valideerDefinitie({ ...DEF, sparingRegels: { raveelVanafMm: 800 } }, 'registreren').sparingRegels,
    { raveelVanafMm: 800 });
});

test('paneeltypen: alle drie velden verplicht, id-grammatica en uniek', () => {
  const pt = (o) => ({ ...DEF, paneelTypen: [{ id: 'tegel', naam: 'Tegel', renderStijl: 'tegel' }, o] });
  gooit(() => valideerDefinitie(pt({ id: 'licht', naam: 'Licht' }), 'registreren'), 'missing-field', 'paneelTypen[1].renderStijl');
  gooit(() => valideerDefinitie(pt({ id: 'Licht', naam: 'Licht', renderStijl: 'licht' }), 'registreren'), 'invalid-field', 'paneelTypen[1].id');
  gooit(() => valideerDefinitie(pt({ id: 'tegel', naam: 'Nog een', renderStijl: 'licht' }), 'registreren'), 'invalid-field', 'paneelTypen[1].id');
  gooit(() => valideerDefinitie(pt({ id: 'licht', naam: 'Licht', renderStijl: 'neon' }), 'registreren'), 'invalid-field', 'paneelTypen[1].renderStijl');
  gooit(() => valideerDefinitie({ ...DEF, paneelTypen: [] }, 'registreren'), 'invalid-field', 'paneelTypen');
  const veel = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, naam: `P${i}`, renderStijl: 'tegel' }));
  gooit(() => valideerDefinitie({ ...DEF, paneelTypen: veel }, 'registreren'), 'invalid-field', 'paneelTypen');
});

test('lagen: alleen [] in schema 1; andere vormen geweigerd', () => {
  assert.deepEqual(valideerDefinitie({ ...DEF, lagen: [] }, 'registreren').lagen, []);
  const f = gooit(() => valideerDefinitie({ ...DEF, lagen: [{ celXMm: 600 }] }, 'registreren'), 'unsupported-field', 'lagen');
  assert.match(f.message, /layered system types are not supported by schema 1 \(one implicit layer\)/);
  gooit(() => valideerDefinitie({ ...DEF, lagen: 'geen' }, 'registreren'), 'invalid-field', 'lagen');
});

test('verplichte velden bij registreren; null wist een optioneel veld bij bijwerken', () => {
  gooit(() => valideerDefinitie({ categorie: 'plafond', layout: 'raster' }, 'registreren'), 'missing-field', 'naam');
  gooit(() => valideerDefinitie({ naam: 'x', layout: 'raster' }, 'registreren'), 'missing-field', 'categorie');
  gooit(() => valideerDefinitie({ naam: 'x', categorie: 'vloer' }, 'registreren'), 'missing-field', 'layout');
  gooit(() => valideerDefinitie({ naam: null }, 'bijwerken'), 'invalid-field', 'naam');
  const v = valideerDefinitie({ celXMm: null, ifcPredefinedType: null }, 'bijwerken');
  assert.deepEqual(v, { celXMm: null, ifcPredefinedType: null });
  // Bij registreren betekent null op een optioneel veld: niet gegeven.
  assert.equal('celXMm' in valideerDefinitie({ ...DEF, celXMm: null }, 'registreren'), false);
});

test('waarden moeten JSON-zuiver zijn; de definitie moet een object zijn', () => {
  gooit(() => valideerDefinitie({ ...DEF, naam: () => 'x' }, 'registreren'), 'invalid-field');
  const cyclisch = { kleineSparingMaxMm: 400 };
  cyclisch.zelf = cyclisch;
  gooit(() => valideerDefinitie({ ...DEF, sparingRegels: cyclisch }, 'registreren'), 'invalid-field');
  gooit(() => valideerDefinitie({ ...DEF, celXMm: Infinity }, 'registreren'), 'invalid-field');
  gooit(() => valideerDefinitie(null, 'registreren'), 'invalid-argument');
  gooit(() => valideerDefinitie([DEF], 'registreren'), 'invalid-argument');
  gooit(() => valideerDefinitie(new Map(), 'registreren'), 'invalid-argument');
});

// ── eigendom in het id (§3) ────────────────────────────────────────────────

test('namespace: id-vorm per eigenaar, grammatica van plugin-id en key', () => {
  assert.equal(typeIdVoor(EXT, 'mineraal-600x600'), 'ext:test.synthetisch#mineraal-600x600');
  assert.equal(typeIdVoor(MCP, 'a.b_c-d'), 'mcp:a.b_c-d');
  gooit(() => typeIdVoor({ kind: 'extension', extensionId: '-fout' }, 'x'), 'invalid-owner');
  gooit(() => typeIdVoor({ kind: 'extension', extensionId: 'met spatie' }, 'x'), 'invalid-owner');
  gooit(() => typeIdVoor({ kind: 'app' }, 'x'), 'invalid-owner');
  gooit(() => typeIdVoor(EXT, 'Hoofdletter'), 'invalid-key');
  gooit(() => typeIdVoor(EXT, 'eindigt-op-'), 'invalid-key');
  gooit(() => typeIdVoor(EXT, 'x'.repeat(65)), 'invalid-key');
  gooit(() => typeIdVoor(EXT, ''), 'invalid-key');
  assert.deepEqual(eigenaarVanId('ext:test.synthetisch#mineraal-600x600'),
    { kind: 'extension', extensionId: 'test.synthetisch', key: 'mineraal-600x600' });
  assert.deepEqual(eigenaarVanId('mcp:k1'), { kind: 'mcp', key: 'k1' });
  assert.deepEqual(eigenaarVanId('st-plafond-600x600'), { kind: 'app' });
  assert.deepEqual(eigenaarVanId('ext:zonder-key'), { kind: 'app' }, 'een kapot ext-id is van niemand anders');
});

// ── registreren (§6.1) ─────────────────────────────────────────────────────

test('registreren: created, daarna unchanged — idempotent en zonder duplicaat', () => {
  const d0 = createDefaultSysteemTypen();
  const r1 = geregistreerd(d0);
  assert.equal(r1.status, 'created');
  assert.equal(r1.id, 'ext:test.synthetisch#mineraal-600x600');
  assert.equal(r1.type.revisie, 1);
  assert.equal(r1.type.eigenaarRevisie, 1);
  assert.deepEqual(r1.wijziging, { id: r1.id, change: 'added', revision: 1, previousRevision: null });
  assert.equal(r1.data.typen.length, d0.typen.length + 1);
  assert.equal(d0.typen.length, createDefaultSysteemTypen().typen.length, 'de invoer blijft ongemoeid');

  const r2 = geregistreerd(r1.data);
  assert.equal(r2.status, 'unchanged');
  assert.equal(r2.data, r1.data, 'geen nieuwe data');
  assert.equal(r2.wijziging, null);
  assert.equal(r2.data.typen.filter(t => t.id === r1.id).length, 1);
});

test('registreren: een nieuwe catalogusversie vervangt de eigen, onbewerkte definitie', () => {
  const r1 = geregistreerd();
  const r2 = geregistreerd(r1.data, { ...DEF, celYMm: 1200 });
  assert.equal(r2.status, 'updated');
  assert.equal(r2.type.revisie, 2);
  assert.equal(r2.type.eigenaarRevisie, 2);
  assert.equal(r2.type.celYMm, 1200);
  assert.deepEqual(r2.wijziging, { id: r1.id, change: 'updated', revision: 2, previousRevision: 1 });
  assert.equal(r2.data.typen.findIndex(t => t.id === r1.id), r1.data.typen.findIndex(t => t.id === r1.id), 'zelfde plek');
});

test('registreren: een gebruikersbewerking blijft staan (kept-user-edit)', () => {
  const r1 = geregistreerd();
  // De gebruiker bewerkt het type in de editor: revisie +1, eigenaarRevisie blijft.
  const bewerkt = kloon(r1.data);
  const t = findSysteemType(bewerkt, r1.id);
  t.celXMm = 625; t.revisie = 2;
  const r2 = geregistreerd(bewerkt, { ...DEF, celYMm: 1200 });
  assert.equal(r2.status, 'kept-user-edit');
  assert.equal(r2.data, bewerkt);
  assert.equal(r2.type.celXMm, 625);
  assert.equal(r2.wijziging, null);
  // Dezelfde definitie als de gebruiker nu heeft: unchanged, geen kept-user-edit.
  const r3 = geregistreerd(bewerkt, { ...DEF, celXMm: 625 });
  assert.equal(r3.status, 'unchanged');
});

test('registreren: een door de gebruiker verwijderd type komt alleen terug met restore', () => {
  const r1 = geregistreerd();
  const zonder = { ...r1.data, typen: r1.data.typen.filter(t => t.id !== r1.id), verwijderd: [{ id: r1.id, revisie: 1 }] };
  const r2 = geregistreerd(zonder);
  assert.equal(r2.status, 'removed-by-user');
  assert.equal(r2.type, null);
  assert.equal(r2.data, zonder);
  const r3 = planRegistratie(zonder, EXT, 'mineraal-600x600', DEF, { restore: true });
  assert.equal(r3.status, 'created');
  assert.deepEqual(r3.data.verwijderd, []);
  assert.ok(findSysteemType(r3.data, r1.id));
});

test('registreren: opties en schema worden gecontroleerd', () => {
  const d = createDefaultSysteemTypen();
  gooit(() => planRegistratie(d, EXT, 'k', DEF, { schema: 2 }), 'unsupported-version');
  gooit(() => planRegistratie(d, EXT, 'k', DEF, { onbekend: true }), 'invalid-argument');
  gooit(() => planRegistratie(d, EXT, 'k', DEF, { restore: 'ja' }), 'invalid-argument');
  gooit(() => planRegistratie(d, EXT, 'K', DEF), 'invalid-key');
  gooit(() => planRegistratie(d, { kind: 'extension', extensionId: '' }, 'k', DEF), 'invalid-owner');
  assert.equal(planRegistratie(d, EXT, 'k', DEF, { schema: 1 }).status, 'created');
});

test('registreren: een ontbrekende maat blijft weg en is onbevestigd', () => {
  const r = geregistreerd(createDefaultSysteemTypen(), { naam: 'Zonder maten', categorie: 'plafond', layout: 'raster', celXMm: 600 });
  assert.equal(r.status, 'created');
  assert.equal('celYMm' in r.type, false, 'geen standaardmaat ingevuld');
  assert.equal('sparingRegels' in r.type, false);
  const s = publiekeSnapshot(r.type);
  assert.deepEqual(s.unconfirmed, ['celYMm', 'sparingRegels.kleineSparingMaxMm', 'sparingRegels.raveelVanafMm']);
  assert.equal('celYMm' in s.definition, false);
  assert.deepEqual(s.problems, []);
});

// ── bijwerken (§6.3) ───────────────────────────────────────────────────────

test('bijwerken: eigen type met de juiste revisie', () => {
  const r1 = geregistreerd();
  const b = planBijwerking(r1.data, EXT, r1.id, { celYMm: 1200, sparingRegels: { kleineSparingMaxMm: 300 } }, { expectedRevision: 1 });
  assert.equal(b.status, 'updated');
  assert.equal(b.type.revisie, 2);
  assert.equal(b.type.eigenaarRevisie, 2);
  assert.equal(b.type.celYMm, 1200);
  assert.deepEqual(b.type.sparingRegels, { kleineSparingMaxMm: 300 }, 'genest gaat in zijn geheel');
  assert.deepEqual(b.wijziging, { id: r1.id, change: 'updated', revision: 2, previousRevision: 1 });
  // null maakt een maat weer onbevestigd.
  const c = planBijwerking(b.data, EXT, r1.id, { celYMm: null }, { expectedRevision: 2 });
  assert.equal('celYMm' in c.type, false);
});

test('bijwerken: zelfde inhoud geeft unchanged zonder nieuwe data', () => {
  const r1 = geregistreerd();
  const b = planBijwerking(r1.data, EXT, r1.id, { celXMm: 600 }, { expectedRevision: 1 });
  assert.equal(b.status, 'unchanged');
  assert.equal(b.data, r1.data);
  assert.equal(b.wijziging, null);
});

test('bijwerken: not-found, not-owner (app, andere extensie, mcp) en stale-revision', () => {
  const r1 = geregistreerd();
  const m = planRegistratie(r1.data, MCP, 'k1', DEF);
  const d = m.data;
  gooit(() => planBijwerking(d, EXT, 'ext:test.synthetisch#bestaat-niet', { celXMm: 700 }, { expectedRevision: 1 }), 'not-found');
  gooit(() => planBijwerking(d, EXT, 'st-plafond-600x600', { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner');
  gooit(() => planBijwerking(d, ANDER, r1.id, { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner');
  gooit(() => planBijwerking(d, EXT, 'mcp:k1', { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner');
  gooit(() => planBijwerking(d, MCP, r1.id, { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner');
  assert.equal(planBijwerking(d, MCP, 'mcp:k1', { celXMm: 700 }, { expectedRevision: 1 }).status, 'updated');
  const f = gooit(() => planBijwerking(d, EXT, r1.id, { celXMm: 700 }, { expectedRevision: 3 }), 'stale-revision');
  assert.equal(f.currentRevision, 1);
  gooit(() => planBijwerking(d, EXT, r1.id, { celXMm: 700 }, {}), 'invalid-argument');
  gooit(() => planBijwerking(d, EXT, r1.id, { celXMm: 700 }, { expectedRevision: 1.5 }), 'invalid-argument');
  gooit(() => planBijwerking(d, EXT, r1.id, { celXMm: 700 }), 'invalid-argument');
  gooit(() => planBijwerking(d, EXT, r1.id, { celXMm: 700 }, { expectedRevision: 1, schema: 2 }), 'unsupported-version');
  gooit(() => planBijwerking(d, EXT, r1.id, { id: 'x' }, { expectedRevision: 1 }), 'readonly-field');
  gooit(() => planBijwerking(d, EXT, r1.id, { revisie: 9 }, { expectedRevision: 1 }), 'readonly-field');
  gooit(() => planBijwerking(d, EXT, r1.id, { layout: null }, { expectedRevision: 1 }), 'invalid-field');
  // Een genest veld gaat in zijn geheel mee en wordt als geheel gecontroleerd.
  const sp = planBijwerking(d, EXT, r1.id, { sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 } }, { expectedRevision: 1 });
  gooit(() => planBijwerking(sp.data, EXT, r1.id, { sparingRegels: { kleineSparingMaxMm: 900, raveelVanafMm: 800 } }, { expectedRevision: 2 }), 'invalid-field');
});

test('bijwerken: een gedeeltelijke wijziging laat de opgeslagen velden staan, ook lagen en waarden buiten schema 1', () => {
  // Opgeslagen via de tolerante kant (PDF-snapshot, editor): een maat buiten
  // het bereik, sparingsregels met klein > raveel en een niet-lege lagen.
  const d = mergeSysteemType(createDefaultSysteemTypen(), {
    id: 'mcp:y', naam: 'Y', categorie: 'plafond', layout: 'raster', celXMm: 30, celYMm: 600,
    sparingRegels: { kleineSparingMaxMm: 900, raveelVanafMm: 800 }, lagen: [{ dikteMm: 12 }],
    revisie: 1, eigenaarRevisie: 1,
  });
  const voor = JSON.stringify(d);
  const b = planBijwerking(d, MCP, 'mcp:y', { naam: 'Y2' }, { expectedRevision: 1 });
  assert.equal(b.status, 'updated');
  assert.equal(b.type.naam, 'Y2');
  assert.equal(b.type.celXMm, 30, 'geen stil verlies van een opgeslagen maat');
  assert.deepEqual(b.type.sparingRegels, { kleineSparingMaxMm: 900, raveelVanafMm: 800 });
  assert.deepEqual(b.type.lagen, [{ dikteMm: 12 }], 'lagen blijft ongemoeid bewaard');
  assert.equal(JSON.stringify(d), voor, 'de invoer blijft ongemoeid');
  // De snapshot blijft de problemen melden; ze zijn niet weggepoetst.
  assert.deepEqual(publiekeSnapshot(b.type).problems.map(p => p.field).sort(), ['celXMm', 'lagen', 'sparingRegels']);
  // Geen inhoudelijke wijziging: geen nieuwe revisie, dezelfde data.
  const leeg = planBijwerking(d, MCP, 'mcp:y', {}, { expectedRevision: 1 });
  assert.equal(leeg.status, 'unchanged');
  assert.equal(leeg.data, d);
  // Alleen een expliciet gegeven veld vervangt de opgeslagen waarde.
  const l = planBijwerking(d, MCP, 'mcp:y', { lagen: [], celXMm: 600 }, { expectedRevision: 1 });
  assert.deepEqual(l.type.lagen, []);
  assert.equal(l.type.celXMm, 600);
  assert.deepEqual(publiekeSnapshot(l.type).problems.map(p => p.field), ['sparingRegels']);
});

test('bijwerken na een gebruikersbewerking in de editor: de bewerkte maat blijft staan', () => {
  const r1 = geregistreerd();
  // De gebruiker typt in de editor een maat buiten het bereik (de tolerante
  // normalisatie bewaart elke positieve waarde).
  const bewerkt = updateSysteemTypeIn(r1.data, r1.id, { celXMm: 30, sparingRegels: { kleineSparingMaxMm: 900, raveelVanafMm: 800 } });
  assert.equal(findSysteemType(bewerkt, r1.id).revisie, 2);
  const b = planBijwerking(bewerkt, EXT, r1.id, { naam: 'B' }, { expectedRevision: 2 });
  assert.equal(b.status, 'updated');
  assert.equal(b.type.celXMm, 30);
  assert.deepEqual(b.type.sparingRegels, { kleineSparingMaxMm: 900, raveelVanafMm: 800 });
  assert.deepEqual(publiekeSnapshot(b.type).unconfirmed, [], 'niets is onbevestigd geworden');
});

test('revisies lopen per id door, ook na verwijderen en terugzetten (geen ABA)', () => {
  let d = planRegistratie(createDefaultSysteemTypen(), MCP, 'x', DEF).data;
  d = planBijwerking(d, MCP, 'mcp:x', { naam: 'X2' }, { expectedRevision: 1 }).data;
  assert.equal(findSysteemType(d, 'mcp:x').revisie, 2);
  // De gebruiker verwijdert het type in de editor: grafsteen op revisie 2.
  const werk = kloon(d);
  werk.typen = werk.typen.filter(t => t.id !== 'mcp:x');
  const zonder = planEditorToepassen(d, werk, d, []).data;
  assert.deepEqual(zonder.verwijderd, [{ id: 'mcp:x', revisie: 2 }]);
  // Terugzetten begint ná de grafsteen; eigenaarRevisie gaat mee (eigen definitie).
  const r = planRegistratie(zonder, MCP, 'x', DEF, { restore: true });
  assert.equal(r.status, 'created');
  assert.equal(r.type.revisie, 3);
  assert.equal(r.type.eigenaarRevisie, 3);
  assert.deepEqual(r.wijziging, { id: 'mcp:x', change: 'added', revision: 3, previousRevision: null });
  assert.equal(publiekeSnapshot(r.type).userEdited, false);
  // Een snapshot van vóór het verwijderen is verouderd.
  for (const oud of [1, 2]) {
    const f = gooit(() => planBijwerking(r.data, MCP, 'mcp:x', { naam: 'oud' }, { expectedRevision: oud }), 'stale-revision');
    assert.equal(f.currentRevision, 3);
  }
  // Een PDF die het type terugbrengt, begint ook ná de grafsteen; de
  // verhouding revisie/eigenaarRevisie uit de snapshot blijft gelijk.
  const pdf = mergeSysteemType(zonder, { id: 'mcp:x', ...DEF, revisie: 1, eigenaarRevisie: 1 });
  const t = findSysteemType(pdf, 'mcp:x');
  assert.equal(t.revisie, 3);
  assert.equal(t.eigenaarRevisie, 3);
  const pdfBewerkt = findSysteemType(mergeSysteemType(zonder, { id: 'mcp:x', ...DEF, revisie: 4, eigenaarRevisie: 2 }), 'mcp:x');
  assert.equal(pdfBewerkt.revisie, 4, 'al voorbij de grafsteen: ongewijzigd');
  assert.equal(pdfBewerkt.eigenaarRevisie, 2);
  // De editor die een verdwenen, gegraven id terugzet, begint ook ná de grafsteen.
  const basis = kloon(d);
  const werk2 = kloon(d);
  findSysteemType(werk2, 'mcp:x').naam = 'Bewerkt';
  const terug = planEditorToepassen(basis, werk2, zonder, []);
  assert.equal(findSysteemType(terug.data, 'mcp:x').revisie, 3);
});

test('paneeltypen: de grens van 50 geldt voor het opgeslagen assortiment (met tegel)', () => {
  const pt = (n, metTegel) => [
    ...(metTegel ? [{ id: 'tegel', naam: 'Tegel', renderStijl: 'tegel' }] : []),
    ...Array.from({ length: n }, (_, i) => ({ id: `p${i}`, naam: `P${i}`, renderStijl: 'licht' })),
  ];
  // 50 zonder tegel: na het aanvullen 51 → geweigerd, niet stil opgeslagen.
  gooit(() => planRegistratie(createDefaultSysteemTypen(), EXT, 'veel', { ...DEF, paneelTypen: pt(50, false) }),
    'invalid-field', 'paneelTypen');
  const r49 = planRegistratie(createDefaultSysteemTypen(), EXT, 'veel', { ...DEF, paneelTypen: pt(49, false) });
  assert.equal(r49.type.paneelTypen.length, 50);
  const r50 = planRegistratie(createDefaultSysteemTypen(), EXT, 'veel', { ...DEF, paneelTypen: pt(49, true) });
  assert.equal(r50.type.paneelTypen.length, 50);
  // Bijwerken past dezelfde grens toe.
  gooit(() => planBijwerking(r49.data, EXT, r49.id, { paneelTypen: pt(50, false) }, { expectedRevision: 1 }),
    'invalid-field', 'paneelTypen');
  // Een volgende gedeeltelijke wijziging laat het assortiment staan.
  const b = planBijwerking(r49.data, EXT, r49.id, { naam: 'Z2' }, { expectedRevision: 1 });
  assert.deepEqual(b.type.paneelTypen, r49.type.paneelTypen);
});

test('elke geaccepteerde registratie geeft een snapshot zonder problemen', () => {
  const definities = [
    DEF,
    { naam: 'Minimaal', categorie: 'overig', layout: 'raster' },
    { naam: 'Kanaalplaat', categorie: 'vloer', layout: 'strook', strookBreedteMm: 1200, celYMm: 50, ifcCategory: 'IfcSlab',
      ifcPredefinedType: 'FLOOR', sparingRegels: { kleineSparingMaxMm: 10, raveelVanafMm: 20000 } },
    { ...DEF, celXMm: 20000, celYMm: 50, sparingRegels: { raveelVanafMm: 800 }, lagen: [], ifcPredefinedType: null },
    { ...DEF, naam: '  spaties  ', paneelTypen: [{ id: 'licht', naam: ' Licht ', renderStijl: 'licht' }] },
    { ...DEF, paneelTypen: Array.from({ length: 49 }, (_, i) => ({ id: `q-${i}`, naam: `Q${i}`, renderStijl: 'ventilatie' })) },
  ];
  for (const def of definities) {
    const r = planRegistratie(createDefaultSysteemTypen(), EXT, 'k', def);
    assert.equal(r.status, 'created', JSON.stringify(def));
    assert.deepEqual(publiekeSnapshot(r.type).problems, [], JSON.stringify(def));
  }
});

test('elke waarde wordt één keer gelezen: een getter kan de controle niet omzeilen', () => {
  for (let n = 0; n <= 10; n++) {
    let gelezen = 0;
    const paneel = { naam: 'P', renderStijl: 'licht' };
    Object.defineProperty(paneel, 'id', {
      enumerable: true,
      get: () => (gelezen++ < n ? 'okid' : 'Not A Valid Id!'),
    });
    const def = { ...DEF, paneelTypen: [{ id: 'tegel', naam: 'Tegel', renderStijl: 'tegel' }, paneel] };
    let r = null;
    try {
      r = planRegistratie(createDefaultSysteemTypen(), EXT, 'getter', def);
    } catch (e) {
      assert.equal(e.name, 'SystemTypeError', e.message);
      continue;
    }
    assert.deepEqual(r.type.paneelTypen.map(p => p.id), ['tegel', 'okid'], `n=${n}`);
    assert.deepEqual(publiekeSnapshot(r.type).problems, [], `n=${n}`);
  }
  // Ook de opties: expectedRevision wordt één keer gelezen.
  const r1 = geregistreerd();
  let keer = 0;
  const opties = {};
  Object.defineProperty(opties, 'expectedRevision', { enumerable: true, get: () => (keer++ === 0 ? 1 : 99) });
  assert.equal(planBijwerking(r1.data, EXT, r1.id, { celXMm: 700 }, opties).status, 'updated');
});

test('atomair: bij elke afwijzing blijft de data dezelfde referentie en onveranderd', () => {
  const r1 = geregistreerd();
  const voor = JSON.stringify(r1.data);
  for (const poging of [
    () => planBijwerking(r1.data, ANDER, r1.id, { celXMm: 700 }, { expectedRevision: 1 }),
    () => planBijwerking(r1.data, EXT, r1.id, { celXMm: 7 }, { expectedRevision: 1 }),
    () => planBijwerking(r1.data, EXT, r1.id, { celXMm: 700 }, { expectedRevision: 2 }),
    () => planRegistratie(r1.data, EXT, 'k2', { ...DEF, onbekend: 1 }),
  ]) {
    assert.throws(poging);
    assert.equal(JSON.stringify(r1.data), voor);
  }
});

// ── snapshots (§4.2) ───────────────────────────────────────────────────────

test('snapshot: vorm, eigenaar en gebruikersbewerking', () => {
  const r1 = geregistreerd();
  const s = publiekeSnapshot(r1.type, { isExtensionLoaded: (id) => id === 'test.synthetisch' });
  assert.equal(s.id, r1.id);
  assert.equal(s.schema, 1);
  assert.deepEqual(s.owner, { kind: 'extension', extensionId: 'test.synthetisch', key: 'mineraal-600x600', loaded: true });
  assert.equal(s.revision, 1);
  assert.equal(s.ownerRevision, 1);
  assert.equal(s.userEdited, false);
  assert.equal(s.definition.naam, DEF.naam);
  assert.equal(s.definition.edgeProfiel, 'schaduwvoeg');
  assert.deepEqual(s.definition.lagen, []);
  assert.ok(s.definition.paneelTypen.some(p => p.id === 'tegel'));
  assert.equal('revisie' in s.definition, false);
  assert.deepEqual(publiekeSnapshot(r1.type).owner.loaded, false);
  const app = publiekeSnapshot(findSysteemType(createDefaultSysteemTypen(), 'st-plafond-600x600'));
  assert.deepEqual(app.owner, { kind: 'app' });
  assert.equal(app.ownerRevision, null);
  assert.equal(app.userEdited, null);
  assert.deepEqual(app.unconfirmed, []);
  const mcp = publiekeSnapshot(planRegistratie(createDefaultSysteemTypen(), MCP, 'k1', DEF).type);
  assert.deepEqual(mcp.owner, { kind: 'mcp', key: 'k1' });
  // Bewerkt door de gebruiker: revisie > eigenaarRevisie.
  const bewerkt = publiekeSnapshot({ ...r1.type, revisie: 3, eigenaarRevisie: 2 });
  assert.equal(bewerkt.userEdited, true);
  // Zonder eigenaarRevisie (bv. uit een PDF): telt als bewerkt.
  const { eigenaarRevisie, ...zonder } = r1.type;
  assert.equal(eigenaarRevisie, 1);
  assert.equal(publiekeSnapshot(zonder).ownerRevision, 0);
  assert.equal(publiekeSnapshot(zonder).userEdited, true);
});

test('snapshot: losgekoppeld — muteren raakt de bron niet', () => {
  const r1 = geregistreerd();
  const s = publiekeSnapshot(r1.type);
  s.definition.paneelTypen[0].naam = 'gewijzigd';
  s.definition.celXMm = 1;
  assert.notEqual(r1.type.paneelTypen[0].naam, 'gewijzigd');
  assert.equal(r1.type.celXMm, 600);
  assert.notEqual(publiekeSnapshot(r1.type), publiekeSnapshot(r1.type));
});

test('snapshot: opgeslagen rommel komt in problems, niet in de definitie', () => {
  const type = {
    id: 'ext:test.synthetisch#oud', naam: 'Oud', categorie: 'dak', ifcCategory: 'IfcCovering',
    layout: 'raster', celXMm: 30, celYMm: 600, edgeProfiel: 'geen',
    paneelTypen: [{ id: 'tegel', naam: 'Tegel', renderStijl: 'tegel' }],
    lagen: [{ iets: 1 }], revisie: 2, eigenaarRevisie: 2,
  };
  const s = publiekeSnapshot(type);
  assert.equal('categorie' in s.definition, false);
  assert.equal('celXMm' in s.definition, false);
  assert.deepEqual(s.definition.lagen, []);
  const codes = Object.fromEntries(s.problems.map(p => [p.field, p.code]));
  assert.deepEqual(codes, { categorie: 'invalid-field', celXMm: 'invalid-field', lagen: 'unsupported-field' });
  for (const p of s.problems) assert.equal(typeof p.message, 'string');
  // Een onbevestigde maat is geen probleem; een ongeldige wel.
  assert.equal(s.unconfirmed.includes('celXMm'), false);
  assert.ok(s.unconfirmed.includes('sparingRegels.kleineSparingMaxMm'));
});

test('snapshot: de strook-layout vraagt strookbreedte en celmaat Y', () => {
  const r = geregistreerd(createDefaultSysteemTypen(), { naam: 'Kanaalplaat', categorie: 'vloer', layout: 'strook', celXMm: 1200 }, 'kp');
  assert.deepEqual(publiekeSnapshot(r.type).unconfirmed.slice(0, 2), ['strookBreedteMm', 'celYMm']);
});
