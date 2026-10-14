// Opdrachtregister voor extensies (#551): elke lintactie en elke keuze van een
// keuzelijst krijgt een `ext:`-opdracht. Klik in het lint en MCP-aanroep lopen
// langs hetzelfde codepad.

import assert from 'node:assert/strict';
import test from 'node:test';

import { maakOpdrachtRegister, opdrachtId } from './extension-commands.js';

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function actie(reg, extra = {}) {
  const toestand = { label: 'Kozijn', title: 'Plaats een kozijn', disabled: false, active: false, ...extra.toestand };
  reg.registreer({
    id: opdrachtId('nl.voorbeeld.kozijnen', 'frame'),
    extId: 'nl.voorbeeld.kozijnen', tab: 'nl.voorbeeld.kozijnen.main', kind: 'action',
    lees: () => toestand,
    voerUit: extra.voerUit ?? (async (ctx) => ({ geplaatst: 1, bron: ctx.source, id: ctx.commandId })),
  });
  return toestand;
}

test('opdracht-id voor actie en keuze', () => {
  assert.equal(opdrachtId('nl.a', 'frame'), 'ext:nl.a:frame');
  assert.equal(opdrachtId('nl.a', 'profile', 'alu'), 'ext:nl.a:profile=alu');
});

test('de lijst heeft de vorm van app_list_commands, met taalkeuze voor het label', () => {
  const reg = maakOpdrachtRegister();
  actie(reg, { toestand: { label: { en: 'Frame', nl: 'Kozijn' } } });
  reg.registreer({
    id: 'ext:nl.voorbeeld.kozijnen:profile=alu', extId: 'nl.voorbeeld.kozijnen',
    tab: 'nl.voorbeeld.kozijnen.main', kind: 'option',
    lees: () => ({ label: 'Aluminium', title: 'Profiel', disabled: false, active: true }),
    voerUit: async () => {},
  });
  assert.deepEqual(reg.lijst('nl'), [
    { command: 'ext:nl.voorbeeld.kozijnen:frame', tab: 'nl.voorbeeld.kozijnen.main', label: 'Kozijn',
      title: 'Plaats een kozijn', disabled: false, active: false, stableId: true,
      extension: 'nl.voorbeeld.kozijnen', kind: 'action' },
    { command: 'ext:nl.voorbeeld.kozijnen:profile=alu', tab: 'nl.voorbeeld.kozijnen.main', label: 'Aluminium',
      title: 'Profiel', disabled: false, active: true, stableId: true,
      extension: 'nl.voorbeeld.kozijnen', kind: 'option' },
  ]);
  assert.equal(reg.lijst('de')[0].label, 'Frame', 'terugval op en');
});

test('uitvoeren met source mcp geeft het gekloonde resultaat', async () => {
  const reg = maakOpdrachtRegister();
  actie(reg);
  const r = await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.deepEqual(r, {
    ok: true, command: 'ext:nl.voorbeeld.kozijnen:frame', extension: 'nl.voorbeeld.kozijnen',
    result: { geplaatst: 1, bron: 'mcp', id: 'ext:nl.voorbeeld.kozijnen:frame' },
  });
});

test('UNKNOWN_COMMAND en COMMAND_DISABLED', async () => {
  const reg = maakOpdrachtRegister();
  assert.equal((await reg.voerUit('ext:nl.x:y', { source: 'mcp' })).code, 'UNKNOWN_COMMAND');
  actie(reg, { toestand: { disabled: true } });
  const r = await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.deepEqual({ ok: r.ok, found: r.found, disabled: r.disabled, code: r.code },
    { ok: false, found: true, disabled: true, code: 'COMMAND_DISABLED' });
});

test('COMMAND_BUSY zolang dezelfde opdracht loopt (ook dubbelklikken)', async () => {
  const reg = maakOpdrachtRegister();
  let klaar;
  actie(reg, { voerUit: () => new Promise((r) => { klaar = r; }) });
  const eerste = reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'ui' });
  const tweede = await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'ui' });
  assert.equal(tweede.code, 'COMMAND_BUSY');
  klaar('ok');
  assert.equal((await eerste).ok, true);
  const derde = reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'ui' });
  assert.equal((await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'ui' })).code, 'COMMAND_BUSY');
  klaar('ok');
  assert.equal((await derde).ok, true, 'na afloop is het slot weer vrij');
});

test('EXTENSION_BUSY als de extensie aan het wisselen is', async () => {
  let bezig = true;
  const reg = maakOpdrachtRegister({ isBezig: (id) => bezig && id === 'nl.voorbeeld.kozijnen' });
  actie(reg);
  assert.equal((await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' })).code, 'EXTENSION_BUSY');
  bezig = false;
  assert.equal((await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' })).ok, true);
});

test('COMMAND_TIMEOUT na de tijdgrens, COMMAND_FAILED bij een fout', async () => {
  const reg = maakOpdrachtRegister({ timeoutMs: 20 });
  actie(reg, { voerUit: () => wacht(200) });
  const r = await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.equal(r.code, 'COMMAND_TIMEOUT');
  assert.equal(reg.loopt('ext:nl.voorbeeld.kozijnen:frame'), true, 'na een time-out loopt de extensie nog');
  assert.equal((await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' })).code, 'COMMAND_BUSY');
  await wacht(250);
  assert.equal(reg.loopt('ext:nl.voorbeeld.kozijnen:frame'), false, 'pas daarna is het slot vrij');
  const reg2 = maakOpdrachtRegister();
  actie(reg2, { voerUit: async () => { throw new Error('kapot'); } });
  const f = await reg2.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.equal(f.code, 'COMMAND_FAILED');
  assert.equal(f.error, 'kapot');
  // Een synchrone fout wordt ook netjes afgevangen.
  const reg3 = maakOpdrachtRegister();
  actie(reg3, { voerUit: () => { throw new Error('sync'); } });
  assert.equal((await reg3.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' })).code, 'COMMAND_FAILED');
});

test('een te groot of onserialiseerbaar resultaat wordt weggelaten met een waarschuwing', async () => {
  const reg = maakOpdrachtRegister();
  actie(reg, { voerUit: async () => 'x'.repeat(70 * 1024) });
  const r = await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.equal(r.ok, true);
  assert.equal('result' in r, false);
  assert.deepEqual(r.warnings.map((w) => w.code), ['RESULT_TOO_LARGE']);
  const reg2 = maakOpdrachtRegister();
  const rond = {}; rond.zelf = rond;
  actie(reg2, { voerUit: async () => rond });
  const r2 = await reg2.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.warnings.map((w) => w.code), ['RESULT_NOT_SERIALIZABLE']);
  const reg3 = maakOpdrachtRegister();
  actie(reg3, { voerUit: async () => undefined });
  const r3 = await reg3.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.deepEqual(r3, { ok: true, command: 'ext:nl.voorbeeld.kozijnen:frame', extension: 'nl.voorbeeld.kozijnen' });
});

test('een opdracht verdwijnt bij verwijderen; dubbel registreren wordt geweigerd', async () => {
  const reg = maakOpdrachtRegister();
  actie(reg);
  assert.throws(() => actie(reg), /already/);
  assert.equal(reg.heeft('ext:nl.voorbeeld.kozijnen:frame'), true);
  reg.verwijder('ext:nl.voorbeeld.kozijnen:frame');
  assert.equal(reg.heeft('ext:nl.voorbeeld.kozijnen:frame'), false);
  assert.deepEqual(reg.lijst('en'), []);
  assert.equal((await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' })).code, 'UNKNOWN_COMMAND');
});

test('wie luistert, hoort wanneer een opdracht loopt en klaar is', async () => {
  const reg = maakOpdrachtRegister();
  actie(reg);
  const gezien = [];
  const stop = reg.abonneer(() => gezien.push(reg.loopt('ext:nl.voorbeeld.kozijnen:frame')));
  await reg.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'ui' });
  stop();
  assert.deepEqual(gezien, [true, false]);
});
