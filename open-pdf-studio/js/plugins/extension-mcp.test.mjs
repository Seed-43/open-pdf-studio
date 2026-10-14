// MCP-handlers voor extensies (#550): invoer controleren en het resultaat
// vormen. De levenscyclus zelf is nep; die heeft een eigen test.

import assert from 'node:assert/strict';
import test from 'node:test';

import { maakExtensieMcp } from './extension-mcp.js';

function opzet({ tauri = true } = {}) {
  const aanroepen = [];
  const lc = {
    async lijstVers(opties) {
      aanroepen.push(['lijstVers', opties]);
      return {
        extensions: [{ id: 'nl.a', name: 'A', version: '1.0.0', installed: true, installedVersion: '1.0.0', loaded: true,
          activated: true, status: 'active', error: null, source: 'mcp', installedVia: 'mcp', legacyId: false, lastChange: null,
          ...(opties?.includeContributions ? { contributions: { ribbonTabs: ['nl.a.main'], commands: 3, annotationTypes: [], palettes: [], propertyPanels: [] } } : {}) }],
        problems: [{ folder: 'kapot', code: 'MANIFEST_INVALID', error: 'plugin.json is not valid JSON' }],
      };
    },
    async installeer(args) {
      aanroepen.push(['installeer', args]);
      if (args.pad.endsWith('kapot.oppx')) {
        return { ok: false, code: 'ACTIVATION_FAILED', error: 'activate() threw: kapot', id: 'nl.a', version: '1.2.0',
          activated: false, rolledBack: true, active: { version: '1.1.0', activated: true }, replayed: false, warnings: [] };
      }
      return { ok: true, outcome: 'installed', id: 'nl.a', name: 'A', version: '1.0.0', previousVersion: null, activated: true,
        replayed: false, rolledBack: false, warnings: [], contributions: { ribbonTabs: ['nl.a.main'], commands: 3 } };
    },
    async herlaad(id, opties) {
      aanroepen.push(['herlaad', id, opties]);
      if (id === 'nl.weg') return { ok: false, code: 'NOT_INSTALLED', error: 'extension nl.weg is not installed', id, activated: false, rolledBack: false, active: null };
      return { ok: true, outcome: 'reloaded', id, version: '1.0.0', activated: true, rolledBack: false,
        active: { version: '1.0.0', activated: true }, warnings: [], contributions: { ribbonTabs: [], commands: 0 } };
    },
  };
  const mcp = maakExtensieMcp({ levenscyclus: async () => lc, isTauri: () => tauri });
  return { mcp, aanroepen };
}

const GOED = { path: 'C:\\pakketten\\a.oppx', replace: 'never', idempotencyKey: 'sleutel-01' };

test('app_list_extensions: lijst met telling en problemen, bijdragen alleen op verzoek', async () => {
  const { mcp, aanroepen } = opzet();
  const r = await mcp.handleListExtensions({});
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.extensions[0].status, 'active');
  assert.equal('contributions' in r.extensions[0], false);
  assert.deepEqual(r.problems, [{ folder: 'kapot', code: 'MANIFEST_INVALID', error: 'plugin.json is not valid JSON' }]);
  const m = await mcp.handleListExtensions({ includeContributions: true });
  assert.deepEqual(m.extensions[0].contributions.ribbonTabs, ['nl.a.main']);
  assert.deepEqual(aanroepen.map((a) => a[1]), [{ includeContributions: false }, { includeContributions: true }]);
  assert.equal((await mcp.handleListExtensions(undefined)).ok, true, 'zonder argumenten');
});

test('app_list_extensions: onbekende of verkeerde velden', async () => {
  const { mcp } = opzet();
  assert.equal((await mcp.handleListExtensions({ includeContributions: 'ja' })).code, 'INVALID_ARGUMENT');
  assert.equal((await mcp.handleListExtensions({ filter: 'x' })).code, 'INVALID_ARGUMENT');
  assert.equal((await mcp.handleListExtensions([])).code, 'INVALID_ARGUMENT');
});

test('app_install_extension: alle drie de velden verplicht, enum, sleutelpatroon, geen extra velden', async () => {
  const { mcp, aanroepen } = opzet();
  for (const fout of [
    {}, { ...GOED, path: undefined }, { ...GOED, replace: undefined }, { ...GOED, idempotencyKey: undefined },
    { ...GOED, path: '' }, { ...GOED, path: 12 }, { ...GOED, replace: 'soms' }, { ...GOED, idempotencyKey: 'kort' },
    { ...GOED, idempotencyKey: 'met spatie 123' }, { ...GOED, idempotencyKey: 'x'.repeat(129) },
    { ...GOED, extra: true }, null,
  ]) {
    const r = await mcp.handleInstallExtension(fout);
    assert.equal(r.ok, false, JSON.stringify(fout));
    assert.equal(r.code, 'INVALID_ARGUMENT', JSON.stringify(fout));
  }
  assert.equal(aanroepen.length, 0, 'bij een ongeldige invoer gebeurt er niets');
});

test('app_install_extension: geldige aanvraag gaat door met bron mcp; resultaatvorm bij succes en fout', async () => {
  const { mcp, aanroepen } = opzet();
  const r = await mcp.handleInstallExtension(GOED);
  assert.deepEqual(aanroepen[0], ['installeer', { pad: GOED.path, beleid: 'never', sleutel: 'sleutel-01', bron: 'mcp' }]);
  assert.deepEqual(r, { ok: true, outcome: 'installed', id: 'nl.a', name: 'A', version: '1.0.0', previousVersion: null,
    activated: true, replayed: false, rolledBack: false, warnings: [], contributions: { ribbonTabs: ['nl.a.main'], commands: 3 } });
  const f = await mcp.handleInstallExtension({ ...GOED, path: 'C:\\pakketten\\kapot.oppx', idempotencyKey: 'sleutel-02' });
  assert.deepEqual(f, { ok: false, code: 'ACTIVATION_FAILED', error: 'activate() threw: kapot', id: 'nl.a', version: '1.2.0',
    activated: false, rolledBack: true, active: { version: '1.1.0', activated: true }, replayed: false, warnings: [] });
  for (const k of ['A.b-c_d:e.1', '12345678']) {
    assert.equal((await mcp.handleInstallExtension({ ...GOED, idempotencyKey: k })).ok, true, k);
  }
});

test('app_reload_extension: id verplicht; resultaat en NOT_INSTALLED', async () => {
  const { mcp } = opzet();
  assert.equal((await mcp.handleReloadExtension({})).code, 'INVALID_ARGUMENT');
  assert.equal((await mcp.handleReloadExtension({ id: '' })).code, 'INVALID_ARGUMENT');
  assert.equal((await mcp.handleReloadExtension({ id: 'nl.a', force: true })).code, 'INVALID_ARGUMENT');
  const r = await mcp.handleReloadExtension({ id: 'nl.a' });
  assert.deepEqual([r.ok, r.outcome, r.id, r.activated, r.rolledBack], [true, 'reloaded', 'nl.a', true, false]);
  const n = await mcp.handleReloadExtension({ id: 'nl.weg' });
  assert.deepEqual([n.ok, n.code], [false, 'NOT_INSTALLED']);
});

test('NOT_SUPPORTED zonder Tauri (webbouw), na de invoercontrole', async () => {
  const { mcp, aanroepen } = opzet({ tauri: false });
  assert.equal((await mcp.handleListExtensions({})).code, 'NOT_SUPPORTED');
  assert.equal((await mcp.handleInstallExtension(GOED)).code, 'NOT_SUPPORTED');
  assert.equal((await mcp.handleReloadExtension({ id: 'nl.a' })).code, 'NOT_SUPPORTED');
  assert.equal((await mcp.handleInstallExtension({})).code, 'INVALID_ARGUMENT');
  assert.equal(aanroepen.length, 0);
});

test('een onverwachte fout van de levenscyclus wordt een gestructureerd resultaat', async () => {
  const mcp = maakExtensieMcp({ levenscyclus: async () => ({ installeer: async () => { throw new Error('stuk'); } }), isTauri: () => true });
  const r = await mcp.handleInstallExtension(GOED);
  assert.deepEqual([r.ok, r.code, r.error], [false, 'INSTALL_IO_FAILED', 'stuk']);
});
