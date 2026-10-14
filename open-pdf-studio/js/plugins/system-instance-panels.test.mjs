// Formulieren van extensies voor native systeem-instances (#574).
//
// Twee synthetische instances van hetzelfde native systeemtype, waarvan er
// één aan de extensie gekoppeld is: alleen die toont het formulier, de
// gewone houdt het native paneel. Wisselen tussen gekoppelde instances
// ververst het formulier; Annuleren en een verouderde revisie wijzigen niets;
// Toepassen is één undo-stap; uitzetten herstelt het native gedrag zonder
// luisteraars achter te laten. Hoeveelheden komen uit de geometriesnapshot.
// Tot slot dezelfde diensten als MCP-opdrachten (#575), zonder DOM.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');
const { createSystemInstanceApi } = await laad('./system-instance-api.js');
const { maakInstancePaneelRegister, maakPaneelHost, instancePanelen } = await laad('./system-instance-panels.js');
const { gestructureerdeOpdrachten } = await laad('./structured-commands.js');
const { onAnySelectionChange, fireSelectionChange } = await laad('./selection-listener-registry.js');
const links = await laad('../annotations/systeem-instance-links.js');
const { systeemGeometrie } = await laad('../annotations/systeem-geometrie.js');
const { normalizeSysteemType } = await laad('../annotations/systeem-typen.js');
const { PDFDocument, PDFName } = await import('pdf-lib');
const { extractAnnotationColors } = await laad('../pdf/loader/color-extraction.js');
const { pdfTextString } = await laad('../pdf/saver/pdf-text.js');

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const kloon = (v) => JSON.parse(JSON.stringify(v));
const wacht = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const EXT = 'nl.test.technisch';
const K = 0.1;

const PLAFOND = normalizeSysteemType({
  id: 'st-test-600', naam: 'Mineraal', categorie: 'plafond', ifcCategory: 'IfcCovering',
  ifcPredefinedType: 'CEILING', layout: 'raster', celXMm: 600, celYMm: 600,
});
const ANDER = normalizeSysteemType({
  id: 'st-test-625', naam: 'Metaal', categorie: 'plafond', ifcCategory: 'IfcCovering',
  ifcPredefinedType: 'CEILING', layout: 'raster', celXMm: 625, celYMm: 625,
});
const TYPEN = { [PLAFOND.id]: PLAFOND, [ANDER.id]: ANDER };

function instance(id, extra = {}) {
  return {
    id, type: 'systeemraster', page: 1, systeemTypeId: PLAFOND.id, ifcCategory: 'IfcCovering',
    points: [{ x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 340 }, { x: 100, y: 340 }],
    system: { type: 'plafond', layers: [{ panels: { '1,1': 'licht' }, edge: { profiel: 'geen' } }] },
    ...extra,
  };
}

/** Een document met twee instances van hetzelfde type; alleen sg-a is gekoppeld. */
function opzet() {
  const doc = {
    id: 'doc-1',
    annotations: [
      instance('sg-a', { extensionLinks: { [EXT]: { revision: 1, data: { system: 'p-600', labels: false } } } }),
      instance('sg-b'),
      instance('sg-c', { extensionLinks: { [EXT]: { revision: 1, data: { system: 'p-625', labels: true } } } }),
      { id: 'tekst', type: 'textbox', page: 1 },
    ],
  };
  const undo = [];
  const host = {
    actiefDocument: () => doc,
    geometrieRevisie: (ann) => `g1-${JSON.stringify(ann.points)}`,
    geometrie: (id) => {
      const ann = doc.annotations.find((a) => a.id === id);
      return systeemGeometrie({ documentId: doc.id, ann, pxPerMm: K, typeDef: TYPEN[ann.systeemTypeId] ?? null });
    },
    typeSnapshot: (id) => (TYPEN[id] ? { id, revision: 1, definition: { naam: TYPEN[id].naam } } : null),
    typeDefinitie: (id) => TYPEN[id] ?? null,
    wijzig(_doc, ann, muteer) {
      const voor = kloon(ann);
      muteer(ann);
      undo.push({ id: ann.id, voor, na: kloon(ann) });
    },
  };
  const ongedaan = () => {
    const stap = undo.pop();
    const ann = doc.annotations.find((a) => a.id === stap.id);
    for (const k of Object.keys(ann)) delete ann[k];
    Object.assign(ann, kloon(stap.voor));
  };
  return { doc, host, undo, ongedaan, ann: (id) => doc.annotations.find((a) => a.id === id) };
}

// ─── Koppelingen, revisie en opslag ────────────────────────────────────────

test('koppelingen: alleen geldige items, en ze komen ongeschonden door opslaan en laden', async () => {
  assert.equal(links.normaliseerLinks({ 'nl.x': { revision: 0, data: {} } }), undefined);
  assert.equal(links.normaliseerLinks({ 'nl.x': { revision: 1, data: [] } }), undefined);
  assert.equal(links.normaliseerLinks({ ' kapot': { revision: 1, data: {} } }), undefined);
  const groot = { tekst: 'x'.repeat(links.MAX_LINK_DATA) };
  assert.equal(links.normaliseerLinks({ 'nl.x': { revision: 1, data: groot } }), undefined, 'te groot');
  const ann = instance('sg-1', { extensionLinks: {
    [EXT]: { revision: 3, data: { system: 'Plafond Ø600 — €12/m²', labels: true } },
    'nl.ander': { revision: 1, data: {} },
    'kapot id': { revision: 1, data: {} },
  } });
  // Zoals saver.js: OPS_SgExtLinks naast de systeemsleutels; terug met de echte loader.
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 800]);
  const ctx = doc.context;
  const woordenboek = {
    Type: 'Annot', Subtype: 'Polygon', Rect: [98, 458, 462, 702],
    Vertices: [100, 700, 460, 700, 460, 460, 100, 460],
    OPS_Subtype: pdfTextString('systeemraster'),
    OPS_SgExtLinks: pdfTextString(links.linksNaarJson(ann)),
  };
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj(woordenboek))]));
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(await doc.save()));
  const extra = [...kaart.values()][0];
  assert.deepEqual(links.linksUitJson(extra.sgExtLinksJson), {
    'nl.ander': { revision: 1, data: {} },
    [EXT]: { revision: 3, data: { system: 'Plafond Ø600 — €12/m²', labels: true } },
  });
  assert.equal(links.linksUitJson('geen json'), undefined);
  // De bron: saver, kleurextractie en converter gebruiken dezelfde sleutel.
  assert.match(lees('../pdf/saver.js'), /const sgLinksJson = linksNaarJson\(ann\);\n\s*if \(sgLinksJson\) sgDict\.OPS_SgExtLinks = pdfTextString\(sgLinksJson\);/);
  assert.match(lees('../pdf/loader/color-extraction.js'), /srStr\('OPS_SgExtLinks'\)/);
  assert.match(lees('../pdf/loader/annotation-converter.js'), /extensionLinks: linksUitJson\(extraColors\.sgExtLinksJson\)/);
});

test('de instancerevisie volgt geometrie, type, tag, vergrendeling en koppelingen', () => {
  const ann = instance('sg-1');
  const r = () => links.instanceRevisie(ann, 'g1-x');
  const begin = r();
  assert.match(begin, /^i1-[0-9a-f]{14}$/);
  assert.equal(r(), begin, 'stabiel');
  assert.notEqual(links.instanceRevisie(ann, 'g1-y'), begin);
  for (const wijzig of [(a) => { a.systeemTypeId = ANDER.id; }, (a) => { a.tagTonen = false; }, (a) => { a.locked = true; },
    (a) => { a.extensionLinks = { [EXT]: { revision: 1, data: {} } }; }]) {
    const b = instance('sg-1');
    wijzig(b);
    assert.notEqual(links.instanceRevisie(b, 'g1-x'), begin);
  }
  // De typekeuze van het eigenschappenpaneel en van de API is dezelfde regel.
  const c = instance('sg-1', { ifcCategory: 'IfcWall' });
  links.kenSysteemTypeToe(c, ANDER.id, ANDER);
  assert.deepEqual([c.systeemTypeId, c.ifcCategory, c.ifcPredefinedType], [ANDER.id, 'IfcCovering', 'CEILING']);
  assert.match(lees('../solid/stores/propertiesStore.js'), /case 'sgTypeId':\n\s*\/\/[^\n]*\n\s*kenSysteemTypeToe\(ann, value \|\| undefined, getSysteemTypeById\(value \|\| undefined\)\);/);
});

test('hoeveelheden komen uit de geometriesnapshot, ook onbevestigd zonder verzonnen aantallen', () => {
  const ann = instance('sg-1');
  const geo = systeemGeometrie({ documentId: 'doc-1', ann, pxPerMm: K, typeDef: PLAFOND });
  const h = links.systeemHoeveelheden(geo);
  assert.equal(h.confirmed, true);
  assert.deepEqual(h.units, { area: 'm2', length: 'm' });
  assert.equal(h.area, 8.64);
  assert.equal(h.perimeter, 12);
  assert.equal(h.panels.total, geo.panels.length);
  assert.equal(h.panels.full + h.panels.edge, h.panels.total);
  assert.equal(h.panels.byType.licht, 1);
  assert.equal(h.document.revision, geo.document.revision);
  const onbevestigd = normalizeSysteemType({ id: 'st-leeg', naam: 'Leeg', categorie: 'plafond', layout: 'raster' });
  const h2 = links.systeemHoeveelheden(systeemGeometrie({ documentId: 'doc-1', ann: instance('sg-2', { systeemTypeId: 'st-leeg' }), pxPerMm: K, typeDef: onbevestigd }));
  assert.equal(h2.confirmed, false);
  assert.equal(h2.panels.total, 0, 'geen panelen bij een onbevestigde maat');
  assert.ok(h2.unconfirmed.includes('celXMm'));
  assert.equal(h2.area, 8.64, 'de contour blijft');
});

// ─── De API ────────────────────────────────────────────────────────────────

test('snapshots zijn losgekoppeld en tonen alleen de eigen gegevens', () => {
  const { host, ann } = opzet();
  const api = createSystemInstanceApi(EXT, host);
  const ander = createSystemInstanceApi('nl.test.ander', host);
  const s = api.getSystemInstance('sg-a');
  assert.deepEqual(s.link, { revision: 1, data: { system: 'p-600', labels: false } });
  assert.deepEqual(s.native, { systemTypeId: PLAFOND.id, showTag: true, ifcCategory: 'IfcCovering' });
  assert.deepEqual(s.type, { id: PLAFOND.id, revision: 1, definition: { naam: 'Mineraal' } });
  s.link.data.system = 'gewijzigd';
  s.native.showTag = false;
  assert.equal(ann('sg-a').extensionLinks[EXT].data.system, 'p-600', 'de snapshot is een kopie');
  const o = ander.getSystemInstance('sg-a');
  assert.equal(o.link, null);
  assert.deepEqual(o.linkedExtensions, [EXT], 'wel wie gekoppeld is, niet de gegevens');
  assert.equal(api.getSystemInstance('tekst'), null, 'alleen systemen');
  assert.deepEqual(api.listSystemInstances().map((i) => [i.annotationId, i.linked]), [['sg-a', true], ['sg-b', false], ['sg-c', true]]);
});

test('koppelen, wijzigen en loskoppelen: revisiecontrole, native validatie en één undo-stap per keer', () => {
  const { host, ann, undo, ongedaan } = opzet();
  const api = createSystemInstanceApi(EXT, host);
  const b = api.getSystemInstance('sg-b');
  // Verouderd: er verandert niets.
  assert.throws(() => api.linkSystemInstance('sg-b', { expectedRevision: 'i1-oud', data: {} }), (e) => e.code === 'stale-revision' && e.currentRevision === b.revision);
  assert.equal(undo.length, 0);
  const gekoppeld = api.linkSystemInstance('sg-b', { expectedRevision: b.revision, data: { system: 'p-600' } });
  assert.equal(gekoppeld.status, 'linked');
  assert.notEqual(gekoppeld.instance.revision, b.revision);
  assert.equal(undo.length, 1);
  // Wijzigen: data, type en tag samen, als één stap.
  const r = api.updateSystemInstance('sg-b', {
    expectedRevision: gekoppeld.instance.revision, data: { system: 'p-625', labels: true }, systemTypeId: ANDER.id, showTag: false,
  });
  assert.equal(r.status, 'updated');
  assert.deepEqual(r.instance.link, { revision: 2, data: { system: 'p-625', labels: true } });
  assert.deepEqual([ann('sg-b').systeemTypeId, ann('sg-b').ifcPredefinedType, ann('sg-b').tagTonen], [ANDER.id, 'CEILING', false]);
  assert.equal(undo.length, 2);
  // Ongedaan maken herstelt de vorige toestand, ook de revisie.
  ongedaan();
  assert.equal(api.getSystemInstance('sg-b').revision, gekoppeld.instance.revision);
  assert.equal(ann('sg-b').systeemTypeId, PLAFOND.id);
  // Native validatie: onbekend type, verkeerde waarden, vergrendeld, niet gekoppeld.
  const nu = api.getSystemInstance('sg-b').revision;
  assert.throws(() => api.updateSystemInstance('sg-b', { expectedRevision: nu, systemTypeId: 'st-bestaat-niet' }), (e) => e.code === 'unknown-type');
  assert.throws(() => api.updateSystemInstance('sg-b', { expectedRevision: nu, showTag: 'ja' }), (e) => e.code === 'invalid-argument');
  assert.throws(() => api.updateSystemInstance('sg-b', { expectedRevision: nu, kleur: 'rood' }), (e) => e.code === 'invalid-argument');
  assert.throws(() => api.updateSystemInstance('sg-b', { expectedRevision: nu, data: { f: () => 1 } }), (e) => e.code === 'invalid-argument');
  const ander = createSystemInstanceApi('nl.test.ander', host);
  assert.throws(() => ander.updateSystemInstance('sg-b', { expectedRevision: nu, showTag: false }), (e) => e.code === 'not-linked');
  ann('sg-c').locked = true;
  const c = api.getSystemInstance('sg-c');
  assert.throws(() => api.updateSystemInstance('sg-c', { expectedRevision: c.revision, showTag: false }), (e) => e.code === 'locked');
  assert.equal(api.updateSystemInstance('sg-b', { expectedRevision: nu, showTag: true }).status, 'unchanged');
  const voor = undo.length;
  const los = api.unlinkSystemInstance('sg-b', { expectedRevision: nu });
  assert.equal(los.status, 'unlinked');
  assert.equal('extensionLinks' in ann('sg-b'), false);
  assert.equal(undo.length, voor + 1);
  api.dispose();
  assert.throws(() => api.linkSystemInstance('sg-b', { expectedRevision: los.instance.revision }), (e) => e.code === 'disposed');
  assert.ok(api.getSystemInstance('sg-b'), 'lezen blijft werken');
});

// ─── Het paneel ────────────────────────────────────────────────────────────

/** Een paneel dat bijhoudt wat het tekent en opruimt. */
function technischPaneel(log, matches = 'linked') {
  return {
    id: 'technisch', title: { en: 'Technical', nl: 'Technisch' }, matches,
    render(container, ctx) {
      container.getekend = ctx.instance.annotationId;
      log.push(['render', ctx.instance.annotationId, ctx.instance.link?.data?.system ?? null]);
      container.ctx = ctx;
      return () => log.push(['opruimen', ctx.instance.annotationId, ctx.signal.aborted]);
    },
  };
}

function paneelOpzet() {
  const o = opzet();
  const reg = maakInstancePaneelRegister();
  const host = maakPaneelHost({
    register: reg,
    snapshotVoor: (extId, id) => createSystemInstanceApi(extId, o.host).getSystemInstance(id),
    pasToe: (extId, id, changes) => createSystemInstanceApi(extId, o.host).updateSystemInstance(id, changes),
    taal: () => 'nl',
  });
  const stop = reg.abonneer(() => host.ververs());
  const containers = new Map();
  // Zoals ScopedInstancePanels.jsx: elke nieuwe sessie krijgt een container.
  const teken = () => {
    for (const s of host.sessies()) {
      if (!containers.has(s.sleutel)) {
        const c = {};
        containers.set(s.sleutel, c);
        host.mount(s.sleutel, c);
      }
    }
    return host.sessies();
  };
  return { ...o, reg, host, teken, containers, stop };
}

test('alleen de gekoppelde instance toont het formulier; de gewone houdt het native paneel', () => {
  const { reg, host, teken } = paneelOpzet();
  const log = [];
  reg.voegToe(reg.controleer(EXT, technischPaneel(log)));
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  let sessies = teken();
  assert.equal(sessies.length, 1);
  assert.equal(sessies[0].titel, 'Technisch');
  assert.deepEqual(log, [['render', 'sg-a', 'p-600']]);
  host.toon({ documentId: 'doc-1', annotationId: 'sg-b' });
  sessies = teken();
  assert.equal(sessies.length, 0, 'gewone instance: geen formulier');
  assert.deepEqual(log.at(-1), ['opruimen', 'sg-a', true], 'opgeruimd met afgebroken signaal');
  // Wisselen tussen gekoppelde instances ververst het formulier.
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  teken();
  host.toon({ documentId: 'doc-1', annotationId: 'sg-c' });
  teken();
  assert.deepEqual(log.slice(-3), [['render', 'sg-a', 'p-600'], ['opruimen', 'sg-a', true], ['render', 'sg-c', 'p-625']]);
  // Deselecteren en een documentwissel (selectie null) ruimen ook op.
  host.toon(null);
  assert.deepEqual(log.at(-1), ['opruimen', 'sg-c', true]);
  assert.equal(teken().length, 0);
});

test('Annuleren en een verouderde revisie wijzigen niets; Toepassen is één undo-stap', async () => {
  const { reg, host, teken, containers, ann, undo, ongedaan } = paneelOpzet();
  const log = [];
  reg.voegToe(reg.controleer(EXT, technischPaneel(log)));
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  let [s] = teken();
  let ctx = containers.get(s.sleutel).ctx;
  // Werkversie en Annuleren: niets geschreven, het formulier laadt opnieuw.
  ctx.setDraft({ data: { system: 'p-625', labels: true } });
  assert.equal(host.sessies()[0].dirty, true);
  assert.throws(() => ctx.setDraft({ kleur: 'rood' }), /unknown field/);
  ctx.cancel();
  [s] = teken();
  assert.equal(s.dirty, false);
  assert.equal(undo.length, 0);
  assert.equal(ann('sg-a').extensionLinks[EXT].data.system, 'p-600');
  assert.deepEqual(log.slice(-2), [['opruimen', 'sg-a', true], ['render', 'sg-a', 'p-600']]);
  // Elders gewijzigd (bijvoorbeeld via MCP): Toepassen weigert, niets verandert.
  ctx = containers.get(s.sleutel).ctx;
  ctx.setDraft({ showTag: false });
  ann('sg-a').points = ann('sg-a').points.map((p) => ({ x: p.x + 10, y: p.y }));
  const voor = kloon(ann('sg-a'));
  const r = await host.pasToe(s.sleutel);
  assert.equal(r.code, 'stale-revision');
  assert.deepEqual(ann('sg-a'), voor);
  assert.equal(undo.length, 0);
  [s] = teken();
  assert.deepEqual(s.melding, { soort: 'stale' }, 'het nieuwe formulier meldt het');
  // Toepassen: één stap, nieuwe revisie, formulier opnieuw met de nieuwe waarden.
  ctx = containers.get(s.sleutel).ctx;
  ctx.setDraft({ data: { system: 'p-625', labels: true } });
  const ok = await ctx.apply();
  assert.equal(ok.ok, true);
  assert.equal(undo.length, 1);
  assert.equal(ann('sg-a').extensionLinks[EXT].data.system, 'p-625');
  [s] = teken();
  assert.deepEqual(log.at(-1), ['render', 'sg-a', 'p-625']);
  // Ongedaan maken: de app meldt de selectie opnieuw; het formulier volgt.
  ongedaan();
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  teken();
  assert.deepEqual(log.at(-1), ['render', 'sg-a', 'p-600']);
});

test('een wijziging elders terwijl er een werkversie openstaat: het formulier laadt opnieuw en meldt het', () => {
  const { reg, host, teken, containers, ann } = paneelOpzet();
  const log = [];
  reg.voegToe(reg.controleer(EXT, technischPaneel(log)));
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  let [s] = teken();
  containers.get(s.sleutel).ctx.setDraft({ showTag: false });
  ann('sg-a').tagTonen = false; // bijvoorbeeld via MCP; de app meldt de selectie opnieuw
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  [s] = teken();
  assert.deepEqual(s.melding, { soort: 'stale' });
  assert.equal(s.dirty, false, 'de werkversie is vervallen');
  // Zonder werkversie geen melding.
  ann('sg-a').tagTonen = true;
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  [s] = teken();
  assert.equal(s.melding, null);
});

test('uitzetten herstelt het native gedrag en laat geen luisteraars achter', () => {
  const { reg, host, teken, stop } = paneelOpzet();
  const log = [];
  reg.voegToe(reg.controleer(EXT, technischPaneel(log)));
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  teken();
  reg.verwijder(EXT, 'technisch');
  assert.deepEqual(log.at(-1), ['opruimen', 'sg-a', true]);
  assert.equal(teken().length, 0);
  stop();
  host.sluit();
  assert.equal(reg.aantalLuisteraars(), 0);
  assert.equal(reg.aantal(), 0);
});

test('conflicten zijn bepaald: niets wordt vervangen, de volgorde ligt vast', () => {
  const { reg, host, teken } = paneelOpzet();
  const log = [];
  reg.voegToe(reg.controleer('nl.test.zz', { ...technischPaneel(log, 'linkedOrOwnedType'), id: 'b', title: 'ZZ' }));
  reg.voegToe(reg.controleer(EXT, { ...technischPaneel(log), id: 'b', title: 'Eigen b' }));
  reg.voegToe(reg.controleer(EXT, { ...technischPaneel(log), id: 'a', title: 'Eigen a', order: 5 }));
  assert.throws(() => reg.voegToe(reg.controleer(EXT, { ...technischPaneel(log), id: 'b' })), (e) => e.code === 'CONTRIBUTION_CONFLICT');
  // Een eigen predicaat krijgt een bevroren kopie; een gooiend predicaat past niet.
  let gezien = null;
  reg.voegToe(reg.controleer('nl.test.pred', { ...technischPaneel(log, (s) => { gezien = s; return s.native.showTag === true; }), id: 'p', title: 'Pred', order: 10 }));
  reg.voegToe(reg.controleer('nl.test.fout', { ...technischPaneel(log, () => { throw new Error('kapot'); }), id: 'f', title: 'Fout' }));
  host.toon({ documentId: 'doc-1', annotationId: 'sg-a' });
  const titels = teken().map((s) => s.titel);
  assert.deepEqual(titels, ['Eigen b', 'Eigen a', 'Pred'], 'order, dan extensie-id, dan paneel-id; zz is niet gekoppeld');
  assert.ok(Object.isFrozen(gezien) && Object.isFrozen(gezien.native));
  assert.throws(() => reg.controleer(EXT, { ...technischPaneel(log), id: 'Hoofd' }), (e) => e.code === 'INVALID_CONTRIBUTION');
  assert.throws(() => reg.controleer(EXT, { ...technischPaneel(log), id: 'x', matches: 'alles' }), (e) => e.code === 'INVALID_CONTRIBUTION');
});

test('ownedType: een instance met een type van de extensie, zonder koppeling', () => {
  const o = opzet();
  o.ann('sg-b').systeemTypeId = `ext:${EXT}#kanaal`;
  const reg = maakInstancePaneelRegister();
  const log = [];
  reg.voegToe(reg.controleer(EXT, { ...technischPaneel(log, 'ownedType'), id: 'eigen' }));
  const passend = reg.passend((extId) => createSystemInstanceApi(extId, o.host).getSystemInstance('sg-b'));
  assert.deepEqual(passend.map((p) => p.entry.id), ['eigen']);
  assert.equal(reg.passend((extId) => createSystemInstanceApi(extId, o.host).getSystemInstance('sg-a')).length, 0);
  // Een eigen type mag de extensie ook wijzigen; eigen data maakt de koppeling.
  const api = createSystemInstanceApi(EXT, o.host);
  const s = api.getSystemInstance('sg-b');
  assert.equal(s.ownedType, true);
  const r = api.updateSystemInstance('sg-b', { expectedRevision: s.revision, data: { system: 'p-600' } });
  assert.deepEqual(r.instance.link, { revision: 1, data: { system: 'p-600' } });
  const ander = createSystemInstanceApi('nl.test.ander', o.host);
  assert.throws(() => ander.updateSystemInstance('sg-b', { expectedRevision: r.instance.revision, showTag: false }), (e) => e.code === 'not-linked');
});

// ─── De plug-in-API ────────────────────────────────────────────────────────

test('registerSystemInstancePanel via de plug-in-API; _cleanup haalt het weg', () => {
  const api = createPluginApi(EXT);
  assert.equal(api.features.scopedPropertyPanels, true);
  assert.equal(api.features.systemInstanceLinks, true);
  assert.deepEqual(api.registerSystemInstancePanel(technischPaneel([])), { id: 'technisch' });
  assert.throws(() => api.registerSystemInstancePanel(technischPaneel([])), (e) => e.code === 'CONTRIBUTION_CONFLICT');
  assert.deepEqual(api._bijdragenOverzicht().systemInstancePanels, ['technisch']);
  api._cleanup();
  assert.equal(instancePanelen.aantal(), 0);
  assert.throws(() => api.registerSystemInstancePanel({ ...technischPaneel([]), id: 'laat' }), (e) => e.code === 'EXTENSION_INACTIVE');
});

test('registerPropertyPanel vervangt het paneel van een andere extensie niet meer stil', () => {
  const a = createPluginApi('nl.test.paneel-a');
  const b = createPluginApi('nl.test.paneel-b');
  a.registerPropertyPanel('nl.test.paneel-a:type', () => 'a');
  a.registerPropertyPanel('nl.test.paneel-a:type', () => 'a2'); // de eigen registratie mag opnieuw
  assert.throws(() => b.registerPropertyPanel('nl.test.paneel-a:type', () => 'b'), (e) => e.code === 'CONTRIBUTION_CONFLICT');
  assert.deepEqual(a._bijdragenOverzicht().propertyPanels, ['nl.test.paneel-a:type']);
  a._cleanup();
  b.registerPropertyPanel('nl.test.paneel-a:type', () => 'b');
  b._cleanup();
});

test('de selectiemelding gaat ook naar algemene luisteraars (verversen, deselecteren, tabwissel)', () => {
  const gezien = [];
  const stop = onAnySelectionChange((a) => gezien.push(a?.id ?? null));
  fireSelectionChange({ id: 'sg-a', type: 'systeemraster' });
  fireSelectionChange(null);
  stop();
  fireSelectionChange({ id: 'sg-b', type: 'systeemraster' });
  assert.deepEqual(gezien, ['sg-a', null]);
});

// ─── Dezelfde diensten via MCP (#575) ──────────────────────────────────────

test('MCP: eigenschappen lezen en toepassen, een projectsysteem kiezen en labels schakelen, zonder DOM', async () => {
  const o = opzet();
  globalThis.__actiefDocument = o.doc;
  globalThis.__systeemGeometrie = (id) => o.host.geometrie(id);
  globalThis.__undoStappen = [];
  const api = createPluginApi(EXT);
  // De dienstcode van de extensie: dezelfde voor haar formulier en voor MCP.
  const dienst = {
    lees: (id) => {
      const s = api.getSystemInstance(id);
      const h = api.getSystemInstanceQuantities(id);
      return { revision: s.revision, linked: Boolean(s.link), data: s.link?.data ?? null,
        areaM2: h.area, panels: h.panels.total, confirmed: h.confirmed };
    },
    wijzig: (id, revisie, wijziging) => {
      const s = api.getSystemInstance(id);
      if (s.revision !== revisie) throw Object.assign(new Error('stale instance'), { code: 'STALE_REVISION', details: { currentRevision: s.revision } });
      return api.updateSystemInstance(id, { expectedRevision: revisie, ...wijziging(s) }).instance.revision;
    },
  };
  const ID = { type: 'string', minLength: 1 };
  // Projectsystemen van de extensie, gekoppeld aan native typen van de app.
  const PROJECTSYSTEMEN = { 'p-600': 'st-plafond-600x600', 'p-625': 'st-plafond-600x1200' };
  const UIT_LEZEN = { type: 'object', properties: {
    revision: { type: 'string' }, linked: { type: 'boolean' }, data: { type: ['object', 'null'], additionalProperties: true },
    areaM2: { type: 'number' }, panels: { type: 'integer' }, confirmed: { type: 'boolean' } } };
  const UIT_REV = { type: 'object', properties: { revision: { type: 'string' } }, required: ['revision'] };
  const t = {};
  t.lees = api.registerCommand({ name: 'get_instance_properties', description: 'Read the technical properties of a system.',
    inputSchema: { type: 'object', properties: { annotationId: ID }, required: ['annotationId'] }, outputSchema: UIT_LEZEN,
    handler: async ({ annotationId }) => dienst.lees(annotationId) }).tool;
  t.systeem = api.registerCommand({ name: 'select_project_system', description: 'Select the project system of a linked system.', effect: 'mutate',
    inputSchema: { type: 'object', properties: { annotationId: ID, system: { type: 'string', enum: ['p-600', 'p-625'] } }, required: ['annotationId', 'system'] },
    outputSchema: UIT_REV,
    handler: async ({ annotationId, system }, ctx) => ({ revision: dienst.wijzig(annotationId, ctx.revisionContext.sourceRevision,
      (s) => ({ data: { ...s.link.data, system }, systemTypeId: PROJECTSYSTEMEN[system] })) }) }).tool;
  t.labels = api.registerCommand({ name: 'toggle_quantity_labels', description: 'Show or hide the quantity labels of a linked system.', effect: 'mutate',
    inputSchema: { type: 'object', properties: { annotationId: ID, visible: { type: 'boolean' } }, required: ['annotationId', 'visible'] },
    outputSchema: UIT_REV,
    handler: async ({ annotationId, visible }, ctx) => ({ revision: dienst.wijzig(annotationId, ctx.revisionContext.sourceRevision,
      (s) => ({ data: { ...s.link.data, labels: visible } })) }) }).tool;
  const roep = (tool, args) => gestructureerdeOpdrachten.roepAan(tool, args, { source: 'mcp' });

  const gelezen = await roep(t.lees, { annotationId: 'sg-a' });
  assert.equal(gelezen.ok, true);
  assert.deepEqual([gelezen.result.linked, gelezen.result.areaM2, gelezen.result.confirmed], [true, 8.64, true]);
  const rev = gelezen.result.revision;
  const keuze = { annotationId: 'sg-a', system: 'p-625', idempotencyKey: 'systeem-0001', revisionContext: { sourceRevision: rev } };
  const r1 = await roep(t.systeem, keuze);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(o.ann('sg-a').systeemTypeId, 'st-plafond-600x1200', 'een type uit de echte bibliotheek');
  assert.equal((await roep(t.systeem, keuze)).replayed, true, 'herhaald: geen tweede wijziging');
  assert.equal(globalThis.__undoStappen.length, 1);
  // De oude revisie is nu verouderd; de handler weigert.
  const oud = await roep(t.labels, { annotationId: 'sg-a', visible: true, idempotencyKey: 'labels-0001', revisionContext: { sourceRevision: rev } });
  assert.equal(oud.code, 'STALE_REVISION');
  const r2 = await roep(t.labels, { annotationId: 'sg-a', visible: true, idempotencyKey: 'labels-0002', revisionContext: { sourceRevision: r1.result.revision } });
  assert.equal(r2.ok, true);
  assert.equal(o.ann('sg-a').extensionLinks[EXT].data.labels, true);
  assert.equal((await roep(t.labels, { annotationId: 'sg-a', visible: 'ja', idempotencyKey: 'labels-0003', revisionContext: { sourceRevision: 'x' } })).code, 'INVALID_ARGUMENT');
  // De gewone instance is onaangeroerd.
  assert.equal('extensionLinks' in o.ann('sg-b'), false);
  api._cleanup();
  assert.equal(gestructureerdeOpdrachten.heeft(t.labels), false);
  delete globalThis.__actiefDocument;
  delete globalThis.__systeemGeometrie;
});

// ─── Aansluiting ───────────────────────────────────────────────────────────

test('het paneel hangt onder de native secties en de teksten staan in alle 40 talen', () => {
  const paneel = lees('../solid/components/properties-panel/PropertiesPanel.jsx');
  assert.ok(paneel.indexOf('<ScopedInstancePanels />') > paneel.indexOf('<CustomPluginPanel />'));
  assert.ok(paneel.indexOf('<ScopedInstancePanels />') < paneel.indexOf('<ActionsSection />'));
  const jsx = lees('../solid/components/properties-panel/ScopedInstancePanels.jsx');
  assert.match(jsx, /onAnySelectionChange\(synchroniseer\)/);
  assert.match(jsx, /instancePanelen\.abonneer\(synchroniseer\)/);
  assert.match(jsx, /host\.sluit\(\);/);
  assert.match(jsx, /tc\('apply'\)/);
  assert.match(jsx, /tc\('cancel'\)/);
  const css = lees('../../styles/properties-panel.css');
  const blok = css.slice(css.indexOf('.scoped-instance-panel-actions button {'));
  assert.match(blok.slice(0, blok.indexOf('}')), /cursor: default;/);
  assert.match(blok.slice(0, blok.indexOf('}')), /border-radius: 0;/);
  const map = new URL('../i18n/locales/', import.meta.url);
  const talen = readdirSync(map).filter((d) => !d.includes('.'));
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const p = JSON.parse(readFileSync(new URL(`${taal}/properties.json`, map), 'utf8'));
    const c = JSON.parse(readFileSync(new URL(`${taal}/common.json`, map), 'utf8'));
    assert.ok(p.scopedPanel?.stale?.trim(), `${taal}: scopedPanel.stale`);
    assert.ok(p.scopedPanel?.failed?.includes('{{error}}'), `${taal}: scopedPanel.failed met {{error}}`);
    assert.ok(c.apply && c.cancel, `${taal}: common.apply en common.cancel`);
  }
  // Verlaat geen wachtende microtaken.
  return wacht();
});
