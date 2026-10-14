// Het takenregister voor agenttaken van extensies (#556), met een nep-host en
// een nepklok: indienen en valideren, ophalen en beantwoorden per taak-id,
// het resultaatschema, ongeldig worden bij een document-, bron-, pagina- of
// schaalwissel, time-out, afbreken, uitladen en toepassen in één stap.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maakAgentTaken, AgentTaskError, controleerResultaatSchema, toetsResultaat, STATUSSEN,
} from './agent-tasks.js';

// ─── Hulpmiddelen ────────────────────────────────────────────────────────────

function nepKlok() {
  let nu = 1_000_000;
  const timers = new Map();
  let volgende = 1;
  return {
    now: () => nu,
    setTimeout(fn, ms) { const id = volgende++; timers.set(id, { fn, op: nu + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    verder(ms) {
      nu += ms;
      for (const [id, t] of [...timers]) if (t.op <= nu) { timers.delete(id); t.fn(); }
    },
    aantalTimers: () => timers.size,
  };
}

// Twee documenten; het eerste staat voor. Alles is aan te passen in de test.
function nepHost() {
  const docs = new Map([
    ['doc-1', { pageCount: 3, sourceFingerprint: 'fp-1', pageRotations: {}, scale: { document: { pixelsPerUnit: 2, unit: 'mm', scaleRatio: 50 }, regions: [] }, annotations: new Map([['bestaand', 1], ['elders', 2]]) }],
    ['doc-2', { pageCount: 1, sourceFingerprint: 'fp-2', pageRotations: {}, scale: null, annotations: new Map() }],
  ]);
  const host = {
    actief: 'doc-1',
    docs,
    toegepast: [],
    identiteit(documentId, page) {
      const d = docs.get(String(documentId));
      if (!d) return { open: false };
      return {
        open: true, actief: host.actief === String(documentId), documentId, pageCount: d.pageCount,
        sourceFingerprint: d.sourceFingerprint, pageRotation: d.pageRotations[page] || 0,
        scale: d.scale, scaleSignature: JSON.stringify(d.scale),
      };
    },
    annotatiePagina(documentId, id) {
      return docs.get(String(documentId))?.annotations.get(id) ?? null;
    },
    toepassen(documentId, operations) {
      host.toegepast.push({ documentId, operations });
      return { createdIds: operations.filter((o) => o.op === 'create').map((o) => o.annotation.id), updatedIds: [], deletedIds: [] };
    },
  };
  return host;
}

const SCHEMA = {
  type: 'object',
  properties: {
    walls: {
      type: 'array', maxItems: 100,
      items: {
        type: 'object',
        properties: {
          x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
          thicknessMm: { type: 'number', minimum: 10, maximum: 1000 },
        },
        required: ['x1', 'y1', 'x2', 'y2'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    notes: { type: ['string', 'null'], maxLength: 200 },
  },
  required: ['walls'],
};

function opzet() {
  const klok = nepKlok();
  const host = nepHost();
  let n = 0;
  const reg = maakAgentTaken({ host, klok, maakId: () => `agt-${++n}` });
  const ext = reg.maakEigenaar('nl.test.plattegrond');
  const dien = (extra = {}, eigenaar = ext) => reg.dienIn(eigenaar, {
    kind: 'floorplan.recognize', documentId: 'doc-1', page: 1,
    context: { units: 'mm', instructions: 'Find the walls.' }, resultSchema: SCHEMA, ...extra,
  });
  return { klok, host, reg, ext, dien };
}

const GELDIG = { walls: [{ x1: 10, y1: 10, x2: 200, y2: 10, thicknessMm: 100 }], confidence: 0.9, notes: null };

const codeIs = (code) => (e) => e instanceof AgentTaskError && e.code === code;

// ─── Resultaatschema ─────────────────────────────────────────────────────────

test('resultaatschema: alleen sleutelwoorden die de host echt controleert; de wortel is een object', () => {
  assert.doesNotThrow(() => controleerResultaatSchema(SCHEMA));
  const fout = (schema, deel) => assert.throws(() => controleerResultaatSchema(schema),
    (e) => e.code === 'INVALID_SCHEMA' && e.message.includes(deel), deel);
  fout({ type: 'array', items: { type: 'number' } }, 'root must have type "object"');
  fout({ type: ['object', 'null'] }, 'root must have type "object"');
  fout({ type: 'object', properties: { a: { type: 'string', pattern: '^x' } } }, 'unsupported keyword "pattern"');
  fout({ type: 'object', oneOf: [] }, 'unsupported keyword "oneOf"');
  fout({ type: 'object', properties: { a: { type: 'date' } } }, 'type must be');
  fout({ type: 'object', properties: { a: {} } }, 'type must be');
  fout({ type: 'object', required: ['a'] }, 'required field "a" is not in properties');
  fout({ type: 'object', properties: { a: { type: 'string', items: { type: 'string' } } } }, 'items needs type array');
  fout({ type: 'object', properties: { a: { type: 'string', enum: [] } } }, 'enum');
  fout({ type: 'object', properties: { a: { type: 'number', minimum: 'nul' } } }, 'minimum must be a finite number');
  fout({ type: 'object', properties: { a: { type: 'array', maxItems: -1 } } }, 'maxItems');
  let diep = { type: 'object' };
  for (let i = 0; i < 14; i++) diep = { type: 'object', properties: { a: diep } };
  fout(diep, 'nested deeper');
  fout(null, 'must be an object');
});

test('resultaat toetsen: typen, verplichte en onbekende velden, grenzen, geneste lijsten', () => {
  assert.deepEqual(toetsResultaat(SCHEMA, GELDIG), []);
  assert.deepEqual(toetsResultaat(SCHEMA, { walls: [] }), []);
  const m = toetsResultaat(SCHEMA, {
    walls: [{ x1: 1, y1: 2, x2: 'drie', thicknessMm: 5, kleur: 'rood' }],
    confidence: 2, extra: true,
  });
  assert.ok(m.includes('result.walls[0]: missing required field "y2"'), m.join('\n'));
  assert.ok(m.includes('result.walls[0].x2: expected number, got string'));
  assert.ok(m.includes('result.walls[0].thicknessMm: must be at least 10'));
  assert.ok(m.includes('result.walls[0]: unknown field "kleur"'));
  assert.ok(m.includes('result.confidence: must be at most 1'));
  assert.ok(m.includes('result: unknown field "extra"'));
  assert.deepEqual(toetsResultaat(SCHEMA, { walls: 'geen lijst' }), ['result.walls: expected array, got string']);
  assert.deepEqual(toetsResultaat(SCHEMA, []), ['result: expected object, got array']);
  // integer is ook een number, maar een gebroken getal geen integer.
  const tel = { type: 'object', properties: { n: { type: 'integer' }, m: { type: 'number' } } };
  assert.deepEqual(toetsResultaat(tel, { n: 3, m: 3 }), []);
  assert.deepEqual(toetsResultaat(tel, { n: 3.5 }), ['result.n: expected integer, got number']);
  // enum, const, additionalProperties als schema of true.
  const vrij = { type: 'object', properties: { s: { type: 'string', enum: ['a', 'b'] }, c: { type: 'string', const: 'x' } },
    additionalProperties: { type: 'number' } };
  assert.deepEqual(toetsResultaat(vrij, { s: 'a', c: 'x', los: 4 }), []);
  assert.deepEqual(toetsResultaat(vrij, { s: 'z', c: 'y', los: 'vier' }),
    ['result.s: must be one of ["a","b"]', 'result.c: must be "x"', 'result.los: expected number, got string']);
  assert.deepEqual(toetsResultaat({ type: 'object', additionalProperties: true }, { wat: { dan: 1 } }), []);
  // Hooguit twintig meldingen.
  assert.equal(toetsResultaat({ type: 'object' }, Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`v${i}`, i]))).length, 20);
});

// ─── Indienen ────────────────────────────────────────────────────────────────

test('indienen controleert verzoek, document, pagina, schaal, context en schema', () => {
  const { reg, ext, dien, host } = opzet();
  const ongeldig = (extra, code = 'INVALID_ARGUMENT') => assert.throws(() => dien(extra), codeIs(code), JSON.stringify(Object.keys(extra)));
  ongeldig({ onbekend: 1 });
  ongeldig({ kind: 'Plattegrond herkennen' });
  ongeldig({ documentId: undefined });
  ongeldig({ page: 0 });
  ongeldig({ page: 1.5 });
  ongeldig({ context: [] });
  ongeldig({ context: { 'met spatie': 1 } });
  ongeldig({ context: { f: () => 1 } });
  ongeldig({ context: { kaart: new Map() } });
  ongeldig({ context: { n: Number.NaN } });
  ongeldig({ context: { groot: 'x'.repeat(300 * 1024) } });
  ongeldig({ timeoutMs: 10 });
  ongeldig({ timeoutMs: 5_000_000 });
  ongeldig({ requireScale: 'ja' });
  ongeldig({ signal: {} });
  ongeldig({ resultSchema: undefined }, 'INVALID_SCHEMA');
  ongeldig({ resultSchema: { type: 'object', properties: { a: { type: 'string', format: 'uri' } } } }, 'INVALID_SCHEMA');
  ongeldig({ documentId: 'doc-9' }, 'DOCUMENT_NOT_FOUND');
  ongeldig({ documentId: 'doc-2' }, 'DOCUMENT_NOT_ACTIVE');
  ongeldig({ page: 4 }, 'INVALID_PAGE');
  host.docs.get('doc-1').scale = null;
  ongeldig({ requireScale: true }, 'SCALE_REQUIRED');
  assert.doesNotThrow(() => dien({ requireScale: false }).cancel());
  const ac = new AbortController();
  ac.abort();
  ongeldig({ signal: ac.signal }, 'CANCELLED');
  assert.equal(reg.beschikbaarheid().pending, 0, 'niets in de wachtrij na geweigerde verzoeken');
  // Hooguit acht openstaande taken per extensie; een andere extensie telt apart.
  for (let i = 0; i < 8; i++) dien();
  ongeldig({}, 'TOO_MANY_TASKS');
  assert.doesNotThrow(() => dien({}, reg.maakEigenaar('nl.test.ander')));
  assert.equal(ext.taken.size, 8);
});

test('de context wordt bij indienen gekopieerd: later muteren lekt niet naar de agent', () => {
  const { reg, dien } = opzet();
  const context = { units: 'mm', rooms: [{ name: 'A' }] };
  dien({ context });
  context.rooms[0].name = 'gewijzigd';
  context.geheim = 'project';
  const { task } = reg.neemOp();
  assert.deepEqual(task.context, { units: 'mm', rooms: [{ name: 'A' }] });
});

// ─── Ophalen en beantwoorden ─────────────────────────────────────────────────

test('ophalen geeft alleen de taak zelf; beantwoorden levert precies dat resultaat aan die extensie', async () => {
  const { reg, dien } = opzet();
  const taak = dien();
  const statussen = [];
  taak.onStatus((s) => statussen.push(s.status));
  assert.equal(taak.status, 'pending');
  assert.match(taak.taskId, /^agt-/);

  const r = reg.neemOp();
  assert.equal(r.ok, true);
  assert.equal(r.waiting, 0);
  // Precies deze velden: geen gesprek, geen bestandsnaam, geen andere taken.
  assert.deepEqual(Object.keys(r.task).sort(),
    ['attemptsLeft', 'context', 'createdAt', 'deadline', 'document', 'extensionId', 'id', 'kind', 'resultSchema']);
  assert.deepEqual(r.task.document, {
    id: 'doc-1', page: 1, pageCount: 3, sourceFingerprint: 'fp-1', pageRotation: 0,
    scale: { document: { pixelsPerUnit: 2, unit: 'mm', scaleRatio: 50 }, regions: [] },
  });
  assert.deepEqual(r.task.context, { units: 'mm', instructions: 'Find the walls.' });
  assert.deepEqual(r.task.resultSchema, SCHEMA);
  assert.equal(r.task.extensionId, 'nl.test.plattegrond');
  assert.equal(r.task.attemptsLeft, 3);
  assert.equal(r.task.deadline - r.task.createdAt, 600_000);
  assert.equal(taak.status, 'running');
  assert.deepEqual(reg.neemOp(), { ok: true, task: null, waiting: 0 }, 'een opgehaalde taak gaat niet naar een tweede client');

  assert.deepEqual(reg.lever({ id: taak.taskId, result: GELDIG }), { ok: true, id: taak.taskId, status: 'completed' });
  assert.deepEqual(await taak.result, { taskId: taak.taskId, result: GELDIG });
  assert.deepEqual(statussen, ['running', 'completed']);
  assert.deepEqual([...STATUSSEN], ['pending', 'running', 'completed', 'failed', 'cancelled']);
  // Een tweede antwoord op dezelfde taak verandert niets.
  const nogmaals = reg.lever({ id: taak.taskId, result: { walls: [] } });
  assert.equal(nogmaals.code, 'TASK_NOT_RUNNING');
  assert.equal(nogmaals.status, 'completed');
});

test('twee gelijktijdige taken krijgen elk hun eigen resultaat, ook in omgekeerde volgorde', async () => {
  const { reg, dien } = opzet();
  const a = dien({ context: { room: 'A' } });
  const b = dien({ context: { room: 'B' } });
  const eerste = reg.neemOp();
  assert.equal(eerste.task.id, a.taskId, 'de oudste eerst');
  assert.equal(eerste.waiting, 1);
  // B is nog niet opgehaald: beantwoorden kan pas na ophalen.
  assert.equal(reg.lever({ id: b.taskId, result: GELDIG }).code, 'TASK_NOT_CLAIMED');
  const tweede = reg.neemOp();
  assert.equal(tweede.task.id, b.taskId);
  assert.deepEqual(tweede.task.context, { room: 'B' });
  const resultaatB = { walls: [], notes: 'B' };
  const resultaatA = { walls: [], notes: 'A' };
  assert.equal(reg.lever({ id: b.taskId, result: resultaatB }).ok, true);
  assert.equal(reg.lever({ id: a.taskId, result: resultaatA }).ok, true);
  assert.deepEqual((await a.result).result, resultaatA);
  assert.deepEqual((await b.result).result, resultaatB);
  assert.equal(reg.lever({ id: 'agt-onbekend', result: GELDIG }).code, 'UNKNOWN_TASK');
});

test('ophalen per soort; ongeldige argumenten worden geweigerd zonder iets op te halen', () => {
  const { reg, dien } = opzet();
  const kamers = dien({ kind: 'rooms.recognize' });
  const muren = dien();
  assert.equal(reg.neemOp({ kind: 'floorplan.recognize' }).task.id, muren.taskId);
  assert.deepEqual(reg.neemOp({ kind: 'floorplan.recognize' }), { ok: true, task: null, waiting: 0 });
  assert.equal(reg.neemOp({ soort: 'x' }).code, 'INVALID_ARGUMENT');
  assert.equal(reg.neemOp({ kind: 'Met Hoofdletters' }).code, 'INVALID_ARGUMENT');
  assert.equal(reg.neemOp([]).code, 'INVALID_ARGUMENT');
  assert.equal(kamers.status, 'pending');
  for (const fout of [null, {}, { id: kamers.taskId }, { id: kamers.taskId, result: {}, error: { message: 'x' } },
    { id: kamers.taskId, result: {}, extra: 1 }, { id: '', result: {} }]) {
    assert.equal(reg.lever(fout).code, 'INVALID_ARGUMENT', JSON.stringify(fout));
  }
});

test('een ongeldig resultaat wordt geweigerd vóór de extensie het ziet; na drie pogingen faalt de taak', async () => {
  const { reg, dien } = opzet();
  const taak = dien();
  const id = reg.neemOp().task.id;
  const r1 = reg.lever({ id, result: { walls: [{ x1: 1 }], kleur: 'rood' } });
  assert.equal(r1.ok, false);
  assert.equal(r1.code, 'INVALID_RESULT');
  assert.equal(r1.attemptsLeft, 2);
  assert.equal(r1.status, 'running');
  assert.ok(r1.errors.includes('result: unknown field "kleur"'));
  assert.equal(taak.status, 'running', 'de agent mag verbeteren');
  assert.equal(reg.lever({ id, result: 'tekst' }).attemptsLeft, 1);
  const r3 = reg.lever({ id, result: { walls: 3 } });
  assert.equal(r3.attemptsLeft, 0);
  assert.equal(r3.status, 'failed');
  await assert.rejects(taak.result, (e) => e.code === 'INVALID_RESULT' && e.status === 'failed' && e.taskId === id);
  assert.equal(taak.status, 'failed');
});

test('een verbeterd resultaat na een afwijzing wordt aangenomen', async () => {
  const { reg, dien } = opzet();
  const taak = dien();
  const id = reg.neemOp().task.id;
  assert.equal(reg.lever({ id, result: { walls: [], extra: 1 } }).code, 'INVALID_RESULT');
  assert.equal(reg.lever({ id, result: GELDIG }).ok, true);
  assert.deepEqual((await taak.result).result, GELDIG);
  assert.equal(taak.snapshot().attempts, 1);
});

test('de agent kan een taak afwijzen met een fout; de extensie krijgt die als AGENT_ERROR', async () => {
  const { reg, dien } = opzet();
  const taak = dien();
  const id = reg.neemOp().task.id;
  assert.equal(reg.lever({ id, error: { message: '' } }).code, 'INVALID_ARGUMENT');
  assert.equal(reg.lever({ id, error: { message: 'x', stack: 'y' } }).code, 'INVALID_ARGUMENT');
  assert.deepEqual(reg.lever({ id, error: { code: 'NO_WALLS', message: 'No walls on this page.' } }), { ok: true, id, status: 'failed' });
  await assert.rejects(taak.result, (e) => e.code === 'AGENT_ERROR' && e.agentCode === 'NO_WALLS' && /No walls/.test(e.message));
});

// ─── Ongeldig worden ─────────────────────────────────────────────────────────

test('wisselen of sluiten van het document, een andere bron, pagina of schaal annuleert de taak', async () => {
  const gevallen = [
    ['DOCUMENT_SWITCHED', (h) => { h.actief = 'doc-2'; }],
    ['DOCUMENT_CLOSED', (h) => { h.docs.delete('doc-1'); }],
    ['SOURCE_CHANGED', (h) => { h.docs.get('doc-1').sourceFingerprint = 'fp-1b'; }],
    ['PAGE_CHANGED', (h) => { h.docs.get('doc-1').pageRotations[1] = 90; }],
    ['PAGE_CHANGED', (h) => { h.docs.get('doc-1').pageCount = 0; }],
    ['SCALE_CHANGED', (h) => { h.docs.get('doc-1').scale = { document: { pixelsPerUnit: 4, unit: 'mm', scaleRatio: 100 }, regions: [] }; }],
  ];
  for (const [code, wijzig] of gevallen) {
    const { reg, host, dien } = opzet();
    const wachtend = dien();
    const lopend = dien();
    reg.neemOp(); // de eerste loopt nu
    wijzig(host);
    assert.equal(reg.controleer(), 2, code);
    for (const taak of [wachtend, lopend]) {
      assert.equal(taak.status, 'cancelled', code);
      assert.equal(taak.snapshot().code, code);
      await assert.rejects(taak.result, (e) => e.code === code && e.status === 'cancelled');
    }
    // Een laat resultaat wordt geweigerd en verandert niets.
    const laat = reg.lever({ id: wachtend.taskId, result: GELDIG });
    assert.equal(laat.code, 'TASK_NOT_RUNNING', code);
    assert.equal(laat.reason, code);
    assert.equal(reg.neemOp().task, null);
    assert.throws(() => wachtend.applyAnnotationBatch([]), codeIs('TASK_NOT_COMPLETED'));
    assert.equal(host.toegepast.length, 0);
  }
});

test('een wijziging die nog niet gecontroleerd is, wordt bij het antwoord opgemerkt: STALE_TASK', async () => {
  const { reg, host, dien } = opzet();
  const taak = dien();
  const id = reg.neemOp().task.id;
  host.docs.get('doc-1').scale = null;
  const r = reg.lever({ id, result: GELDIG });
  assert.equal(r.code, 'STALE_TASK');
  assert.equal(r.reason, 'SCALE_CHANGED');
  await assert.rejects(taak.result, (e) => e.code === 'SCALE_CHANGED');
});

test('naar een andere pagina bladeren laat de taak staan', () => {
  const { reg, dien } = opzet();
  const taak = dien({ page: 2 });
  assert.equal(reg.controleer(), 0);
  assert.equal(reg.neemOp().task.document.page, 2);
  assert.equal(taak.status, 'running');
  taak.cancel();
});

test('time-out: de taak faalt met TIMEOUT, ook als hij al loopt', async () => {
  const { reg, klok, dien } = opzet();
  const kort = dien({ timeoutMs: 5_000 });
  const lang = dien();
  reg.neemOp();
  klok.verder(5_000);
  assert.equal(kort.status, 'failed');
  await assert.rejects(kort.result, (e) => e.code === 'TIMEOUT');
  assert.equal(reg.lever({ id: kort.taskId, result: GELDIG }).code, 'TASK_NOT_RUNNING');
  assert.equal(lang.status, 'pending');
  klok.verder(600_000);
  assert.equal(lang.status, 'failed');
  assert.equal(klok.aantalTimers(), 0);
});

test('afbreken via cancel() of een AbortSignal annuleert; timers worden opgeruimd', async () => {
  const { reg, klok, dien } = opzet();
  const ac = new AbortController();
  const metSignaal = dien({ signal: ac.signal });
  const handmatig = dien();
  reg.neemOp();
  ac.abort();
  assert.equal(metSignaal.status, 'cancelled');
  await assert.rejects(metSignaal.result, (e) => e.code === 'CANCELLED');
  assert.equal(handmatig.cancel(), true);
  assert.equal(handmatig.cancel(), false, 'een tweede keer doet niets');
  await assert.rejects(handmatig.result, (e) => e.code === 'CANCELLED');
  assert.equal(klok.aantalTimers(), 0);
  assert.equal(reg.beschikbaarheid().pending + reg.beschikbaarheid().running, 0);
});

test('uitladen: luisteraars eerst weg, openstaande taken geannuleerd, voltooide resultaten ingetrokken', async () => {
  const { reg, dien, ext, host } = opzet();
  const ander = reg.maakEigenaar('nl.test.ander');
  const klaar = dien();
  reg.lever({ id: reg.neemOp().task.id, result: GELDIG });
  const lopend = dien();
  reg.neemOp();
  const wachtend = dien();
  const vanAnder = dien({}, ander);
  const gemeld = [];
  for (const t of [klaar, lopend, wachtend]) t.onStatus((s) => gemeld.push(s));
  reg.ruimOp(ext);
  assert.deepEqual(gemeld, [], 'geen terugroep naar een uitgeladen extensie');
  assert.equal(lopend.status, 'cancelled');
  assert.equal(wachtend.status, 'cancelled');
  await assert.rejects(lopend.result, (e) => e.code === 'EXTENSION_UNLOADED');
  await assert.rejects(wachtend.result, (e) => e.code === 'EXTENSION_UNLOADED');
  assert.throws(() => klaar.applyAnnotationBatch([{ op: 'create', annotation: { id: 'w', type: 'line', page: 1 } }]),
    codeIs('EXTENSION_UNLOADED'));
  assert.equal(host.toegepast.length, 0);
  assert.equal(lopend.onStatus(() => {})(), undefined, 'nieuwe luisteraars worden niet meer bewaard');
  assert.throws(() => dien(), codeIs('EXTENSION_INACTIVE'));
  // De taak van een andere extensie blijft staan.
  assert.equal(vanAnder.status, 'pending');
  assert.equal(reg.neemOp().task.id, vanAnder.taskId);
});

// ─── Toepassen ───────────────────────────────────────────────────────────────

test('toepassen: één aanroep van de host, alleen op de taakpagina, alleen één keer', async () => {
  const { reg, host, dien } = opzet();
  const taak = dien();
  assert.throws(() => taak.applyAnnotationBatch([]), codeIs('TASK_NOT_COMPLETED'));
  reg.lever({ id: reg.neemOp().task.id, result: GELDIG });
  await taak.result;
  const maak = (id, page = 1) => ({ op: 'create', annotation: { id, type: 'line', page, startX: 0, startY: 0, endX: 1, endY: 1 } });
  assert.throws(() => taak.applyAnnotationBatch([]), codeIs('INVALID_OPERATION'));
  assert.throws(() => taak.applyAnnotationBatch([maak('a'), maak('b', 2)]), codeIs('INVALID_OPERATION'));
  assert.throws(() => taak.applyAnnotationBatch([{ op: 'delete', id: 'elders' }]), codeIs('INVALID_OPERATION'));
  assert.throws(() => taak.applyAnnotationBatch([{ op: 'update', id: 'bestaand', changes: { page: 2 } }]), codeIs('INVALID_OPERATION'));
  assert.equal(host.toegepast.length, 0, 'een geweigerde batch raakt de host niet');
  const statussen = [];
  taak.onStatus((s) => statussen.push(s));
  const uit = taak.applyAnnotationBatch([maak('a'), { op: 'update', id: 'bestaand', changes: { color: '#f00' } }]);
  assert.deepEqual(uit.createdIds, ['a']);
  assert.equal(host.toegepast.length, 1);
  assert.equal(host.toegepast[0].documentId, 'doc-1');
  assert.equal(statussen.at(-1).applied, true);
  assert.equal(taak.snapshot().applied, true);
  assert.throws(() => taak.applyAnnotationBatch([maak('c')]), codeIs('ALREADY_APPLIED'));
  assert.equal(host.toegepast.length, 1);
});

test('toepassen na een wissel van document of schaal: STALE_TASK, er verandert niets', async () => {
  const { reg, host, dien } = opzet();
  const taak = dien();
  reg.lever({ id: reg.neemOp().task.id, result: GELDIG });
  await taak.result;
  const batch = [{ op: 'create', annotation: { id: 'a', type: 'line', page: 1 } }];
  host.actief = 'doc-2';
  assert.throws(() => taak.applyAnnotationBatch(batch), (e) => e.code === 'STALE_TASK' && e.reason === 'DOCUMENT_SWITCHED');
  host.actief = 'doc-1';
  host.docs.get('doc-1').scale = null;
  assert.throws(() => taak.applyAnnotationBatch(batch), (e) => e.code === 'STALE_TASK' && e.reason === 'SCALE_CHANGED');
  assert.equal(host.toegepast.length, 0);
  // Terug naar precies dezelfde toestand: dan mag het wel.
  host.docs.get('doc-1').scale = { document: { pixelsPerUnit: 2, unit: 'mm', scaleRatio: 50 }, regions: [] };
  assert.deepEqual(taak.applyAnnotationBatch(batch).createdIds, ['a']);
});

// ─── Beschikbaarheid ─────────────────────────────────────────────────────────

test('beschikbaarheid: alleen een agent die taken ophaalt telt, met een venster van dertig seconden', () => {
  const { reg, klok, dien } = opzet();
  assert.deepEqual(reg.beschikbaarheid(), { available: false, lastPollAgeMs: null, pending: 0, running: 0 });
  dien();
  dien();
  reg.neemOp();
  assert.deepEqual(reg.beschikbaarheid(), { available: true, lastPollAgeMs: 0, pending: 1, running: 1 });
  klok.verder(29_999);
  assert.equal(reg.beschikbaarheid().available, true);
  klok.verder(1);
  assert.equal(reg.beschikbaarheid().available, false);
});

test('zonder host is er niets op te halen en kan er niets worden ingediend', () => {
  const reg = maakAgentTaken({ klok: nepKlok() });
  assert.deepEqual(reg.neemOp(), { ok: true, task: null, waiting: 0 });
  assert.throws(() => reg.dienIn(reg.maakEigenaar('nl.x'), { kind: 'a', documentId: 'd', page: 1, resultSchema: { type: 'object' } }),
    codeIs('NOT_AVAILABLE'));
});
