// Opruimen van alle bijdragen met de echte createPluginApi (#550, #551).
// Na _cleanup is de API gesloten: late registraties (bijvoorbeeld van een
// activate die na de tijdgrens doorloopt) worden geweigerd en laten niets
// achter, en een oude API kan de bijdragen van de nieuwe versie niet
// weghalen. Het eigenschappenpaneel en de gereedschapsgroepen worden per
// extensie hersteld. Tot slot de hele weg: installeren, herladen en uitzetten
// via de echte levenscyclus, met het echte palet-, lint- en opdrachtregister.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');
const { maakLevenscyclus } = await laad('./extension-lifecycle.js');
const typen = await laad('./annotation-type-registry.js');
const paletten = await laad('./palette-registry.js');
const panelen = await laad('./property-panel-registry.js');
const groepen = await laad('./tool-group-state.js');
const { lintRegister } = await laad('./ribbon-tab-registry.js');
const { extensieOpdrachten } = await laad('./extension-commands.js');

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const paneelAanroepen = () => globalThis.__nativePaneelVerborgen ?? [];

const palet = (id, tools = []) => ({ id, label: id, icon: null, translationKey: null, tools, defaultVisible: false, defaultMode: 'float' });

test('na _cleanup weigert de API elke registratie met EXTENSION_INACTIVE en blijft er niets achter', () => {
  const api = createPluginApi('nl.test.gesloten');
  api._cleanup();
  const pogingen = {
    annotatietype: () => api.registerAnnotationType('nl.test.gesloten:type', { render() {} }),
    palet: () => api.registerToolPalette(palet('nl.test.gesloten.palet')),
    paneel: () => api.registerPropertyPanel('nl.test.gesloten:type', () => {}),
    selectie: () => api.registerSelectionListener('nl.test.gesloten:type', () => {}),
    documentgebeurtenis: () => api.onDocumentEvent('pageChanged', () => {}),
    eigenschappenpaneel: () => api.setNativePanelVisible(false),
    lint: () => api.registerRibbonTab({ id: 'main', label: 'X', groups: [] }),
  };
  for (const [wat, poging] of Object.entries(pogingen)) {
    assert.throws(poging, (e) => e.code === 'EXTENSION_INACTIVE', wat);
  }
  assert.equal(typen.getAnnotationType('nl.test.gesloten:type'), undefined);
  assert.equal(paletten.getPalette('nl.test.gesloten.palet'), null);
  assert.equal(panelen.getPropertyPanel('nl.test.gesloten:type') ?? null, null);
  assert.equal(paneelAanroepen().includes(true), false, 'het paneel is niet verborgen');
});

test('een oude API haalt na herladen de bijdragen van de nieuwe versie niet weg', () => {
  const ID = 'nl.test.herladen';
  const oud = createPluginApi(ID);
  oud.registerAnnotationType(`${ID}:kozijn`, { render() {}, versie: 1 });
  oud.registerToolPalette(palet(`${ID}.palet`));
  oud.registerPropertyPanel(`${ID}:kozijn`, () => 'oud');
  oud._cleanup();
  const nieuw = createPluginApi(ID);
  nieuw.registerAnnotationType(`${ID}:kozijn`, { render() {}, versie: 2 });
  nieuw.registerToolPalette(palet(`${ID}.palet`));
  nieuw.registerPropertyPanel(`${ID}:kozijn`, () => 'nieuw');
  // Late afmeldingen via de oude API doen niets.
  oud.unregisterAnnotationType(`${ID}:kozijn`);
  oud.unregisterToolPalette(`${ID}.palet`);
  oud.unregisterPropertyPanel(`${ID}:kozijn`);
  assert.equal(typen.getAnnotationType(`${ID}:kozijn`)?.versie, 2);
  assert.ok(paletten.getPalette(`${ID}.palet`));
  assert.equal(panelen.getPropertyPanel(`${ID}:kozijn`)?.(), 'nieuw');
  // Afmelden van iets dat deze API niet registreerde, doet ook niets.
  const ander = createPluginApi('nl.test.ander');
  ander.unregisterAnnotationType(`${ID}:kozijn`);
  assert.equal(typen.getAnnotationType(`${ID}:kozijn`)?.versie, 2);
  nieuw._cleanup();
  ander._cleanup();
  assert.equal(typen.getAnnotationType(`${ID}:kozijn`), undefined);
  assert.equal(paletten.getPalette(`${ID}.palet`), null);
});

test('opruimen herstelt alleen het eigen eigenschappenpaneel en de eigen gereedschapsgroepen', () => {
  const groep = (id) => ({ id, tool: 'select', label: id, icon: '', group: 0, subTools: [{ id: `${id}.a`, tool: 'select' }, { id: `${id}.b`, tool: 'select' }] });
  const a = createPluginApi('nl.test.a');
  const b = createPluginApi('nl.test.b');
  a.registerToolPalette(palet('nl.test.a.palet', [groep('nl.test.a.groep')]));
  b.registerToolPalette(palet('nl.test.b.palet', [groep('nl.test.b.groep')]));
  groepen.setActiveSubTool('nl.test.a.groep', 'nl.test.a.groep.b');
  groepen.setActiveSubTool('nl.test.b.groep', 'nl.test.b.groep.b');
  groepen.setActiveSubTool('ingebouwd.groep', 'x');
  a.setNativePanelVisible(false);
  const voor = paneelAanroepen().length;
  b._cleanup();
  assert.deepEqual(paneelAanroepen().slice(voor), [], 'b verborg het paneel niet en toont het dus ook niet');
  assert.equal(groepen.getActiveSubToolId('nl.test.a.groep'), 'nl.test.a.groep.b', 'de groep van a blijft');
  assert.equal(groepen.getActiveSubToolId('ingebouwd.groep'), 'x');
  assert.equal(groepen.getActiveSubToolId('nl.test.b.groep'), null, 'de groep van b is gewist');
  a._cleanup();
  assert.deepEqual(paneelAanroepen().slice(voor), [false], 'a toont het paneel weer');
  assert.equal(groepen.getActiveSubToolId('nl.test.a.groep'), null);
  assert.equal(groepen.getActiveSubToolId('ingebouwd.groep'), 'x', 'andere groepen blijven staan');
});

// ─── De hele weg, met de echte levenscyclus ───────────────────────────────

function opzet(ID, modules) {
  const schijf = new Map();
  const pakketten = new Map();
  const transacties = new Map();
  let n = 0;
  async function invoke(cmd, a = {}) {
    await wacht(0);
    switch (cmd) {
      case 'extensie_lijst': return { extensions: [...schijf].map(([id, d]) => ({ id, version: d.version, sha256: d.sha256 })), problems: [] };
      case 'read_plugin_file': return schijf.get(a.pluginId).code;
      case 'extensie_inspecteer': { const p = pakketten.get(a.pad); return { id: p.id, version: p.version, sha256: p.sha256 }; }
      case 'extensie_installeer': {
        const p = pakketten.get(a.pad);
        const t = `t${++n}`;
        transacties.set(t, schijf.get(p.id) ?? null);
        schijf.set(p.id, { ...p });
        return { outcome: transacties.get(t) ? 'updated' : 'installed', transactie: t };
      }
      case 'extensie_terugdraaien': {
        const vorige = transacties.get(a.transactie);
        if (vorige) schijf.set(ID, vorige); else schijf.delete(ID);
        return {};
      }
      case 'extensie_bevestig': transacties.delete(a.transactie); return {};
      default: throw new Error(cmd);
    }
  }
  const lc = maakLevenscyclus({ invoke, importeer: async (b) => modules[b](), maakApi: createPluginApi, activatieTimeoutMs: 40 });
  const pakket = (pad, code, version = '1.0.0') => pakketten.set(pad, { id: ID, version, code, sha256: `sha-${pad}` });
  return { lc, pakket };
}

test('installeren, herladen en uitzetten: daarna geen tabblad, geen ext:-opdrachten en geen palet meer', async () => {
  const ID = 'nl.test.kozijnen';
  const module = () => ({
    activate(api) {
      api.registerToolPalette(palet(`${ID}.palet`));
      api.registerAnnotationType(`${ID}:kozijn`, { render() {} });
      api.registerRibbonTab({ id: 'main', label: 'Kozijnen', groups: [{ id: 'g', label: 'G', items: [
        { type: 'action', id: 'frame', label: 'Kozijn', onRun: () => 1 },
      ] }] });
    },
  });
  const { lc, pakket } = opzet(ID, { v1: module });
  pakket('C:/p/k.oppx', 'v1');
  const r = await lc.installeer({ pad: 'C:/p/k.oppx', beleid: 'never', sleutel: 'opruimen-1', bron: 'mcp' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const telPaletten = () => paletten.getRegisteredPalettes().filter((p) => p.id === `${ID}.palet`).length;
  const extOpdrachten = () => extensieOpdrachten.lijst('en').filter((c) => c.command.startsWith(`ext:${ID}:`));
  assert.equal((await lc.herlaad(ID, { bron: 'mcp' })).ok, true);
  assert.equal(telPaletten(), 1, 'na herladen precies één palet in het globale register');
  assert.equal(lintRegister.vanExtensie(ID).length, 1);
  assert.equal(extOpdrachten().length, 1);
  const uit = await lc.zetUit(ID, { bron: 'ui' });
  assert.equal(uit.ok, true);
  assert.equal(telPaletten(), 0, 'het palet is uit het globale register');
  assert.deepEqual(lintRegister.vanExtensie(ID), [], 'het tabblad is weg');
  assert.deepEqual(extOpdrachten(), [], 'geen ext:-opdrachten meer');
  assert.equal(typen.getAnnotationType(`${ID}:kozijn`), undefined);
});

test('een activate die na de tijdgrens (MCP) nog registreert, laat niets achter', async () => {
  const ID = 'nl.test.traag';
  const laat = [];
  const module = () => ({
    async activate(api) {
      await wacht(120);
      for (const [wat, poging] of [
        ['palet', () => api.registerToolPalette(palet(`${ID}.palet`))],
        ['type', () => api.registerAnnotationType(`${ID}:laat`, { render() {} })],
        ['paneel', () => api.registerPropertyPanel(`${ID}:laat`, () => {})],
        ['lint', () => api.registerRibbonTab({ id: 'main', label: 'Laat', groups: [] })],
      ]) {
        try { poging(); laat.push(`${wat}: geaccepteerd`); } catch (e) { laat.push(`${wat}: ${e.code}`); }
      }
    },
  });
  const { lc, pakket } = opzet(ID, { traag: module });
  pakket('C:/p/t.oppx', 'traag');
  const r = await lc.installeer({ pad: 'C:/p/t.oppx', beleid: 'never', sleutel: 'opruimen-2', bron: 'mcp' });
  assert.equal(r.code, 'ACTIVATION_TIMEOUT');
  await wacht(200);
  assert.deepEqual(laat, ['palet: EXTENSION_INACTIVE', 'type: EXTENSION_INACTIVE', 'paneel: EXTENSION_INACTIVE', 'lint: EXTENSION_INACTIVE']);
  assert.equal(paletten.getPalette(`${ID}.palet`), null);
  assert.equal(typen.getAnnotationType(`${ID}:laat`), undefined);
  assert.equal(panelen.getPropertyPanel(`${ID}:laat`) ?? null, null);
  assert.deepEqual(lintRegister.vanExtensie(ID), []);
});
