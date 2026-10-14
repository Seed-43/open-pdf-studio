// Levenscyclus van extensies (#550): installeren, bijwerken, herladen,
// terugrollen, idempotentie en de wachtrij. Met een nep-invoke (de native
// kant), nep-import en de echte bijdragescope, het echte lintregister en het
// echte opdrachtregister, zodat het opruimen bij herladen echt getoetst wordt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { maakLevenscyclus, wachtOpExtensieWissel, natieveFout } from './extension-lifecycle.js';
import { maakBijdrageScope, _wisEigenaars } from './extension-contributions.js';
import { maakLintRegister } from './ribbon-tab-registry.js';
import { maakOpdrachtRegister } from './extension-commands.js';
import { metOpslagSlot } from './opslag-wissel-slot.js';

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = 'nl.voorbeeld.kozijnen';

const tab = (label, extra = []) => ({
  id: 'main', label,
  groups: [{ id: 'place', label: 'Plaatsen', items: [
    { type: 'action', id: 'frame', label: 'Kozijn', onRun: async () => 'geplaatst' },
    { type: 'dropdown', id: 'profile', label: 'Profiel', options: [{ id: 'wood', label: 'Hout' }, { id: 'alu', label: 'Alu' }], onChange: async () => {} },
    ...extra,
  ] }],
});

function opzet(opties = {}) {
  _wisEigenaars();
  const tel = { activate: {}, deactivate: {}, naOpruimen: 0, verboden: 0 };
  const log = [];
  const opdrachten = maakOpdrachtRegister();
  const lintReg = maakLintRegister({ opdrachten, iconen: {} });
  let actiefTab = 'home';
  lintReg.koppelLint({ lees: () => actiefTab, zet: (id) => { actiefTab = id; } });

  let blokkeerActivatie = null;
  const MODULES = {
    v1: () => ({
      activate(api) { tel.activate.v1 = (tel.activate.v1 ?? 0) + 1; log.push('activate v1'); api.registerRibbonTab(tab('Kozijnen')); },
      deactivate() { tel.deactivate.v1 = (tel.deactivate.v1 ?? 0) + 1; log.push('deactivate v1'); },
    }),
    v2: () => ({
      async activate(api) {
        tel.activate.v2 = (tel.activate.v2 ?? 0) + 1; log.push('activate v2 start');
        if (blokkeerActivatie) await blokkeerActivatie;
        api.registerRibbonTab(tab('Kozijnen 2'));
        log.push('activate v2 klaar');
      },
      deactivate() { tel.deactivate.v2 = (tel.deactivate.v2 ?? 0) + 1; log.push('deactivate v2'); },
    }),
    gooit: () => ({ activate(api) { api.registerRibbonTab(tab('Kapot', [{ type: 'status', id: 'x', label: 'X', text: '' }])); throw new Error('kapot'); } }),
    wijstAf: () => ({ async activate(api) { api.registerRibbonTab(tab('Kapot')); await wacht(1); throw new Error('async kapot'); } }),
    traag: () => ({ activate: () => new Promise(() => {}) }),
    ongeldigLint: () => ({ activate(api) { api.registerRibbonTab({ id: 'Main', label: 'X', groups: [] }); } }),
    deactGooit: () => ({ activate(api) { api.registerRibbonTab(tab('D')); }, deactivate() { throw new Error('deact'); } }),
    vreemdManifest: () => ({ manifest: { id: 'iets.anders' }, activate() {} }),
    // Zoals een echte extensie: een tweede activate zonder deactivate gooit.
    bewaakt: () => ({
      async activate(api) {
        if (bewaaktActief) throw new Error('already active');
        bewaaktActief = true;
        tel.activate.bewaakt = (tel.activate.bewaakt ?? 0) + 1;
        if (blokkeerActivatie) await blokkeerActivatie;
        api.registerRibbonTab(tab('Bewaakt'));
      },
      deactivate() { bewaaktActief = false; tel.deactivate.bewaakt = (tel.deactivate.bewaakt ?? 0) + 1; },
    }),
    traagDanKapot: () => ({
      async activate(api) {
        api.registerRibbonTab(tab('Traag'));
        if (blokkeerActivatie) await blokkeerActivatie;
        throw new Error('later kapot');
      },
      deactivate() { tel.deactivate.traagDanKapot = (tel.deactivate.traagDanKapot ?? 0) + 1; },
    }),
  };
  let bewaaktActief = false;

  // De native kant, in het geheugen.
  const pakketten = new Map();
  const schijf = new Map();
  const transacties = new Map();
  const aanroepen = [];
  let tokenNr = 0;
  const natief = { faalTerugdraaien: false, faalBevestigen: 0, problemen: [] };
  const fout = (code, message = code) => JSON.stringify({ code, message });
  const versieGetal = (v) => v.split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);

  async function invoke(cmd, args = {}) {
    aanroepen.push([cmd, args]);
    await wacht(0);
    switch (cmd) {
      case 'extensie_inspecteer': {
        const p = pakketten.get(args.pad);
        if (!p) throw fout('FILE_NOT_FOUND');
        if (p.fout) throw fout(p.fout);
        return { id: p.id, name: p.name, version: p.version, sha256: p.sha256, entries: 2, bytes: 100 };
      }
      case 'extensie_installeer': {
        const p = pakketten.get(args.pad);
        if (p.sha256 !== args.verwachteSha256) throw fout('PACKAGE_CHANGED');
        const oud = schijf.get(p.id);
        if (oud && oud.sha256 === p.sha256) return { outcome: 'unchanged', transactie: null, previousVersion: oud.version };
        if (oud && args.beleid === 'never') throw fout('ALREADY_INSTALLED');
        if (oud && args.beleid === 'ifNewer' && versieGetal(p.version) <= versieGetal(oud.version)) throw fout('VERSION_NOT_NEWER');
        const token = `t${++tokenNr}`;
        transacties.set(token, { id: p.id, vorige: oud ?? null });
        schijf.set(p.id, { version: p.version, sha256: p.sha256, code: p.code, name: p.name, source: args.bron });
        return { outcome: oud ? 'updated' : 'installed', transactie: token, previousVersion: oud?.version ?? null };
      }
      case 'extensie_bevestig':
        if (natief.faalBevestigen > 0) { natief.faalBevestigen--; throw fout('INSTALL_IO_FAILED', 'journal locked'); }
        if (!transacties.delete(args.transactie)) throw fout('TRANSACTION_UNKNOWN');
        return { confirmed: true };
      case 'extensie_terugdraaien': {
        if (natief.faalTerugdraaien) throw fout('INSTALL_IO_FAILED', 'disk full');
        const t = transacties.get(args.transactie);
        transacties.delete(args.transactie);
        if (t.vorige) schijf.set(t.id, t.vorige); else schijf.delete(t.id);
        return { restoredVersion: t.vorige?.version ?? null };
      }
      case 'extensie_lijst':
        return {
          extensions: [...schijf].map(([id, d]) => ({ id, name: d.name, version: d.version, sha256: d.sha256, source: d.source, legacyId: false })),
          problems: natief.problemen,
          recovered: args.herstel ? { rolledBack: [], removed: 0, problems: [] } : null,
        };
      case 'read_plugin_file': {
        const d = schijf.get(args.pluginId);
        if (!d) throw 'Failed to read file';
        return d.code;
      }
      case 'uninstall_plugin':
        schijf.delete(args.id);
        return true;
      default:
        throw new Error(`onbekend commando ${cmd}`);
    }
  }

  function pakket(pad, { id = ID, version, code, name = 'Kozijnen', fout: f } = {}) {
    pakketten.set(pad, { id, version, code, name, sha256: `sha-${pad}`, fout: f });
  }

  const apis = [];
  const lc = maakLevenscyclus({
    invoke,
    importeer: async (bron) => {
      if (bron === 'SYNTAX') throw new SyntaxError('Unexpected token');
      return MODULES[bron]();
    },
    maakApi: (id) => {
      const scope = maakBijdrageScope(id);
      const api = {
        registerRibbonTab: (d) => lintReg.registreer(scope, d),
        _cleanup: () => scope.ruimOp(),
        _bijdragenOverzicht: () => ({ ribbonTabs: lintReg.vanExtensie(id), commands: scope.lijst().filter((b) => b.soort === 'command').length,
          annotationTypes: scope.actief() ? ['kozijn'] : [], palettes: [], propertyPanels: [] }),
      };
      apis.push(api);
      return api;
    },
    naOpruimen: (ctx) => { tel.naOpruimen++; (tel.naOpruimenCtx ??= []).push(ctx); },
    lint: { actief: () => actiefTab, zet: (id) => { actiefTab = id; }, heeft: (id) => lintReg.heeft(id) },
    activatieTimeoutMs: opties.activatieTimeoutMs ?? 200,
    nu: opties.nu,
  });

  return {
    lc, tel, log, lintReg, opdrachten, schijf, transacties, aanroepen, natief, pakket,
    actiefTab: () => actiefTab, zetActiefTab: (id) => { actiefTab = id; },
    blokkeer: () => { let los; blokkeerActivatie = new Promise((r) => { los = r; }); return () => { blokkeerActivatie = null; los(); }; },
    tabs: () => lintReg.tabbladen('en'),
    aantal: (cmd) => aanroepen.filter(([c]) => c === cmd).length,
  };
}

test('nieuwe installatie: eerst native, dan activatie; daarna actief in de lijst', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  const r = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1', bron: 'mcp' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual({ outcome: r.outcome, id: r.id, version: r.version, activated: r.activated, replayed: r.replayed, rolledBack: r.rolledBack },
    { outcome: 'installed', id: ID, version: '1.0.0', activated: true, replayed: false, rolledBack: false });
  assert.deepEqual(r.contributions, { ribbonTabs: [`${ID}.main`], commands: 3 });
  assert.deepEqual(o.aanroepen.map(([c]) => c).slice(0, 4), ['extensie_inspecteer', 'extensie_installeer', 'read_plugin_file', 'extensie_bevestig']);
  // De bron gaat mee naar de native kant: alleen de dialoog mag een netwerkshare gebruiken.
  assert.deepEqual(o.aanroepen[0][1], { pad: 'C:/p/v1.oppx', bron: 'mcp' });
  assert.equal(o.aanroepen[1][1].bron, 'mcp');
  assert.equal(o.transacties.size, 0, 'bevestigd');
  const [ext] = o.lc.lijst();
  assert.deepEqual({ id: ext.id, status: ext.status, activated: ext.activated, loaded: ext.loaded, installed: ext.installed, version: ext.version, source: ext.source },
    { id: ID, status: 'active', activated: true, loaded: true, installed: true, version: '1.0.0', source: 'mcp' });
  assert.equal(ext.lastChange.action, 'installed');
  // Eén keer per wissel: hertekenen, gereedschap, paneel.
  assert.equal(o.tel.naOpruimen, 1);
});

test('idempotentie: herhalen geeft het bewaarde resultaat, een andere aanvraag met dezelfde sleutel wordt geweigerd', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  const eerste = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const tweede = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  assert.equal(tweede.replayed, true);
  assert.equal(tweede.outcome, 'installed');
  assert.equal(o.aantal('extensie_installeer'), 1, 'niet opnieuw gedaan');
  const anders = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'always', sleutel: 'sleutel-1' });
  assert.equal(anders.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(o.aantal('extensie_installeer'), 1);
  assert.equal(eerste.replayed, false);
});

test('idempotentie: gelijktijdige aanroepen met dezelfde sleutel worden samengevoegd', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  const [a, b] = await Promise.all([
    o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'samen-123' }),
    o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'samen-123' }),
  ]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(o.aantal('extensie_installeer'), 1);
  assert.equal(o.tabs().length, 1);
  assert.deepEqual([a.replayed, b.replayed], [false, true]);
});

test('idempotentie: ook mislukte eindresultaten worden bewaard; vervaltermijn en maximum', async () => {
  let klok = 1_000_000;
  const o = opzet({ nu: () => klok });
  o.pakket('C:/p/kapot.oppx', { fout: 'PACKAGE_INVALID' });
  o.pakket('C:/p/ander.oppx', { fout: 'MANIFEST_INVALID' });
  const r1 = await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: 'mislukt-1' });
  assert.equal(r1.code, 'PACKAGE_INVALID');
  const r2 = await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: 'mislukt-1' });
  assert.equal(r2.replayed, true);
  assert.equal(o.aantal('extensie_inspecteer'), 1);
  // Na 24 uur vervalt de sleutel.
  klok += 24 * 60 * 60 * 1000 + 1;
  const r3 = await o.lc.installeer({ pad: 'C:/p/ander.oppx', beleid: 'always', sleutel: 'mislukt-1' });
  assert.equal(r3.code, 'MANIFEST_INVALID');
  assert.equal(r3.replayed, false);
  // Hooguit 200 sleutels: de oudste vervalt eerst.
  for (let i = 0; i < 200; i++) await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: `veel-${i}` });
  const oudste = await o.lc.installeer({ pad: 'C:/p/ander.oppx', beleid: 'always', sleutel: 'mislukt-1' });
  assert.equal(oudste.replayed, false, 'de oudste sleutel is verdrongen');
  const recent = await o.lc.installeer({ pad: 'C:/p/ander.oppx', beleid: 'always', sleutel: 'veel-199' });
  assert.equal(recent.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('bijwerken: de nieuwe versie draait, met precies één tabblad en de nieuwe opdrachten', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/v2.oppx', { version: '1.1.0', code: 'v2' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const r = await o.lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'ifNewer', sleutel: 'sleutel-2' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.outcome, r.version, r.previousVersion], ['updated', '1.1.0', '1.0.0']);
  assert.deepEqual(o.tabs().map((t) => t.label), ['Kozijnen 2']);
  assert.equal(o.tel.deactivate.v1, 1);
  assert.equal(o.opdrachten.lijst('en').length, 3);
  assert.equal(o.lc.lijst()[0].version, '1.1.0');
});

test('vervangbeleid: unchanged, ALREADY_INSTALLED en VERSION_NOT_NEWER laten de draaiende versie staan', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/v1b.oppx', { version: '1.0.0', code: 'v2' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const zelfde = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'always', sleutel: 'sleutel-2' });
  assert.deepEqual([zelfde.ok, zelfde.outcome, zelfde.activated], [true, 'unchanged', true]);
  assert.equal(o.tel.activate.v1, 1, 'niet opnieuw geactiveerd');
  const nooit = await o.lc.installeer({ pad: 'C:/p/v1b.oppx', beleid: 'never', sleutel: 'sleutel-3' });
  assert.equal(nooit.code, 'ALREADY_INSTALLED');
  const nieuwer = await o.lc.installeer({ pad: 'C:/p/v1b.oppx', beleid: 'ifNewer', sleutel: 'sleutel-4' });
  assert.equal(nieuwer.code, 'VERSION_NOT_NEWER');
  assert.deepEqual(nieuwer.active, { version: '1.0.0', activated: true });
  assert.equal(o.tel.deactivate.v1 ?? 0, 0);
  assert.equal(o.tabs().length, 1);
});

test('MODULE_LOAD_FAILED: de nieuwe code laadt niet; terugdraaien en de oude heeft niets gemerkt', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/syntax.oppx', { version: '1.1.0', code: 'SYNTAX' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const r = await o.lc.installeer({ pad: 'C:/p/syntax.oppx', beleid: 'always', sleutel: 'sleutel-2' });
  assert.equal(r.code, 'MODULE_LOAD_FAILED');
  assert.equal(r.rolledBack, true);
  assert.deepEqual(r.active, { version: '1.0.0', activated: true });
  assert.equal(o.tel.deactivate.v1 ?? 0, 0, 'oude versie nooit uitgezet');
  assert.equal(o.aantal('extensie_terugdraaien'), 1);
  assert.equal(o.schijf.get(ID).version, '1.0.0');
  assert.equal(o.tabs().length, 1);
});

for (const [naam, code, verwacht] of [
  ['activate gooit', 'gooit', 'ACTIVATION_FAILED'],
  ['activate wijst asynchroon af', 'wijstAf', 'ACTIVATION_FAILED'],
  ['activate verloopt', 'traag', 'ACTIVATION_TIMEOUT'],
]) {
  test(`terugrollen als ${naam}: oude versie weer actief, nieuwe bijdragen weg`, async () => {
    const o = opzet({ activatieTimeoutMs: 30 });
    o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
    o.pakket('C:/p/kapot.oppx', { version: '1.2.0', code });
    await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
    o.zetActiefTab(`${ID}.main`);
    const r = await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: 'sleutel-2' });
    assert.equal(r.ok, false);
    assert.equal(r.code, verwacht);
    assert.equal(r.rolledBack, true);
    assert.equal(r.activated, false);
    assert.equal(r.version, '1.2.0');
    assert.deepEqual(r.active, { version: '1.0.0', activated: true });
    assert.deepEqual(o.tabs().map((t) => t.label), ['Kozijnen'], 'precies één tabblad, van 1.0.0');
    assert.equal(o.opdrachten.lijst('en').length, 3);
    assert.equal(o.tel.activate.v1, 2, 'oude code opnieuw geactiveerd');
    assert.equal(o.schijf.get(ID).version, '1.0.0', 'op schijf teruggezet');
    assert.equal(o.actiefTab(), `${ID}.main`, 'gebruiker blijft op het tabblad');
    const [ext] = o.lc.lijst();
    assert.equal(ext.status, 'active');
    assert.equal(ext.error.code, verwacht);
  });
}

test('INVALID_CONTRIBUTION binnen activate wordt ACTIVATION_FAILED met de oorzaak', async () => {
  const o = opzet();
  o.pakket('C:/p/x.oppx', { version: '1.0.0', code: 'ongeldigLint' });
  const r = await o.lc.installeer({ pad: 'C:/p/x.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  assert.equal(r.code, 'ACTIVATION_FAILED');
  assert.equal(r.cause, 'INVALID_CONTRIBUTION');
});

test('een eerste installatie die mislukt, laat niets achter', async () => {
  const o = opzet();
  o.pakket('C:/p/kapot.oppx', { version: '1.0.0', code: 'gooit' });
  const r = await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  assert.equal(r.code, 'ACTIVATION_FAILED');
  assert.equal(r.active, null);
  assert.equal(o.schijf.has(ID), false);
  assert.deepEqual(o.lc.lijst(), []);
  assert.deepEqual(o.tabs(), []);
  assert.deepEqual(o.opdrachten.lijst('en'), []);
});

test('ROLLBACK_FAILED: terugzetten op schijf mislukt, de oude code draait wel weer', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/kapot.oppx', { version: '1.2.0', code: 'gooit' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  o.natief.faalTerugdraaien = true;
  const r = await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: 'sleutel-2' });
  assert.equal(r.code, 'ROLLBACK_FAILED');
  assert.equal(r.diskState, 'inconsistent');
  assert.equal(r.cause, 'ACTIVATION_FAILED');
  assert.deepEqual(r.active, { version: '1.0.0', activated: true });
  assert.deepEqual(o.tabs().map((t) => t.label), ['Kozijnen']);
  assert.equal(o.transacties.size, 1, 'journaal blijft voor het herstel bij de volgende start');
});

test('herladen: gecontroleerd uitzetten, opruimen en opnieuw activeren; tabblad blijft actief', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  o.zetActiefTab(`${ID}.main`);
  const voor = o.tel.naOpruimen;
  const r = await o.lc.herlaad(ID, { bron: 'mcp' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.outcome, r.id, r.version, r.activated, r.rolledBack], ['reloaded', ID, '1.0.0', true, false]);
  assert.equal(o.tel.deactivate.v1, 1);
  assert.equal(o.tel.activate.v1, 2);
  assert.equal(o.tabs().length, 1, 'geen dubbel tabblad');
  assert.equal(o.opdrachten.lijst('en').length, 3);
  assert.equal(o.actiefTab(), `${ID}.main`);
  assert.equal(o.tel.naOpruimen, voor + 1);
  assert.deepEqual(o.tel.naOpruimenCtx.at(-1), { typen: ['kozijn'] }, 'met de annotatietypen van de vorige versie');
  assert.equal(o.aantal('extensie_installeer'), 1, 'op schijf verandert niets');
});

test('herladen mislukt: de vorige code uit het geheugen wordt weer actief', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  o.schijf.get(ID).code = 'gooit';
  const r = await o.lc.herlaad(ID, { bron: 'mcp' });
  assert.equal(r.code, 'ACTIVATION_FAILED');
  assert.equal(r.rolledBack, true);
  assert.deepEqual(r.active, { version: '1.0.0', activated: true });
  assert.deepEqual(o.tabs().map((t) => t.label), ['Kozijnen']);
  o.schijf.get(ID).code = 'SYNTAX';
  const s = await o.lc.herlaad(ID, { bron: 'mcp' });
  assert.equal(s.code, 'MODULE_LOAD_FAILED');
  assert.equal(o.tel.deactivate.v1, 1, 'bij een laadfout wordt niets uitgezet');
  assert.equal((await o.lc.herlaad('nl.bestaat.niet', { bron: 'mcp' })).code, 'NOT_INSTALLED');
});

test('een fout in deactivate stopt de wissel niet en wordt een waarschuwing', async () => {
  const o = opzet();
  o.pakket('C:/p/d.oppx', { version: '1.0.0', code: 'deactGooit' });
  await o.lc.installeer({ pad: 'C:/p/d.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const r = await o.lc.herlaad(ID, { bron: 'ui' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code), ['DEACTIVATE_FAILED']);
  assert.equal(o.tabs().length, 1);
});

test('een manifest-export met een ander id overschrijft niets en faalt', async () => {
  const o = opzet();
  o.pakket('C:/p/m.oppx', { version: '1.0.0', code: 'vreemdManifest' });
  const r = await o.lc.installeer({ pad: 'C:/p/m.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  assert.equal(r.code, 'ACTIVATION_FAILED');
  assert.match(r.error, /manifest/);
});

test('wachtOpExtensieWissel en EXTENSION_BUSY tijdens een wissel; de wachtrij serialiseert', async () => {
  const o = opzet({ activatieTimeoutMs: 2000 });
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/v2.oppx', { version: '1.1.0', code: 'v2' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  let klaar = false;
  await o.lc.wachtOpExtensieWissel().then(() => { klaar = true; });
  assert.equal(klaar, true, 'zonder wissel direct klaar');

  const los = o.blokkeer();
  const bijwerken = o.lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'always', sleutel: 'sleutel-2' });
  const herladen = o.lc.herlaad(ID, { bron: 'mcp' });
  while (!o.log.includes('activate v2 start')) await wacht(1);
  assert.equal(o.lc.isBezig(ID), true);
  assert.equal(o.lc.lijst()[0].status, 'busy');
  let opgeslagen = false;
  const opslaan = o.lc.wachtOpExtensieWissel().then(() => { opgeslagen = true; });
  await wacht(10);
  assert.equal(opgeslagen, false, 'opslaan wacht op de wissel');
  los();
  await opslaan;
  assert.equal((await bijwerken).ok, true);
  assert.equal((await herladen).ok, true);
  assert.equal(o.lc.isBezig(ID), false);
  // De herlading begon pas na de installatie.
  assert.deepEqual(o.log.slice(-5), ['activate v2 start', 'activate v2 klaar', 'deactivate v2', 'activate v2 start', 'activate v2 klaar']);
});

test('opstarten: herstel eerst, mislukkingen bewaard met code, problemen doorgegeven', async () => {
  const o = opzet();
  o.schijf.set('nl.goed', { version: '1.0.0', sha256: 'a', code: 'v1', name: 'Goed', source: 'ui' });
  o.schijf.set('nl.kapot', { version: '2.0.0', sha256: 'b', code: 'gooit', name: 'Kapot', source: 'mcp' });
  o.schijf.set('nl.syntax', { version: '3.0.0', sha256: 'c', code: 'SYNTAX', name: 'Syntax', source: 'ui' });
  o.natief.problemen = [{ folder: 'rommel', code: 'MANIFEST_INVALID', message: 'plugin.json is not valid JSON' }];
  await o.lc.laadBijStart();
  assert.deepEqual(o.aanroepen[0], ['extensie_lijst', { herstel: true }]);
  const lijst = await o.lc.lijstVers();
  const per = Object.fromEntries(lijst.extensions.map((e) => [e.id, e]));
  assert.equal(per['nl.goed'].status, 'active');
  assert.equal(per['nl.goed'].lastChange.source, 'startup');
  assert.equal(per['nl.kapot'].status, 'failed');
  assert.equal(per['nl.kapot'].error.code, 'ACTIVATION_FAILED');
  assert.equal(per['nl.kapot'].loaded, true);
  assert.equal(per['nl.kapot'].installedVia, 'mcp');
  assert.equal(per['nl.syntax'].error.code, 'MODULE_LOAD_FAILED');
  assert.equal(per['nl.syntax'].loaded, false);
  assert.deepEqual(lijst.problems, [{ folder: 'rommel', code: 'MANIFEST_INVALID', error: 'plugin.json is not valid JSON' }]);
  // Een mislukte extensie herladen is een gewone laadpoging.
  o.schijf.get('nl.kapot').code = 'v2';
  const r = await o.lc.herlaad('nl.kapot', { bron: 'ui' });
  assert.equal(r.ok, true);
});

test('bijdragen in de lijst op verzoek; verwijderen zet uit en haalt van schijf', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const { extensions } = await o.lc.lijstVers({ includeContributions: true });
  assert.deepEqual(extensions[0].contributions, { ribbonTabs: [`${ID}.main`], commands: 3, annotationTypes: ['kozijn'], palettes: [], propertyPanels: [] });
  assert.equal('contributions' in (await o.lc.lijstVers()).extensions[0], false);
  const r = await o.lc.verwijder(ID, { bron: 'ui' });
  assert.equal(r.ok, true);
  assert.equal(o.tel.deactivate.v1, 1);
  assert.deepEqual(o.tabs(), []);
  assert.equal(o.schijf.has(ID), false);
  assert.deepEqual(o.lc.lijst(), []);
});

test('open documenten blijven ongemoeid; geen tabblad sluiten, herladen of dialoog', async () => {
  const o = opzet();
  const doc1 = { id: 'a', modified: false, annotations: [{ id: 1 }] };
  const doc2 = { id: 'b', modified: true, annotations: [{ id: 2, type: `${ID}:kozijn` }, { id: 3 }] };
  const state = { documents: [doc1, doc2] };
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/v2.oppx', { version: '1.1.0', code: 'v2' });
  o.pakket('C:/p/kapot.oppx', { version: '1.2.0', code: 'gooit' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  await o.lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'ifNewer', sleutel: 'sleutel-2' });
  await o.lc.herlaad(ID, { bron: 'mcp' });
  await o.lc.installeer({ pad: 'C:/p/kapot.oppx', beleid: 'always', sleutel: 'sleutel-3' });
  assert.equal(state.documents[0], doc1);
  assert.equal(state.documents[1], doc2);
  assert.equal(doc2.modified, true);
  assert.equal(doc2.annotations.length, 2);
  // De module krijgt tabbladen, herstart, herladen en dialogen niet eens mee.
  const bron = readFileSync(new URL('./extension-lifecycle.js', import.meta.url), 'utf8');
  const imports = [...bron.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./extension-contributions.js', './opslag-wissel-slot.js']);
  for (const verboden of ['location.reload', 'relaunch', 'dialog', 'closeTab', 'tabs.js', 'state.documents', 'import(']) {
    assert.equal(bron.includes(verboden), false, `extension-lifecycle.js noemt ${verboden}`);
  }
});

test('zetUit: uitzetten zonder van schijf te halen; daarna weer te laden', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  const r = await o.lc.zetUit(ID);
  assert.equal(r.ok, true);
  assert.deepEqual(o.tabs(), []);
  assert.equal(o.schijf.has(ID), true);
  const [ext] = o.lc.lijst();
  assert.deepEqual([ext.status, ext.activated, ext.installed], ['notLoaded', false, true]);
  assert.equal((await o.lc.zetUit(ID)).code, 'NOT_LOADED');
  assert.equal((await o.lc.herlaad(ID)).ok, true);
  assert.equal(o.tabs().length, 1);
});

test('de saver wacht via wachtOpExtensieWissel op de levenscyclus van de app', async () => {
  const o = opzet({ activatieTimeoutMs: 2000 });
  o.pakket('C:/p/v2.oppx', { version: '1.1.0', code: 'v2' });
  await wachtOpExtensieWissel();
  const los = o.blokkeer();
  const installatie = o.lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  while (!o.log.includes('activate v2 start')) await wacht(1);
  let klaar = false;
  const opslaan = wachtOpExtensieWissel().then(() => { klaar = true; });
  await wacht(5);
  assert.equal(klaar, false);
  los();
  await opslaan;
  assert.equal((await installatie).ok, true);
});

test('wie luistert, hoort elke wijziging (zo ververst het extensiepaneel)', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  let keer = 0;
  const stop = o.lc.abonneer(() => { keer++; });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  await wacht(0);
  assert.ok(keer >= 3, `begin en einde van de wissel en na afloop (${keer})`);
  stop();
  const voor = keer;
  await o.lc.herlaad(ID);
  await wacht(0);
  assert.equal(keer, voor);
});

test('CONFIRM_FAILED: lukt bevestigen ook na herhalen niet, dan bewust terug naar de vorige versie', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.pakket('C:/p/v2.oppx', { version: '1.1.0', code: 'v2' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  o.natief.faalBevestigen = 3;
  const r = await o.lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'always', sleutel: 'sleutel-2' });
  assert.equal(r.ok, false, 'geen succes melden dat het herstel later ongedaan maakt');
  assert.equal(r.code, 'CONFIRM_FAILED');
  assert.equal(r.rolledBack, true);
  assert.deepEqual(r.active, { version: '1.0.0', activated: true });
  assert.equal(o.aantal('extensie_bevestig'), 1 + 3, 'drie pogingen');
  assert.equal(o.aantal('extensie_terugdraaien'), 1);
  assert.equal(o.schijf.get(ID).version, '1.0.0', 'op schijf teruggezet');
  assert.equal(o.tel.deactivate.v2, 1, 'de nieuwe versie is weer uitgezet');
  assert.deepEqual(o.tabs().map((t) => t.label), ['Kozijnen']);
  const [ext] = o.lc.lijst();
  assert.deepEqual([ext.status, ext.version, ext.error.code], ['active', '1.0.0', 'CONFIRM_FAILED']);
});

test('bevestigen dat één keer mislukt, slaagt bij de volgende poging', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  o.natief.faalBevestigen = 1;
  const r = await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'never', sleutel: 'sleutel-1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.warnings, []);
  assert.equal(o.aantal('extensie_bevestig'), 2);
  assert.equal(o.transacties.size, 0);
});

test('ACTIVATION_TIMEOUT via MCP: eerst deactivate van de nieuwe module, zodat herladen daarna werkt', async () => {
  const o = opzet({ activatieTimeoutMs: 30 });
  o.pakket('C:/p/b.oppx', { version: '1.0.0', code: 'bewaakt' });
  const los = o.blokkeer();
  const r = await o.lc.installeer({ pad: 'C:/p/b.oppx', beleid: 'never', sleutel: 'sleutel-1', bron: 'mcp' });
  assert.equal(r.code, 'ACTIVATION_TIMEOUT');
  assert.equal(o.tel.deactivate.bewaakt, 1, 'deactivate na de time-out');
  los();
  await wacht(5);
  assert.deepEqual(o.tabs(), [], 'een late registratie laat niets achter');
  o.pakket('C:/p/b2.oppx', { version: '1.0.1', code: 'bewaakt' });
  const opnieuw = await o.lc.installeer({ pad: 'C:/p/b2.oppx', beleid: 'never', sleutel: 'sleutel-2', bron: 'mcp' });
  assert.equal(opnieuw.ok, true, `niet "already active": ${JSON.stringify(opnieuw)}`);
  assert.equal(o.tabs().length, 1);
});

test('ACTIVATION_SLOW bij het opstarten: de extensie blijft actief en houdt haar registraties', async () => {
  const o = opzet({ activatieTimeoutMs: 30 });
  o.schijf.set(ID, { version: '1.0.0', sha256: 'a', code: 'bewaakt', name: 'Bewaakt', source: 'ui' });
  const los = o.blokkeer();
  await o.lc.laadBijStart();
  const [ext] = o.lc.lijst();
  assert.deepEqual([ext.status, ext.activated, ext.error], ['active', true, null]);
  assert.equal(o.tel.deactivate.bewaakt ?? 0, 0, 'niet uitgezet');
  los();
  await wacht(5);
  assert.deepEqual(o.tabs().map((t) => t.label), ['Bewaakt'], 'de late registratie telt');
  // Herladen werkt gewoon: eerst deactivate, dan activate.
  assert.equal((await o.lc.herlaad(ID, { bron: 'ui' })).ok, true);
  assert.equal(o.tabs().length, 1);
});

test('ACTIVATION_SLOW via het paneel: geen terugrol; mislukt activate later, dan opruimen en status failed', async () => {
  const o = opzet({ activatieTimeoutMs: 30 });
  o.pakket('C:/p/t.oppx', { version: '1.0.0', code: 'traagDanKapot' });
  const los = o.blokkeer();
  const r = await o.lc.installeer({ pad: 'C:/p/t.oppx', beleid: 'never', sleutel: 'sleutel-1', bron: 'ui' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.warnings.map((w) => w.code), ['ACTIVATION_SLOW']);
  assert.equal(o.transacties.size, 0, 'bevestigd');
  assert.equal(o.tabs().length, 1);
  los();
  for (let i = 0; i < 100 && o.lc.lijst()[0]?.status !== 'failed'; i++) await wacht(2);
  const [ext] = o.lc.lijst();
  assert.deepEqual([ext.status, ext.activated, ext.error?.code], ['failed', false, 'ACTIVATION_FAILED']);
  assert.deepEqual(o.tabs(), [], 'bijdragen opgeruimd');
  assert.equal(o.tel.deactivate.traagDanKapot, 1);
});

test('eerste keer laden bij het opstarten houdt opslaan niet op; een update wel', async () => {
  const o = opzet({ activatieTimeoutMs: 2000 });
  o.schijf.set(ID, { version: '1.0.0', sha256: 'a', code: 'v2', name: 'Kozijnen', source: 'ui' });
  const los = o.blokkeer();
  const start = o.lc.laadBijStart();
  while (!o.log.includes('activate v2 start')) await wacht(1);
  let opgeslagen = false;
  await metOpslagSlot(async () => { opgeslagen = true; });
  assert.equal(opgeslagen, true, 'opslaan wachtte niet op de eerste activatie');
  los();
  await start;
  // Herladen (er is een vorige versie): opslaan wacht wel.
  const los2 = o.blokkeer();
  o.log.length = 0;
  const herladen = o.lc.herlaad(ID, { bron: 'ui' });
  while (!o.log.includes('activate v2 start')) await wacht(1);
  let tweede = false;
  const save = metOpslagSlot(async () => { tweede = true; });
  await wacht(5);
  assert.equal(tweede, false, 'opslaan wacht op de wissel');
  los2();
  await Promise.all([herladen, save]);
  assert.equal(tweede, true);
});

test('native codes voor een open transactie en een id in andere hoofdletters gaan ongewijzigd door', () => {
  for (const code of ['TRANSACTION_PENDING', 'ID_CASE_CONFLICT', 'PATH_NOT_ALLOWED']) {
    assert.deepEqual(natieveFout(JSON.stringify({ code, message: 'm' })), { code, message: 'm' });
  }
  assert.equal(natieveFout(JSON.stringify({ code: 'IETS_NIEUWS', message: 'm' })).code, 'INSTALL_IO_FAILED');
});

test('installeren via het paneel geeft bron ui mee aan de pakketcontrole', async () => {
  const o = opzet();
  o.pakket('C:/p/v1.oppx', { version: '1.0.0', code: 'v1' });
  await o.lc.installeer({ pad: 'C:/p/v1.oppx', beleid: 'always', sleutel: 'ui-sleutel-1', bron: 'ui' });
  assert.deepEqual(o.aanroepen[0], ['extensie_inspecteer', { pad: 'C:/p/v1.oppx', bron: 'ui' }]);
});
