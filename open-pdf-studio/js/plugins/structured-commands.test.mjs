// Gestructureerde opdrachten van extensies (#575): registreren met schema's,
// controleren vóór de handler, idempotentie, revisies, time-out, annuleren en
// herladen; daarna de aansluiting op MCP (brug, Rust, tools.json).
//
// Een synthetische extensie registreert via de echte createPluginApi (met de
// stubs van plugin-api-stubs.mjs) en wordt aangeroepen zoals MCP dat doet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');
const {
  gestructureerdeOpdrachten: dienst, maakOpdrachtDienst, toolNaam, extensieUitTool,
  handleCallExtensionCommand, handleCancelExtensionCommand,
} = await laad('./structured-commands.js');
const { normaliseerSchema, valideerWaarde, isLokaalPad, SchemaFout } = await laad('./json-schema-subset.js');

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const UIT = { type: 'object', properties: { pages: { type: 'integer' } }, required: ['pages'] };
const IN = {
  type: 'object',
  properties: {
    sourcePath: { type: 'string', format: 'local-path' },
    pages: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 50 },
  },
  required: ['pages'],
};

// ─── Schema-deelverzameling ────────────────────────────────────────────────

test('een schema met een trefwoord dat de host niet controleert, wordt geweigerd', () => {
  for (const schema of [
    { type: 'object', oneOf: [] },
    { type: 'object', properties: { a: { $ref: '#/x' } } },
    { type: 'string', format: 'email' },
    { type: 'object', required: ['ontbreekt'] },
    { properties: {} },
    { type: 'string', minLength: 3, maxLength: 2 },
    { type: 'string', pattern: '(' },
  ]) {
    assert.throws(() => normaliseerSchema(schema), SchemaFout, JSON.stringify(schema));
  }
});

test('een object zonder additionalProperties weigert onbekende velden; de fouten noemen het pad', () => {
  const s = normaliseerSchema(IN);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(valideerWaarde(s, { pages: [1, 2] }), []);
  const fouten = valideerWaarde(s, { pages: [0, 'x'], extra: true });
  assert.deepEqual(fouten.map((f) => f.path).sort(), ['/extra', '/pages/0', '/pages/1']);
  assert.match(valideerWaarde(s, {})[0].message, /missing required property "pages"/);
  const open = normaliseerSchema({ type: 'object', additionalProperties: true });
  assert.deepEqual(valideerWaarde(open, { wat: { dan: 1 } }), []);
});

test('local-path is alleen een absoluut, lokaal pad', () => {
  for (const goed of ['C:\\Projecten\\a.pdf', 'd:/tekeningen/b.pdf', '/home/x/c.pdf']) assert.ok(isLokaalPad(goed), goed);
  for (const fout of ['a.pdf', '..\\a.pdf', 'C:\\a\\..\\b.pdf', '\\\\server\\share\\a.pdf', '//server/a.pdf',
    '\\\\?\\C:\\a.pdf', 'file:///C:/a.pdf', 'https://x/a.pdf', 'C:a.pdf', 'C:\\a\u0000.pdf']) {
    assert.equal(isLokaalPad(fout), false, fout);
  }
});

// ─── Registreren ───────────────────────────────────────────────────────────

test('toolnamen zijn eenduidig en omkeerbaar; een te lange naam wordt geweigerd', () => {
  assert.equal(toolNaam('nl.voorbeeld.plafond', 'assign_system'), 'ext_nl_voorbeeld_plafond__assign_system');
  assert.equal(extensieUitTool('ext_nl_voorbeeld_plafond__assign_system'), 'nl.voorbeeld.plafond');
  assert.equal(extensieUitTool('ext_nl_my-ext__x'), 'nl.my-ext');
  assert.equal(extensieUitTool('app_open_pdf'), null);
  const d = maakOpdrachtDienst();
  const basis = { description: 'x', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, handler() {} };
  assert.throws(() => d.controleer('nl.voorbeeld', { ...basis, name: 'Grote_Letters' }), (e) => e.code === 'INVALID_CONTRIBUTION');
  assert.throws(() => d.controleer('nl.voorbeeld', { ...basis, name: 'dubbel__streep' }), (e) => e.code === 'INVALID_CONTRIBUTION');
  assert.throws(() => d.controleer(`nl.${'a'.repeat(40)}`, { ...basis, name: 'nogal_een_lange_naam' }), /longer than 64/);
  assert.throws(() => d.controleer('nl.voorbeeld', { ...basis, name: 'x', onbekend: 1 }), /unknown command field/);
  assert.throws(() => d.controleer('nl.voorbeeld', { ...basis, name: 'x', inputSchema: { type: 'array' } }), /type "object"/);
  assert.throws(() => d.controleer('nl.voorbeeld', {
    ...basis, name: 'x', effect: 'mutate',
    inputSchema: { type: 'object', properties: { idempotencyKey: { type: 'string' } } },
  }), /may not define "idempotencyKey"/);
  assert.throws(() => d.controleer('Hoofdletters', { ...basis, name: 'x' }), /extension id/);
});

test('registreren via de plug-in-API: eigen naamruimte, geen dubbele naam, schema in tools/list', () => {
  const api = createPluginApi('nl.test.diensten');
  assert.equal(api.features.structuredCommands, true);
  const r = api.registerCommand({
    name: 'import_pages', title: { en: 'Import pages', nl: 'Pagina\'s importeren' },
    description: 'Import selected pages into a new drawing.', effect: 'mutate',
    inputSchema: IN, outputSchema: UIT, handler: async () => ({ pages: 1 }),
  });
  assert.deepEqual(r, { tool: 'ext_nl_test_diensten__import_pages', name: 'import_pages' });
  assert.throws(() => api.registerCommand({ name: 'import_pages', description: 'x', inputSchema: IN, outputSchema: UIT, handler() {} }),
    (e) => e.code === 'CONTRIBUTION_CONFLICT');
  const tool = dienst.mcpTools().find((t) => t.name === r.tool);
  assert.equal(tool.annotations.title, 'Import pages');
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.deepEqual(tool.inputSchema.required, ['pages', 'idempotencyKey', 'revisionContext']);
  assert.equal(tool.inputSchema.properties.revisionContext.additionalProperties, false);
  assert.match(tool.description, /\(Extension nl\.test\.diensten\.\)$/);
  const overzicht = api._bijdragenOverzicht().structuredCommands;
  assert.equal(overzicht.length, 1);
  assert.deepEqual(overzicht[0].outputSchema.required, ['pages']);
  api._cleanup();
  assert.equal(dienst.heeft(r.tool), false);
  assert.throws(() => api.registerCommand({ name: 'laat', description: 'x', inputSchema: IN, outputSchema: UIT, handler() {} }),
    (e) => e.code === 'EXTENSION_INACTIVE');
});

// ─── Aanroepen ─────────────────────────────────────────────────────────────

function extensie(id, opdrachten) {
  const api = createPluginApi(id);
  const tools = {};
  for (const o of opdrachten) tools[o.name] = api.registerCommand(o).tool;
  return { api, tools };
}

test('een ongeldig veld wordt geweigerd vóór de handler; geldige argumenten komen losgekoppeld binnen', async () => {
  let aanroepen = 0;
  let ontvangen = null;
  const { api, tools } = extensie('nl.test.lezen', [{
    name: 'describe', description: 'Describe the page bindings.', inputSchema: IN, outputSchema: UIT,
    handler: async (args, ctx) => { aanroepen++; ontvangen = { args, ctx }; return { pages: args.pages.length }; },
  }]);
  for (const fout of [{ pages: [] }, { pages: [1], extra: 1 }, { pages: [1], sourcePath: '\\\\server\\x.pdf' }, 'tekst']) {
    const r = await dienst.roepAan(tools.describe, fout, { source: 'mcp' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_ARGUMENT', JSON.stringify(fout));
    assert.match(r.requestId, /^xc-/);
  }
  const lees = await dienst.roepAan(tools.describe, { pages: [1], idempotencyKey: 'sleutel-1234' });
  assert.equal(lees.code, 'INVALID_ARGUMENT', 'een leesopdracht neemt geen idempotencyKey');
  assert.equal(aanroepen, 0, 'de handler draaide niet');
  const r = await dienst.roepAan(tools.describe, { pages: [3, 4], sourcePath: 'C:\\a.pdf' }, { source: 'mcp' });
  assert.deepEqual({ ok: r.ok, result: r.result, extension: r.extension, command: r.command, replayed: r.replayed },
    { ok: true, result: { pages: 2 }, extension: 'nl.test.lezen', command: 'describe', replayed: false });
  assert.equal(ontvangen.ctx.requestId, r.requestId);
  assert.equal(ontvangen.ctx.source, 'mcp');
  assert.equal(ontvangen.ctx.idempotencyKey, null);
  api._cleanup();
});

test('asynchrone resultaten komen bij de juiste aanvraag, ook in omgekeerde volgorde', async () => {
  const { api, tools } = extensie('nl.test.async', [{
    name: 'echo', description: 'Echo after a delay.',
    inputSchema: { type: 'object', properties: { n: { type: 'integer' }, ms: { type: 'integer' } }, required: ['n', 'ms'] },
    outputSchema: { type: 'object', properties: { n: { type: 'integer' }, requestId: { type: 'string' } } },
    handler: async ({ n, ms }, ctx) => { await wacht(ms); return { n, requestId: ctx.requestId }; },
  }]);
  const [a, b, c] = await Promise.all([
    dienst.roepAan(tools.echo, { n: 1, ms: 60 }),
    dienst.roepAan(tools.echo, { n: 2, ms: 5 }),
    dienst.roepAan(tools.echo, { n: 3, ms: 30 }),
  ]);
  assert.deepEqual([a.result.n, b.result.n, c.result.n], [1, 2, 3]);
  for (const r of [a, b, c]) assert.equal(r.result.requestId, r.requestId);
  assert.equal(new Set([a.requestId, b.requestId, c.requestId]).size, 3);
  api._cleanup();
});

test('een herhaalde wijziging met dezelfde sleutel maakt één resultaat; andere argumenten worden geweigerd', async () => {
  const pdfs = [];
  const { api, tools } = extensie('nl.test.idempotent', [{
    name: 'import_pages', description: 'Import pages into a new drawing.', effect: 'mutate',
    inputSchema: IN, outputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
    handler: async (args, ctx) => {
      await wacht(20);
      if (ctx.signal.aborted) throw new DOMException('afgebroken', 'AbortError');
      pdfs.push(args.pages);
      return { documentId: `doc-${pdfs.length}` };
    },
  }]);
  const context = { sourceRevision: 'bron-7' };
  const aanroep = { pages: [1, 2], idempotencyKey: 'import-0001', revisionContext: context };
  // Zonder sleutel of context: geweigerd.
  assert.equal((await dienst.roepAan(tools.import_pages, { pages: [1] })).code, 'INVALID_ARGUMENT');
  assert.equal((await dienst.roepAan(tools.import_pages, { pages: [1], idempotencyKey: 'import-0001', revisionContext: {} })).code, 'INVALID_ARGUMENT');
  // Twee keer tegelijk en daarna nog eens: één PDF.
  const [eerste, tweede] = await Promise.all([dienst.roepAan(tools.import_pages, aanroep), dienst.roepAan(tools.import_pages, aanroep)]);
  const derde = await dienst.roepAan(tools.import_pages, aanroep);
  assert.equal(pdfs.length, 1);
  assert.equal(eerste.replayed, false);
  assert.equal(tweede.replayed, true);
  assert.equal(derde.replayed, true);
  for (const r of [tweede, derde]) {
    assert.deepEqual(r.result, eerste.result);
    assert.equal(r.requestId, eerste.requestId, 'het requestId van de oorspronkelijke aanvraag');
  }
  const anders = await dienst.roepAan(tools.import_pages, { ...aanroep, pages: [3] });
  assert.equal(anders.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(pdfs.length, 1);
  api._cleanup();
});

test('een mislukte wijziging wordt niet bewaard; dezelfde sleutel mag opnieuw', async () => {
  let keer = 0;
  const { api, tools } = extensie('nl.test.opnieuw', [{
    name: 'refresh_labels', description: 'Refresh quantity labels.', effect: 'mutate',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    handler: async () => {
      keer++;
      if (keer === 1) throw Object.assign(new Error('bron verouderd'), { code: 'STALE_REVISION', details: { currentRevision: 'bron-8' } });
      return {};
    },
  }]);
  const aanroep = { idempotencyKey: 'labels-0001', revisionContext: { sourceRevision: 'bron-7' } };
  const r1 = await dienst.roepAan(tools.refresh_labels, aanroep);
  assert.deepEqual([r1.ok, r1.code, r1.details], [false, 'STALE_REVISION', { currentRevision: 'bron-8' }]);
  const r2 = await dienst.roepAan(tools.refresh_labels, aanroep);
  assert.equal(r2.ok, true);
  assert.equal(keer, 2);
  api._cleanup();
});

test('een verouderde documentrevisie of een onbekend document wordt geweigerd vóór de handler', async () => {
  const documenten = [{ id: 'A', revisie: 'd3', modified: true }, { id: 'B', revisie: 'd0', modified: false }];
  const voor = JSON.stringify(documenten);
  const d = maakOpdrachtDienst({ documentRevisie: (id) => documenten.find((x) => x.id === id)?.revisie ?? null });
  let aanroepen = 0;
  const o = d.controleer('nl.test.revisie', {
    name: 'assign_system', description: 'Assign a project system.', effect: 'mutate',
    inputSchema: { type: 'object', properties: { systemId: { type: 'string' } }, required: ['systemId'] },
    outputSchema: { type: 'object' }, handler: async () => { aanroepen++; return {}; },
  });
  d.voegToe(o);
  const args = (rev, id = 'A', key = 'sys-00001') => ({ systemId: 's1', idempotencyKey: key, revisionContext: { documentId: id, documentRevision: rev } });
  const oud = await d.roepAan(o.tool, args('d2'));
  assert.equal(oud.code, 'STALE_REVISION');
  assert.deepEqual(oud.details, { field: 'revisionContext.documentRevision', currentRevision: 'd3' });
  assert.equal((await d.roepAan(o.tool, args('d0', 'C', 'sys-00002'))).code, 'DOCUMENT_NOT_FOUND');
  assert.equal(aanroepen, 0);
  assert.equal((await d.roepAan(o.tool, args('d3', 'A', 'sys-00003'))).ok, true);
  assert.equal(JSON.stringify(documenten), voor, 'andere tabbladen en hun gewijzigd-vlag blijven ongemoeid');
});

test('het resultaat moet bij het uitvoerschema passen', async () => {
  const { api, tools } = extensie('nl.test.uitvoer', [{
    name: 'bad', description: 'Returns a wrong shape.', inputSchema: { type: 'object' }, outputSchema: UIT,
    handler: async () => ({ pages: 'twee' }),
  }]);
  const r = await dienst.roepAan(tools.bad, {});
  assert.equal(r.code, 'RESULT_INVALID');
  assert.equal(r.details[0].path, '/pages');
  api._cleanup();
});

test('na de tijdgrens volgt COMMAND_TIMEOUT met een afgebroken signaal; de sleutel geeft later de uitkomst', async () => {
  let signaal = null;
  let gemaakt = 0;
  const { api, tools } = extensie('nl.test.traag', [{
    name: 'slow', description: 'Slow change.', effect: 'mutate', timeoutMs: 1000,
    inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { klaar: { type: 'boolean' } } },
    handler: async (_args, ctx) => { signaal = ctx.signal; await wacht(1300); gemaakt++; return { klaar: true }; },
  }]);
  const aanroep = { idempotencyKey: 'traag-00001', revisionContext: { sourceRevision: 'r1' } };
  const r = await dienst.roepAan(tools.slow, aanroep);
  assert.equal(r.code, 'COMMAND_TIMEOUT');
  assert.equal(signaal.aborted, true);
  const later = await dienst.roepAan(tools.slow, aanroep);
  assert.equal(later.ok, true);
  assert.equal(later.replayed, true);
  assert.equal(gemaakt, 1, 'de herhaling maakte niets opnieuw');
  api._cleanup();
});

test('herladen annuleert lopende aanroepen, ruimt de handlers op en laat geen dubbele tools achter', async () => {
  const ID = 'nl.test.herladen.diensten';
  const opdracht = (versie, gezien) => ({
    name: 'select_project_system', description: 'Select a project system.',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { versie: { type: 'integer' } } },
    handler: async (_args, ctx) => {
      gezien.push(ctx.signal);
      await wacht(versie === 1 ? 200 : 0);
      return { versie };
    },
  });
  const signalen = [];
  const oud = createPluginApi(ID);
  const { tool } = oud.registerCommand(opdracht(1, signalen));
  const lopend = dienst.roepAan(tool, {});
  await wacht(10);
  oud._cleanup();
  const r = await lopend;
  assert.equal(r.code, 'EXTENSION_UNLOADED');
  assert.equal(signalen[0].aborted, true);
  assert.equal(dienst.heeft(tool), false);
  assert.equal(dienst.aantalLopend(), 0);
  const nieuw = createPluginApi(ID);
  nieuw.registerCommand(opdracht(2, []));
  // De oude API haalt de opdracht van de nieuwe versie niet weg.
  assert.equal(oud.unregisterCommand('select_project_system'), false);
  assert.equal(dienst.mcpTools().filter((t) => t.name === tool).length, 1);
  assert.deepEqual((await dienst.roepAan(tool, {})).result, { versie: 2 });
  assert.equal(nieuw.unregisterCommand('select_project_system'), true);
  assert.equal(dienst.heeft(tool), false);
  nieuw._cleanup();
});

test('annuleren op het JSON-RPC-id en EXTENSION_BUSY tijdens een wissel', async () => {
  let signaal = null;
  const d = maakOpdrachtDienst();
  const o = d.controleer('nl.test.annuleren', {
    name: 'toggle_quantity_labels', description: 'Toggle labels.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    handler: (_a, ctx) => new Promise((klaar, weiger) => {
      signaal = ctx.signal;
      ctx.signal.addEventListener('abort', () => weiger(new DOMException('afgebroken', 'AbortError')));
    }),
  });
  d.voegToe(o);
  const lopend = handleCallExtensionCommand({ tool: o.tool, arguments: {}, rpcId: 42 }, d);
  await wacht(5);
  assert.deepEqual(handleCancelExtensionCommand({ rpcId: 42 }, d), { ok: true, cancelled: 1 });
  const r = await lopend;
  assert.equal(r.code, 'COMMAND_CANCELLED');
  assert.equal(signaal.aborted, true);
  d.zetWisselControle((id) => id === 'nl.test.annuleren');
  assert.equal((await d.roepAan(o.tool, {})).code, 'EXTENSION_BUSY');
});

test('app_call_extension_command: tool en arguments, verder niets', async () => {
  const d = maakOpdrachtDienst();
  const o = d.controleer('nl.test.generiek', {
    name: 'ping', description: 'Ping.', inputSchema: { type: 'object', properties: { x: { type: 'integer' } } },
    outputSchema: { type: 'object', additionalProperties: true }, handler: async ({ x }) => ({ x }),
  });
  d.voegToe(o);
  const r = await handleCallExtensionCommand({ generic: true, call: { tool: o.tool, arguments: { x: 5 } }, rpcId: 1 }, d);
  assert.deepEqual(r.result, { x: 5 });
  assert.equal((await handleCallExtensionCommand({ generic: true, call: { tool: o.tool, extra: 1 } }, d)).code, 'INVALID_ARGUMENT');
  assert.equal((await handleCallExtensionCommand({ generic: true, call: { tool: 'ext_nl_test_generiek__onbekend' } }, d)).code, 'UNKNOWN_COMMAND');
  assert.equal((await handleCallExtensionCommand({ generic: true, call: { tool: 'app_open_pdf' } }, d)).code, 'UNKNOWN_COMMAND');
});

// ─── Aansluiting op MCP ────────────────────────────────────────────────────

test('de brug, Rust en tools.json kennen de opdrachten van extensies', () => {
  const brug = lees('../mcp-bridge.js');
  assert.match(brug, /'mcp:call-extension-command':\s+\(p\) => import\('\.\/plugins\/structured-commands\.js'\)\.then\(\(m\) => m\.handleCallExtensionCommand\(p\)\)/);
  assert.match(brug, /'mcp:cancel-extension-command': \(p\) => import\('\.\/plugins\/structured-commands\.js'\)\.then\(\(m\) => m\.handleCancelExtensionCommand\(p\)\)/);
  assert.match(brug, /invoke\('mcp_set_extension_tools', \{ tools: gestructureerdeOpdrachten\.mcpTools\(\), seq \}\)/);
  const rs = lees('../../src-tauri/src/mcp_server.rs');
  assert.match(rs, /"tools\/list" => rpc_result\(id, tools_list_met_extensies\(&state\)\)/);
  assert.match(rs, /"notifications\/cancelled" =>/);
  assert.match(rs, /tool_app_request\(state, "mcp:call-extension-command", &payload, Duration::from_secs\(125\)\)/);
  assert.match(lees('../../src-tauri/src/lib.rs'), /mcp_extensie_tools::mcp_set_extension_tools,/);
  assert.match(lees('../../src-tauri/src/mcp_tool_meta.rs'), /wijzigt\("app_call_extension_command", "Run extension command"\)/);
  // De vaste definitie is gelijk aan die in tools.json.
  const start = rs.indexOf('fn call_extension_command_tool() -> Value {');
  const blok = rs.slice(start, rs.indexOf('\n}\n', start));
  const def = JSON.parse(blok.slice(blok.indexOf('json!(') + 6, blok.lastIndexOf(')')));
  const tools = JSON.parse(lees('../../../mcp-stdio/tools.json'));
  const opSchijf = tools.find((t) => t.name === 'app_call_extension_command');
  assert.equal(opSchijf.description, def.description);
  assert.deepEqual(opSchijf.inputSchema, def.inputSchema);
  assert.deepEqual(opSchijf.annotations, { destructiveHint: true, openWorldHint: false, readOnlyHint: false, title: 'Run extension command' });
  assert.ok(JSON.parse(lees('../../../mcpb/manifest.json')).tools.some((t) => t.name === 'app_call_extension_command'));
  // Elke toolnaam uit de WebView past op de Rust-regel (geldige_naam).
  for (const t of [toolNaam('nl.voorbeeld.plafond', 'assign_system'), toolNaam('a', 'b')]) {
    assert.match(t, /^ext_[a-z0-9_-]+__[a-z0-9_-]+$/);
    assert.ok(t.length <= 64);
  }
});
