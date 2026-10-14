// Systeemtypen in de plugin-API (#567), van begin tot eind met een
// synthetische extensie: registreren, in de native tool kiezen, de native
// editor openen, Toepassen en Annuleren, opnieuw registreren, afwijzingen en
// deactivatie. De echte registry en state; de tool-wissel is een teller.
//
// preferences.js en rendering.js zijn stubs die hun aanroepen tellen
// (zie ../core/app-test-hooks.mjs).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
await import('../core/preferences.js');
await import('../annotations/rendering.js');
// De commit ververst het eigenschappenpaneel via een luie import. Vooraf
// laden houdt de tellers voorspelbaar: een koude import midden in een test
// zou opslaan en hertekenen van een vorige stap pas na de reset laten tellen.
await import('../solid/stores/propertiesStore.js');
const reg = await import('../annotations/systeem-typen-registry.js');
const { createSystemTypeApi } = await import('./system-type-api.js');
const editor = await import('../solid/stores/systeemtypenEditorStore.js');
const { getDialogs, closeDialog } = await import('../solid/stores/dialogStore.js');
const {
  createDefaultSysteemTypen, findSysteemType, normalizeSysteemType, kiesToolType, typeInstanceVelden,
} = await import('../annotations/systeem-typen.js');
const { planEditorToepassen, beginSelectie, eigenaarLabel } = await import('../annotations/systeem-typen-contract.js');
const { systeemrasterBuildOpts } = await import('../annotations/systeemraster-scale.js');
const { systeemInstanceGeometrie } = await import('../annotations/systeem-geometrie-app.js');

const DEF = {
  naam: 'Mineraalplaat 600x600',
  categorie: 'plafond',
  ifcCategory: 'IfcPlate',
  ifcPredefinedType: 'CEILING',
  layout: 'raster',
  celXMm: 600,
  celYMm: 600,
  edgeProfiel: 'schaduwvoeg',
};
const ID = 'ext:test.synthetisch#mineraal-600x600';
const kloon = (x) => JSON.parse(JSON.stringify(x));
const tellers = () => globalThis.__stubCalls || {};
// Opslaan en hertekenen lopen via een dynamische import (door de laadhaken).
// Naast andere testbestanden duurt dat soms langer dan één timer van 30 ms;
// wacht daarom een paar rondes, elk na dezelfde imports.
const rust = async () => {
  for (let i = 0; i < 3; i++) {
    await Promise.all([import('../core/preferences.js'), import('../annotations/rendering.js')]);
    await new Promise((r) => setTimeout(r, 30));
  }
};

let gekozenTools = [];
let huidigeTool = 'select';
const actief = [];

// Dezelfde levenscyclus als setTool in tools/manager.js: bij een wissel de
// vorige tool deactiveren, daarna de nieuwe activeren (ook als het dezelfde
// is, bijvoorbeeld opnieuw gekozen in het lint). De systeemplafond-tool meldt
// beide aan de registry (zie systeemraster-tool.js; de bedrading staat in
// systeemtypen-dialoog-bedrading.test.mjs).
function setTool(naam) {
  gekozenTools.push(naam);
  if (huidigeTool !== naam && huidigeTool === 'systeemplafond') reg.toolSysteemGedeactiveerd();
  huidigeTool = naam;
  if (naam === 'systeemplafond') reg.toolSysteemGeactiveerd();
}
const host = () => ({ ...reg, systeemInstanceGeometrie, setTool, openEditor: editor.openSysteemtypenEditor });
const gekozenType = () => kiesToolType(reg.getSysteemTypenData(), reg.getToolSysteemTypeId())?.id;

/** Een synthetische extensie: activate registreert en luistert. */
function activeer(pluginId = 'test.synthetisch') {
  const api = createSystemTypeApi(pluginId, host());
  actief.push(api);
  const meldingen = [];
  const stop = api.onSystemTypesChanged((e) => meldingen.push(e));
  return { api, meldingen, stop };
}

/** Toepassen in de native editor, zoals de dialoog het doet. */
function editorPastToe(id, patch) {
  const basis = kloon(reg.getSysteemTypenData());
  const werk = kloon(basis);
  const i = werk.typen.findIndex((t) => t.id === id);
  werk.typen[i] = normalizeSysteemType({ ...werk.typen[i], ...patch, id });
  const plan = planEditorToepassen(basis, werk, reg.getSysteemTypenData(), []);
  reg.commitSysteemTypen(plan.data, plan.wijzigingen, 'editor');
}

beforeEach(() => {
  // Elke test begint zonder geladen extensies (dispose = _cleanup).
  for (const api of actief.splice(0)) api.dispose();
  state.preferences.systeemTypen = createDefaultSysteemTypen();
  globalThis.__stubCalls = {};
  gekozenTools = [];
  huidigeTool = 'select';
  reg.zetToolSysteemType(null);
  closeDialog('systeemtypen');
});

test('registreren, kiezen in de native tool en zien in de native editor', () => {
  const { api } = activeer();
  assert.equal(api.systemTypeId('mineraal-600x600'), ID);
  const { status, type } = api.registerSystemType('mineraal-600x600', DEF);
  assert.equal(status, 'created');
  assert.equal(type.id, ID);
  assert.deepEqual(type.owner, { kind: 'extension', extensionId: 'test.synthetisch', key: 'mineraal-600x600', loaded: true });

  // Native tool: de selectie levert dit type, met zijn eigen IFC-categorie.
  assert.deepEqual(api.selectSystemTypeForTool(ID), { tool: 'systeemplafond', typeId: ID, active: true });
  assert.deepEqual(gekozenTools, ['systeemplafond']);
  assert.equal(reg.getToolSysteemTypeId(), ID);
  const gekozen = kiesToolType(reg.getSysteemTypenData(), reg.getToolSysteemTypeId());
  assert.equal(gekozen.id, ID);
  const velden = typeInstanceVelden(gekozen);
  assert.equal(velden.systeemTypeId, ID);
  assert.equal(velden.ifcCategory, 'IfcPlate');
  assert.equal(velden.plaatBreedteMm, 600);

  // Native editor: openen met de focus op het type.
  const open = api.openSystemTypeEditor(ID);
  assert.deepEqual(open, { opened: true, typeId: ID });
  const dialoog = getDialogs().find((d) => d.name === 'systeemtypen');
  assert.deepEqual(dialoog.data, { typeId: ID });
  const focus1 = editor.systeemtypenFocus();
  assert.equal(focus1.typeId, ID);
  assert.equal(beginSelectie(reg.getSysteemTypenData(), dialoog.data.typeId), ID);
  assert.equal(eigenaarLabel(findSysteemType(reg.getSysteemTypenData(), ID), reg.isExtensieGeladen),
    ' (extensie test.synthetisch)');
  // Nog een keer: niet opnieuw openen (dat gooit de werkkopie weg), wel focus.
  const opnieuw = api.openSystemTypeEditor(ID);
  assert.deepEqual(opnieuw, { opened: false, typeId: ID });
  assert.ok(editor.systeemtypenFocus().volgnummer > focus1.volgnummer);
  assert.equal(getDialogs().filter((d) => d.name === 'systeemtypen').length, 1);
  // Openen, kiezen en lezen wijzigen niets.
  assert.equal(tellers().savePreferences, undefined);
});

test('Toepassen bewaart, meldt de extensie en markeert de gebruikersbewerking', async () => {
  const { api, meldingen } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  meldingen.length = 0;
  await rust();
  globalThis.__stubCalls = {};
  editorPastToe(ID, { celXMm: 625 });
  assert.equal(meldingen.length, 1);
  assert.equal(meldingen[0].source, 'editor');
  assert.equal(meldingen[0].changes[0].id, ID);
  assert.equal(meldingen[0].changes[0].change, 'updated');
  const s = api.getSystemType(ID);
  assert.equal(s.revision, 2);
  assert.equal(s.ownerRevision, 1);
  assert.equal(s.userEdited, true);
  assert.equal(s.definition.celXMm, 625);
  await rust();
  assert.equal(tellers().savePreferences, 1);
});

test('Annuleren laat registry, documenten en tool-selectie ongewijzigd', async () => {
  const { api, meldingen } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  await rust();
  meldingen.length = 0;
  globalThis.__stubCalls = {};
  const voor = JSON.stringify(reg.getSysteemTypenData());
  api.openSystemTypeEditor(ID);
  // De dialoog werkt op een kopie; Annuleren gooit die weg.
  const werk = kloon(reg.getSysteemTypenData());
  findSysteemType(werk, ID).celXMm = 999;
  closeDialog('systeemtypen');
  await rust();
  assert.equal(JSON.stringify(reg.getSysteemTypenData()), voor);
  assert.equal(meldingen.length, 0);
  assert.equal(tellers().savePreferences, undefined);
  assert.equal(reg.getToolSysteemTypeId(), null);
});

test('opnieuw registreren behoudt de gebruikersbewerking, ook na een herinstallatie', () => {
  const eerste = activeer();
  eerste.api.registerSystemType('mineraal-600x600', DEF);
  editorPastToe(ID, { celXMm: 625 });
  const r = eerste.api.registerSystemType('mineraal-600x600', { ...DEF, celYMm: 1200 });
  assert.equal(r.status, 'kept-user-edit');
  assert.equal(r.type.definition.celXMm, 625);
  assert.equal(eerste.api.listSystemTypes({ owned: true }).length, 1);
  // Herinstallatie: unload (dispose) en een nieuwe api voor hetzelfde id.
  eerste.api.dispose();
  const tweede = activeer();
  assert.equal(tweede.api.registerSystemType('mineraal-600x600', { ...DEF, celYMm: 1200 }).status, 'kept-user-edit');
  assert.equal(tweede.api.registerSystemType('mineraal-600x600', { ...DEF, celXMm: 625 }).status, 'unchanged');
  assert.equal(tweede.api.listSystemTypes({ owned: true }).length, 1);
  assert.equal(reg.getSysteemTypenData().typen.filter((t) => t.id === ID).length, 1);
  // Opzettelijk vervangen: updateSystemType met de revisie die de extensie zag.
  const u = tweede.api.updateSystemType(ID, { ...DEF, celYMm: 1200 }, { expectedRevision: r.type.revision });
  assert.equal(u.status, 'updated');
  assert.equal(u.type.userEdited, false);
  assert.equal(u.type.definition.celXMm, 600);
});

test('afwijzingen: onbekende velden, andere extensie, oude revisie — niets verandert', async () => {
  const { api, meldingen } = activeer();
  const ander = activeer('test.ander');
  api.registerSystemType('mineraal-600x600', DEF);
  await rust();
  meldingen.length = 0;
  ander.meldingen.length = 0;
  globalThis.__stubCalls = {};
  const voor = JSON.stringify(reg.getSysteemTypenData());
  const fouten = [
    [() => api.registerSystemType('nieuw', { ...DEF, artikelnummer: 'A-1' }), 'unknown-field'],
    [() => api.registerSystemType('nieuw', { ...DEF, sparingRegels: { foo: 1 } }), 'unknown-field'],
    [() => api.registerSystemType('nieuw', { ...DEF, celXMm: 10 }), 'invalid-field'],
    [() => api.registerSystemType('nieuw', { ...DEF, lagen: [{}] }), 'unsupported-field'],
    [() => api.registerSystemType('nieuw', DEF, { schema: 2 }), 'unsupported-version'],
    [() => ander.api.updateSystemType(ID, { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner'],
    [() => api.updateSystemType('st-plafond-600x600', { celXMm: 700 }, { expectedRevision: 1 }), 'not-owner'],
    [() => api.updateSystemType(ID, { celXMm: 700 }, { expectedRevision: 5 }), 'stale-revision'],
    [() => api.updateSystemType(ID, { celXMm: 700 }), 'invalid-argument'],
    [() => api.selectSystemTypeForTool('bestaat-niet'), 'not-found'],
    [() => api.openSystemTypeEditor('bestaat-niet'), 'not-found'],
    [() => api.listSystemTypes({ eigen: true }), 'invalid-argument'],
  ];
  for (const [poging, code] of fouten) {
    let fout = null;
    try { poging(); } catch (e) { fout = e; }
    assert.ok(fout, `verwacht ${code}`);
    assert.equal(fout.name, 'SystemTypeError');
    assert.equal(fout.code, code, fout.message);
    if (code === 'stale-revision') assert.equal(fout.currentRevision, 1);
  }
  await rust();
  assert.equal(JSON.stringify(reg.getSysteemTypenData()), voor);
  assert.equal(meldingen.length + ander.meldingen.length, 0);
  assert.deepEqual(tellers(), {});
  assert.equal(reg.getToolSysteemTypeId(), null);
  assert.deepEqual(gekozenTools, []);
  assert.equal(getDialogs().some((d) => d.name === 'systeemtypen'), false);
});

test('de tool-selectie geldt alleen voor de tool-sessie die de extensie start', () => {
  const { api } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  // Zonder selectie tekent de native tool het standaardplafond.
  assert.equal(gekozenType(), 'st-plafond-600x600');
  api.selectSystemTypeForTool(ID);
  assert.equal(gekozenType(), ID);
  // De gebruiker wisselt van gereedschap: de selectie vervalt.
  setTool('select');
  assert.equal(reg.getToolSysteemTypeId(), null);
  setTool('systeemplafond'); // de native tool uit het lint of de bibliotheek
  assert.equal(gekozenType(), 'st-plafond-600x600', 'de native tool tekent weer het standaardplafond');
  // De gebruiker kiest de native tool opnieuw terwijl de extensiesessie loopt.
  api.selectSystemTypeForTool(ID);
  assert.equal(gekozenType(), ID);
  setTool('systeemplafond');
  assert.equal(gekozenType(), 'st-plafond-600x600');
  // Kan de tool niet aan (bijvoorbeeld een alleen-lezen PDF/A), dan blijft er
  // geen selectie hangen voor een latere native activering.
  const geblokkeerd = createSystemTypeApi('test.synthetisch', { ...host(), setTool: () => {} });
  actief.push(geblokkeerd);
  setTool('select');
  assert.deepEqual(geblokkeerd.selectSystemTypeForTool(ID), { tool: 'systeemplafond', typeId: ID, active: false });
  assert.equal(reg.getToolSysteemTypeId(), null);
  setTool('systeemplafond');
  assert.equal(gekozenType(), 'st-plafond-600x600');
});

test('deactivatie van de extensie zet de tool-selectie terug naar de standaard', () => {
  const { api } = activeer();
  const ander = activeer('test.ander');
  api.registerSystemType('mineraal-600x600', DEF);
  ander.api.registerSystemType('eigen', DEF);
  api.selectSystemTypeForTool(ID);
  // Een andere extensie die opruimt, raakt deze selectie niet.
  ander.api.dispose();
  assert.equal(gekozenType(), ID);
  api.dispose();
  assert.equal(reg.getToolSysteemTypeId(), null);
  assert.equal(gekozenType(), 'st-plafond-600x600');
  assert.ok(reg.getSysteemTypeById(ID), 'het type zelf blijft');
});

test('na dispose (deactivatie) kan de api niets meer wijzigen, kiezen of openen; lezen kan wel', async () => {
  const { api, meldingen } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  api.dispose();
  await rust();
  globalThis.__stubCalls = {};
  gekozenTools = [];
  meldingen.length = 0;
  const voor = JSON.stringify(reg.getSysteemTypenData());
  for (const poging of [
    () => api.registerSystemType('nieuw', DEF),
    () => api.registerSystemType('mineraal-600x600', { ...DEF, celYMm: 1200 }),
    () => api.updateSystemType(ID, { celXMm: 700 }, { expectedRevision: 1 }),
    () => api.selectSystemTypeForTool(ID),
    () => api.openSystemTypeEditor(ID),
    () => api.onSystemTypesChanged(() => {}),
  ]) {
    let fout = null;
    try { poging(); } catch (e) { fout = e; }
    assert.ok(fout, 'verwacht een afwijzing');
    assert.equal(fout.name, 'SystemTypeError');
    assert.equal(fout.code, 'disposed', fout.message);
  }
  await rust();
  assert.equal(JSON.stringify(reg.getSysteemTypenData()), voor);
  assert.deepEqual(tellers(), {});
  assert.deepEqual(gekozenTools, []);
  assert.equal(reg.getToolSysteemTypeId(), null);
  assert.equal(getDialogs().some((d) => d.name === 'systeemtypen'), false);
  assert.equal(meldingen.length, 0);
  // Lezen blijft werken; het type is er nog.
  assert.equal(api.getSystemType(ID).id, ID);
  assert.ok(api.listSystemTypes().some((s) => s.id === ID));
  assert.equal(api.systemTypeId('mineraal-600x600'), ID);
});

/** Een open document met een gekalibreerde schaal (0,1 paginapunt per mm). */
function openDocument(annotations) {
  state.documents = [{
    id: 'doc-geo', filePath: null, pdfDoc: { numPages: 1 }, currentPage: 1, scale: 1, viewRotation: 0,
    viewMode: 'single', annotations, selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {},
    measureScale: { pixelsPerUnit: 0.1, unit: 'mm' },
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

test('geometrie: een systeem met het extensietype, met document- en typerevisie', async () => {
  const { api, meldingen } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  api.selectSystemTypeForTool(ID);
  // Een instance zoals de native tool hem met het gekozen type tekent.
  const velden = typeInstanceVelden(kiesToolType(reg.getSysteemTypenData(), reg.getToolSysteemTypeId()));
  const doc = openDocument([{
    id: 'sg-geo', type: 'systeemraster', page: 1, ...velden,
    system: { type: 'plafond', layers: [{ panels: {}, edge: { profiel: 'geen' } }] },
    points: [{ x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 340 }, { x: 100, y: 340 }],
  }]);
  try {
    await rust();
    meldingen.length = 0;
    globalThis.__stubCalls = {};
    const g = api.getSystemInstanceGeometry('sg-geo');
    assert.equal(g.document.id, 'doc-geo');
    assert.deepEqual(g.type, { id: ID, revision: 1 });
    assert.equal(g.confirmed, true);
    assert.deepEqual(g.placement, { page: 1, origin: { x: 100, y: 100 }, angleDeg: 0, pagePointsPerMm: 0.1, scaleKnown: true });
    assert.equal(g.panels.length, 6 * 4);
    assert.equal(g.grid.cellWidth, 600);
    // Zoom en weergaverotatie van het document veranderen niets.
    doc.scale = 3.5;
    doc.viewRotation = 90;
    assert.deepEqual(api.getSystemInstanceGeometry('sg-geo'), g);
    // Met de juiste revisies: dezelfde snapshot. Lezen verandert niets.
    assert.deepEqual(api.getSystemInstanceGeometry('sg-geo',
      { expectedDocumentRevision: g.document.revision, expectedTypeRevision: 1 }), g);
    await rust();
    assert.deepEqual(tellers(), {});
    assert.equal(meldingen.length, 0);
    // Geen systeem met dat id: null.
    assert.equal(api.getSystemInstanceGeometry('bestaat-niet'), null);
    // Toepassen in de native editor: het type verandert, de oude typerevisie is verouderd.
    editorPastToe(ID, { celXMm: 625 });
    let fout = null;
    try { api.getSystemInstanceGeometry('sg-geo', { expectedTypeRevision: 1 }); } catch (e) { fout = e; }
    assert.deepEqual([fout?.code, fout?.field, fout?.currentRevision], ['stale-revision', 'expectedTypeRevision', 2]);
    assert.equal(api.getSystemInstanceGeometry('sg-geo').grid.cellWidth, 625, 'de geometrie volgt het type');
    // De contour verandert in het document: de oude documentrevisie is verouderd.
    state.documents[0].annotations[0].points[1].x = 480;
    fout = null;
    try { api.getSystemInstanceGeometry('sg-geo', { expectedDocumentRevision: g.document.revision }); } catch (e) { fout = e; }
    assert.deepEqual([fout?.code, fout?.field], ['stale-revision', 'expectedDocumentRevision']);
    // Lezen kan ook na deactivatie.
    api.dispose();
    assert.equal(api.getSystemInstanceGeometry('sg-geo').type.revision, 2);
  } finally {
    state.documents = [];
  }
});

test('een plugin-id buiten de grammatica kan lezen maar niet registreren', () => {
  const api = createSystemTypeApi('met spatie', host());
  assert.ok(api.listSystemTypes().length >= 5);
  assert.throws(() => api.registerSystemType('k', DEF), { code: 'invalid-owner' });
  assert.throws(() => api.systemTypeId('k'), { code: 'invalid-owner' });
  api.dispose();
});

test('lezen: losgekoppelde snapshots, null voor onbekend, owned filtert', () => {
  const { api } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  const alle = api.listSystemTypes();
  assert.deepEqual(alle.map((s) => s.id), reg.getSysteemTypenData().typen.map((t) => t.id));
  assert.deepEqual(api.listSystemTypes({ owned: true }).map((s) => s.id), [ID]);
  assert.equal(api.getSystemType('bestaat-niet'), null);
  const s = api.getSystemType(ID);
  s.definition.celXMm = 1;
  assert.equal(api.getSystemType(ID).definition.celXMm, 600);
  assert.equal(reg.getSysteemTypeById(ID).celXMm, 600);
});

test('listeners: geïsoleerd, af te melden, alleen functies', () => {
  const { api } = activeer();
  const waarschuwingen = [];
  const oud = console.warn;
  console.warn = (...a) => waarschuwingen.push(a);
  const ontvangen = [];
  try {
    const stop1 = api.onSystemTypesChanged(() => { throw new Error('kapot'); });
    const stop2 = api.onSystemTypesChanged((e) => ontvangen.push(e));
    api.registerSystemType('mineraal-600x600', DEF);
    assert.equal(ontvangen.length, 1);
    assert.ok(waarschuwingen.some((w) => w[0] === '[plugin] systemTypesChanged listener failed'));
    stop1();
    stop2();
    api.registerSystemType('mineraal-600x600', { ...DEF, celYMm: 1200 });
    assert.equal(ontvangen.length, 1);
  } finally {
    console.warn = oud;
  }
  assert.throws(() => api.onSystemTypesChanged(null), TypeError);
});

test('deactivatie verwijdert geen type waar een document naar verwijst', () => {
  const { api, meldingen } = activeer();
  api.registerSystemType('mineraal-600x600', DEF);
  const instance = { type: 'systeemraster', page: 1, systeemTypeId: ID,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  const voor = systeemrasterBuildOpts(instance).typeDef;
  meldingen.length = 0;
  api.dispose(); // _cleanup bij deactiveren of verwijderen
  assert.ok(reg.getSysteemTypeById(ID), 'het type blijft in de bibliotheek');
  const ander = activeer('test.ander');
  assert.equal(ander.api.getSystemType(ID).owner.loaded, false);
  assert.deepEqual(systeemrasterBuildOpts(instance).typeDef, voor, 'de instance tekent met dezelfde definitie');
  // Na dispose krijgt de listener van de oude api niets meer.
  editorPastToe(ID, { celXMm: 625 });
  assert.equal(meldingen.length, 0);
  assert.equal(ander.meldingen.length, 1, 'andere extensies horen het wel');
  // Bijwerken kan pas weer als de extensie terug is.
  const terug = activeer();
  assert.equal(terug.api.getSystemType(ID).owner.loaded, true);
  assert.equal(terug.api.updateSystemType(ID, { celYMm: 900 }, { expectedRevision: 2 }).status, 'updated');
});
