// Opslaan en een extensiewissel sluiten elkaar uit (#550). Eerst het slot
// zelf, daarna met de echte levenscyclus en het echte annotatietyperegister:
// tijdens een save mag het type van een extensie geen moment ontbreken, ook
// niet als er midden in de save een (mislukkende) update binnenkomt.

import assert from 'node:assert/strict';
import test from 'node:test';

import { metOpslagSlot, beginWisselSlot, wachtOpWisselSlot, wisselLoopt, opslagLoopt } from './opslag-wissel-slot.js';
import { maakLevenscyclus } from './extension-lifecycle.js';
import { maakBijdrageScope } from './extension-contributions.js';
import { registerAnnotationType, unregisterAnnotationType, getAnnotationType } from './annotation-type-registry.js';

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const uitgesteld = () => { let los; const p = new Promise((r) => { los = r; }); return { p, los }; };

test('een save die tijdens een wissel binnenkomt, begint pas na de wissel', async () => {
  const log = [];
  const einde = await beginWisselSlot();
  assert.equal(wisselLoopt(), true);
  const save = metOpslagSlot(async () => { log.push('save begint'); return 'opgeslagen'; });
  await wacht(5);
  assert.deepEqual(log, [], 'de save wacht');
  log.push('wissel klaar');
  einde();
  assert.equal(await save, 'opgeslagen');
  assert.deepEqual(log, ['wissel klaar', 'save begint']);
  assert.equal(wisselLoopt(), false);
});

test('een wissel die tijdens een save binnenkomt, begint pas na de save', async () => {
  const log = [];
  const poort = uitgesteld();
  const save = metOpslagSlot(async () => { log.push('save begint'); await poort.p; log.push('save klaar'); });
  assert.equal(opslagLoopt(), true);
  const wissel = beginWisselSlot().then((einde) => { log.push('wissel begint'); einde(); });
  await wacht(5);
  assert.deepEqual(log, ['save begint'], 'de wissel wacht');
  poort.los();
  await Promise.all([save, wissel]);
  assert.deepEqual(log, ['save begint', 'save klaar', 'wissel begint']);
  assert.equal(opslagLoopt(), false);
});

test('saves mogen tegelijk; de wissel wacht op allemaal, ook op een mislukte', async () => {
  const a = uitgesteld();
  const b = uitgesteld();
  const s1 = metOpslagSlot(() => a.p);
  const s2 = metOpslagSlot(async () => { await b.p; throw new Error('schijf vol'); });
  let begonnen = false;
  const wissel = beginWisselSlot().then((einde) => { begonnen = true; einde(); });
  a.los();
  await s1;
  await wacht(2);
  assert.equal(begonnen, false, 'de tweede save loopt nog');
  b.los();
  await assert.rejects(s2, /schijf vol/);
  await wissel;
  assert.equal(begonnen, true);
});

test('wachtOpWisselSlot is direct klaar zonder wissel en wacht anders tot het einde', async () => {
  await wachtOpWisselSlot();
  const einde = await beginWisselSlot();
  let klaar = false;
  const w = wachtOpWisselSlot().then(() => { klaar = true; });
  await wacht(2);
  assert.equal(klaar, false);
  einde();
  einde(); // twee keer kan geen kwaad
  await w;
  assert.equal(klaar, true);
});

// ─── Met de levenscyclus ──────────────────────────────────────────────────

const ID = 'nl.voorbeeld.kozijnen';

function opzet() {
  const schijf = new Map([[ID, { version: '1.0.0', code: 'v1', sha256: 's1' }]]);
  const pakketten = new Map([['C:/p/v2.oppx', { id: ID, version: '2.0.0', code: 'v2', sha256: 's2' }]]);
  const transacties = new Map();
  let n = 0;
  async function invoke(cmd, a = {}) {
    await wacht(1);
    switch (cmd) {
      case 'extensie_lijst': return { extensions: [...schijf].map(([id, d]) => ({ id, version: d.version, sha256: d.sha256 })), problems: [] };
      case 'read_plugin_file': return schijf.get(a.pluginId).code;
      case 'extensie_inspecteer': { const p = pakketten.get(a.pad); return { id: p.id, version: p.version, sha256: p.sha256 }; }
      case 'extensie_installeer': {
        const p = pakketten.get(a.pad);
        const t = `t${++n}`;
        transacties.set(t, schijf.get(p.id));
        schijf.set(p.id, { ...p });
        return { outcome: 'updated', transactie: t, previousVersion: '1.0.0' };
      }
      case 'extensie_terugdraaien': await wacht(15); schijf.set(ID, transacties.get(a.transactie)); return {};
      case 'extensie_bevestig': return {};
      default: throw new Error(cmd);
    }
  }
  const MODULES = {
    v1: () => ({ activate(api) { api.registerAnnotationType('kozijn', { render() {} }); } }),
    v2: () => ({ async activate(api) { api.registerAnnotationType('kozijn', { render() {} }); await wacht(5); throw new Error('v2 kapot'); } }),
  };
  const lc = maakLevenscyclus({
    invoke,
    activatieTimeoutMs: 1000,
    importeer: async (b) => { await wacht(2); return MODULES[b](); },
    maakApi: (id) => {
      const scope = maakBijdrageScope(id);
      const typen = [];
      return {
        registerAnnotationType: (t, h) => { registerAnnotationType(t, h); typen.push(t); },
        _cleanup: () => { for (const t of typen.splice(0)) unregisterAnnotationType(t); return scope.ruimOp(); },
        _bijdragenOverzicht: () => ({ annotationTypes: [...typen] }),
      };
    },
  });
  return { lc };
}

// Een nep-save die tijdens zijn hele looptijd peilt of het type er is.
function nepSave(ms = 60) {
  return metOpslagSlot(async () => {
    const peilingen = [];
    for (let i = 0; i < ms / 3; i++) { peilingen.push(Boolean(getAnnotationType('kozijn'))); await wacht(3); }
    return peilingen;
  });
}

test('een mislukte update midden in een save: het type blijft de hele save geregistreerd', async () => {
  const { lc } = opzet();
  await lc.laadBijStart();
  assert.ok(getAnnotationType('kozijn'), 'v1 actief');
  const save = nepSave();
  await wacht(4);
  const update = lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'always', sleutel: 'race-sleutel-1', bron: 'mcp' });
  const [peilingen, r] = await Promise.all([save, update]);
  assert.ok(peilingen.length > 5);
  assert.equal(peilingen.every(Boolean), true, `type ontbrak tijdens de save: ${peilingen.map(Number).join('')}`);
  assert.equal(r.code, 'ACTIVATION_FAILED');
  assert.equal(r.rolledBack, true);
  assert.ok(getAnnotationType('kozijn'), 'v1 weer actief');
  await lc.zetUit(ID);
});

test('een save die tijdens een mislukte update begint, wacht tot het terugrollen klaar is', async () => {
  const { lc } = opzet();
  await lc.laadBijStart();
  const update = lc.installeer({ pad: 'C:/p/v2.oppx', beleid: 'always', sleutel: 'race-sleutel-2', bron: 'mcp' });
  for (let i = 0; i < 500 && !wisselLoopt(); i++) await wacht(1);
  assert.equal(wisselLoopt(), true, 'de update houdt het wisselslot vast');
  const peilingen = await nepSave(30);
  assert.equal(peilingen.every(Boolean), true, `type ontbrak tijdens de save: ${peilingen.map(Number).join('')}`);
  assert.equal((await update).rolledBack, true);
  await lc.zetUit(ID);
  assert.equal(getAnnotationType('kozijn'), undefined);
});
