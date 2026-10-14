// De native systeemtypen-editor (#567): Toepassen schrijft alleen het verschil
// tegen de basis, omzettingen wachten op Toepassen, en het openen of focussen
// op een type laat onbevestigde wijzigingen staan. Puur: de dialoog roept deze
// functies aan (zie SysteemtypenDialog.jsx).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  planEditorToepassen, planRegistratie, planBijwerking, beginSelectie, focusOpType,
  eigenaarLabel, beheerdDoorTekst, gebruikNaWachtrij,
} from './systeem-typen-contract.js';
import {
  createDefaultSysteemTypen, findSysteemType, normalizeSysteemType, duplicateSysteemType,
  removeSysteemTypeFrom, reassignSysteemType,
} from './systeem-typen.js';

const EXT = { kind: 'extension', extensionId: 'test.synthetisch' };
const DEF = { naam: 'Mineraalplaat', categorie: 'plafond', layout: 'raster', celXMm: 600, celYMm: 600 };
const kloon = (x) => JSON.parse(JSON.stringify(x));

function metExtensietype() {
  return planRegistratie(createDefaultSysteemTypen(), EXT, 'mineraal', DEF);
}

// Een werkkopie bewerken zoals de dialoog dat doet (muteer → normaliseren).
function muteer(werk, id, patch) {
  const i = werk.typen.findIndex(t => t.id === id);
  werk.typen[i] = normalizeSysteemType({ ...werk.typen[i], ...patch, id });
}

test('zonder verschil: leeg plan en dezelfde data', () => {
  const huidig = createDefaultSysteemTypen();
  const basis = kloon(huidig);
  const plan = planEditorToepassen(basis, kloon(basis), huidig, []);
  assert.deepEqual(plan.wijzigingen, []);
  assert.deepEqual(plan.omzettingen, []);
  assert.equal(plan.data, huidig);
});

test('alleen het verschil: één gewijzigd type krijgt revisie +1, de rest blijft', () => {
  const huidig = createDefaultSysteemTypen();
  const basis = kloon(huidig);
  const werk = kloon(basis);
  muteer(werk, 'st-plafond-600x1200', { celYMm: 900 });
  const plan = planEditorToepassen(basis, werk, huidig, []);
  assert.deepEqual(plan.wijzigingen, [{ id: 'st-plafond-600x1200', change: 'updated', revision: 2, previousRevision: 1 }]);
  assert.equal(findSysteemType(plan.data, 'st-plafond-600x1200').celYMm, 900);
  assert.equal(findSysteemType(plan.data, 'st-plafond-600x600'), findSysteemType(huidig, 'st-plafond-600x600'));
});

test('een type dat na het openen geregistreerd is, overleeft Toepassen', () => {
  const huidig0 = createDefaultSysteemTypen();
  const basis = kloon(huidig0);
  const werk = kloon(basis);
  muteer(werk, 'st-plafond-600x600', { naam: 'Hernoemd' });
  const huidig = planRegistratie(huidig0, EXT, 'mineraal', DEF).data; // intussen geregistreerd
  const plan = planEditorToepassen(basis, werk, huidig, []);
  assert.ok(findSysteemType(plan.data, 'ext:test.synthetisch#mineraal'), 'het nieuwe type is er nog');
  assert.equal(findSysteemType(plan.data, 'st-plafond-600x600').naam, 'Hernoemd');
});

test('een onaangeraakt type dat intussen door de extensie is bijgewerkt, overleeft', () => {
  const r = metExtensietype();
  const basis = kloon(r.data);
  const werk = kloon(basis);
  muteer(werk, 'st-plafond-600x600', { celXMm: 625 });
  const huidig = planBijwerking(r.data, EXT, r.id, { celYMm: 1200 }, { expectedRevision: 1 }).data;
  const plan = planEditorToepassen(basis, werk, huidig, []);
  const t = findSysteemType(plan.data, r.id);
  assert.equal(t.celYMm, 1200);
  assert.equal(t.revisie, 2);
  assert.equal(plan.wijzigingen.some(w => w.id === r.id), false);
});

test('bij overlap wint de gebruiker; het eigendomstype is daarna bewerkt', () => {
  const r = metExtensietype();
  const basis = kloon(r.data);
  const werk = kloon(basis);
  muteer(werk, r.id, { celXMm: 650 });
  const huidig = planBijwerking(r.data, EXT, r.id, { celYMm: 1200 }, { expectedRevision: 1 }).data;
  const plan = planEditorToepassen(basis, werk, huidig, []);
  const t = findSysteemType(plan.data, r.id);
  assert.equal(t.celXMm, 650);
  assert.equal(t.celYMm, 600, 'de versie uit de werkkopie');
  assert.equal(t.revisie, 3);
  assert.equal(t.eigenaarRevisie, 2, 'eigenaarrevisie blijft staan');
  assert.deepEqual(plan.wijzigingen, [{ id: r.id, change: 'updated', revision: 3, previousRevision: 2 }]);
});

test('nieuw en gedupliceerd: toegevoegd met revisie 1', () => {
  const huidig = createDefaultSysteemTypen();
  const basis = kloon(huidig);
  const werk = kloon(basis);
  const kopie = duplicateSysteemType(findSysteemType(werk, 'st-plafond-600x600'));
  werk.typen.push(kopie);
  const plan = planEditorToepassen(basis, werk, huidig, []);
  assert.deepEqual(plan.wijzigingen, [{ id: kopie.id, change: 'added', revision: 1, previousRevision: null }]);
  assert.equal(plan.data.typen.at(-1).id, kopie.id);
});

test('verwijderen van een eigendomstype laat een grafsteen achter; van een app-type niet', () => {
  const r = metExtensietype();
  const basis = kloon(r.data);
  let werk = kloon(basis);
  werk = removeSysteemTypeFrom(werk, r.id);
  werk = removeSysteemTypeFrom(werk, 'st-bandraster-300x1200');
  const plan = planEditorToepassen(basis, werk, r.data, []);
  assert.equal(findSysteemType(plan.data, r.id), null);
  assert.deepEqual(plan.data.verwijderd, [{ id: r.id, revisie: 1 }]);
  const verwijderingen = plan.wijzigingen.map(w => [w.id, w.change, w.revision, w.previousRevision]).sort();
  assert.deepEqual(verwijderingen, [
    [r.id, 'removed', null, 1],
    ['st-bandraster-300x1200', 'removed', null, 1],
  ].sort());
});

test('omzettingen staan alleen in het plan van Toepassen; de werkkopie raakt de documenten niet', () => {
  const huidig = createDefaultSysteemTypen();
  const basis = kloon(huidig);
  let werk = kloon(basis);
  const annotaties = [
    { type: 'systeemraster', systeemTypeId: 'st-plafond-600x600' },
    { type: 'systeemraster', systeemTypeId: 'st-plafond-600x600' },
  ];
  const voor = JSON.stringify(annotaties);
  const wachtrij = [{ vanId: 'st-plafond-600x600', naarId: 'st-stelcon-2000x2000' }];
  werk = removeSysteemTypeFrom(werk, 'st-plafond-600x600');
  // Annuleren = de werkkopie en de wachtrij weggooien: niets is aangeraakt.
  assert.equal(JSON.stringify(annotaties), voor);
  assert.equal(findSysteemType(huidig, 'st-plafond-600x600').revisie, 1);
  // Toepassen: de omzetting staat in het plan; uitvoeren doet de aanroeper.
  const plan = planEditorToepassen(basis, werk, huidig, wachtrij);
  assert.deepEqual(plan.omzettingen, wachtrij);
  assert.notEqual(plan.omzettingen, wachtrij, 'een kopie van de wachtrij');
  for (const o of plan.omzettingen) reassignSysteemType(annotaties, o.vanId, findSysteemType(plan.data, o.naarId));
  assert.ok(annotaties.every(a => a.systeemTypeId === 'st-stelcon-2000x2000'));
});

test('in gebruik na de wachtrij: een omzetdoel telt mee voordat er is toegepast', () => {
  const annotaties = [
    { type: 'systeemraster', systeemTypeId: 'a' },
    { type: 'systeemraster', systeemTypeId: 'a' },
    { type: 'systeemraster', systeemTypeId: 'c' },
    { type: 'tekst', systeemTypeId: 'a' },
  ];
  assert.equal(gebruikNaWachtrij(annotaties, [], 'a'), 2);
  assert.equal(gebruikNaWachtrij(annotaties, [{ vanId: 'a', naarId: 'b' }], 'b'), 2);
  assert.equal(gebruikNaWachtrij(annotaties, [{ vanId: 'a', naarId: 'b' }], 'a'), 0);
  assert.equal(gebruikNaWachtrij(annotaties, [{ vanId: 'a', naarId: 'b' }, { vanId: 'b', naarId: 'c' }], 'c'), 3);
});

test('beginselectie: het gevraagde type, anders het eerste', () => {
  const r = metExtensietype();
  assert.equal(beginSelectie(r.data, r.id), r.id);
  assert.equal(beginSelectie(r.data, 'bestaat-niet'), 'st-plafond-600x600');
  assert.equal(beginSelectie(r.data, undefined), 'st-plafond-600x600');
  assert.equal(beginSelectie({ typen: [] }, 'x'), '');
});

test('focus: een type in de werkkopie selecteren laat andere bewerkingen staan', () => {
  const r = metExtensietype();
  const basis = kloon(r.data);
  const werk = kloon(basis);
  muteer(werk, 'st-plafond-600x600', { naam: 'Onbevestigd hernoemd' });
  const f = focusOpType({ basis, werk, huidig: r.data, typeId: r.id });
  assert.equal(f.selectedId, r.id);
  assert.equal(f.werk, werk);
  assert.equal(findSysteemType(f.werk, 'st-plafond-600x600').naam, 'Onbevestigd hernoemd');
});

test('focus: een type dat na het openen geregistreerd is, komt in basis én werkkopie (ongewijzigd)', () => {
  const huidig0 = createDefaultSysteemTypen();
  const basis = kloon(huidig0);
  const werk = kloon(basis);
  muteer(werk, 'st-plafond-600x600', { naam: 'Onbevestigd hernoemd' });
  const r = planRegistratie(huidig0, EXT, 'mineraal', DEF);
  const f = focusOpType({ basis, werk, huidig: r.data, typeId: r.id });
  assert.equal(f.selectedId, r.id);
  assert.deepEqual(findSysteemType(f.basis, r.id), findSysteemType(r.data, r.id));
  assert.deepEqual(findSysteemType(f.werk, r.id), findSysteemType(r.data, r.id));
  assert.notEqual(findSysteemType(f.werk, r.id), findSysteemType(f.basis, r.id), 'losse kopieën');
  assert.equal(findSysteemType(f.werk, 'st-plafond-600x600').naam, 'Onbevestigd hernoemd');
  // Het opgehaalde type is niet gewijzigd: Toepassen schrijft alleen de hernoeming.
  const plan = planEditorToepassen(f.basis, f.werk, r.data, []);
  assert.deepEqual(plan.wijzigingen.map(w => w.id), ['st-plafond-600x600']);
  // Onbekend id, of een type dat de gebruiker in de werkkopie verwijderde: geen focus.
  assert.equal(focusOpType({ basis, werk, huidig: r.data, typeId: 'bestaat-niet' }), null);
  const zonder = removeSysteemTypeFrom(werk, 'st-plafond-600x1200');
  assert.equal(focusOpType({ basis, werk: zonder, huidig: r.data, typeId: 'st-plafond-600x1200' }), null);
});

test('eigenaarlabel en beheerd-door-regel', () => {
  const r = metExtensietype();
  const t = findSysteemType(r.data, r.id);
  assert.equal(eigenaarLabel(t, () => true), ' (extensie test.synthetisch)');
  assert.equal(eigenaarLabel(t, () => false), ' (extensie test.synthetisch, niet geladen)');
  assert.equal(eigenaarLabel({ id: 'mcp:k' }, () => false), ' (MCP)');
  assert.equal(eigenaarLabel(findSysteemType(r.data, 'st-plafond-600x600'), () => true), '');
  assert.equal(beheerdDoorTekst(t), 'Beheerd door extensie test.synthetisch; wijzigingen hier gelden als gebruikersbewerking');
  assert.equal(beheerdDoorTekst({ id: 'mcp:k' }), 'Beheerd door MCP; wijzigingen hier gelden als gebruikersbewerking');
  assert.equal(beheerdDoorTekst({ id: 'st-x' }), null);
});
