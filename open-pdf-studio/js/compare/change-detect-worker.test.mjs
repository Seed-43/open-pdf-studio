// Wijzigingsdetectie buiten de hoofdthread (#465): berichtprotocol, het
// negeren van ingehaalde aanvragen, de synchrone terugval en gelijkheid van
// resultaten tussen de directe aanroep en het worker-pad (echte worker_threads
// met het echte workerbestand).

import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { detectChanges } from './change-detector.js';
import {
  DETECT_REQUEST, DETECT_RESULT, DETECT_ERROR, WORKER_UNAVAILABLE,
  buildDetectRequest, handleDetectMessage, attachDetectWorker, createDetectClient,
} from './change-detect-protocol.js';

// ── Testbeelden ────────────────────────────────────────────────────────────

function wit(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(255);
  return { width: w, height: h, data };
}

function rechthoek(img, x0, y0, w, h, grijs = 0) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = grijs;
      img.data[p + 3] = 255;
    }
  }
}

// Deterministische pseudo-random tekening: lijnen en blokken, met een tweede
// revisie waarin een deel is verplaatst, verwijderd en toegevoegd.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tekeningPaar(w, h, seed) {
  const r = rng(seed);
  const oud = wit(w, h);
  const nieuw = wit(w, h);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h);
    const horizontaal = r() < 0.5;
    const len = 10 + Math.floor(r() * 120);
    const dik = 1 + Math.floor(r() * 3);
    const lw = horizontaal ? len : dik, lh = horizontaal ? dik : len;
    const lot = r();
    if (lot < 0.7) { rechthoek(oud, x, y, lw, lh); rechthoek(nieuw, x, y, lw, lh); }
    else if (lot < 0.8) rechthoek(oud, x, y, lw, lh);              // verwijderd
    else if (lot < 0.9) rechthoek(nieuw, x, y, lw, lh);            // toegevoegd
    else { rechthoek(oud, x, y, lw, lh); rechthoek(nieuw, x + 5, y + 3, lw, lh); } // verplaatst
  }
  // Wat ruis en een lichtgrijze (niet-inkt) wijziging.
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h);
    rechthoek(r() < 0.5 ? oud : nieuw, x, y, 1, 1);
  }
  rechthoek(nieuw, 5, 5, 30, 30, 200);
  return { oud, nieuw };
}

function kloon(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

// ── Nep-worker voor de protocol- en stale-tests ────────────────────────────

function nepWorker() {
  const w = {
    gestuurd: [],
    transfers: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(msg, transfer) { this.gestuurd.push(msg); this.transfers.push(transfer || []); },
    terminate() { this.terminated = true; },
    antwoord(i = 0, detect = detectChanges) {
      const reply = handleDetectMessage(this.gestuurd[i], detect);
      this.onmessage({ data: reply });
    },
  };
  return w;
}

const tick = () => new Promise((r) => setImmediate(r));

// ── Protocol ───────────────────────────────────────────────────────────────

test('buildDetectRequest: berichtvorm en transferlijst', () => {
  const a = wit(4, 3), b = wit(4, 3);
  const { message, transfer } = buildDetectRequest(7, a, b, { transferOld: true });
  assert.equal(message.type, DETECT_REQUEST);
  assert.equal(message.id, 7);
  assert.deepEqual([message.old.width, message.old.height], [4, 3]);
  assert.equal(message.old.data, a.data);
  assert.equal(message.new.data, b.data);
  assert.equal('threshold' in message, false, 'geen drempel = standaarddrempel van detectChanges');
  assert.deepEqual(transfer, [a.data.buffer]);

  const beide = buildDetectRequest(8, a, b, { transferOld: true, transferNew: true, threshold: 300 });
  assert.equal(beide.message.threshold, 300);
  assert.deepEqual(beide.transfer, [a.data.buffer, b.data.buffer]);
  assert.deepEqual(buildDetectRequest(9, a, b).transfer, []);
});

test('buildDetectRequest: dezelfde buffer aan beide kanten wordt maar één keer overgedragen', () => {
  const a = wit(2, 2);
  const { transfer } = buildDetectRequest(1, a, a, { transferOld: true, transferNew: true });
  assert.deepEqual(transfer, [a.data.buffer]);
});

test('handleDetectMessage: resultaat, fout en vreemde berichten', () => {
  const { oud, nieuw } = tekeningPaar(120, 90, 3);
  const { message } = buildDetectRequest(4, oud, nieuw);
  const reply = handleDetectMessage(message);
  assert.equal(reply.type, DETECT_RESULT);
  assert.equal(reply.id, 4);
  assert.deepEqual(reply.changes, detectChanges(oud, nieuw));

  const fout = handleDetectMessage(message, () => { throw new Error('kapot'); });
  assert.deepEqual(fout, { type: DETECT_ERROR, id: 4, error: 'kapot' });

  assert.equal(handleDetectMessage(null), null);
  assert.equal(handleDetectMessage({ type: 'iets-anders' }), null);
});

test('handleDetectMessage geeft de drempel alleen door als hij is meegegeven', () => {
  const args = [];
  const spion = (...a) => { args.push(a.length); return []; };
  handleDetectMessage(buildDetectRequest(1, wit(1, 1), wit(1, 1)).message, spion);
  handleDetectMessage(buildDetectRequest(2, wit(1, 1), wit(1, 1), { threshold: 10 }).message, spion);
  assert.deepEqual(args, [2, 3]);
});

test('attachDetectWorker beantwoordt via de scope', () => {
  const scope = { berichten: [], postMessage(m) { this.berichten.push(m); } };
  attachDetectWorker(scope, () => [{ type: 'added' }]);
  scope.onmessage({ data: { type: 'ruis' } });
  scope.onmessage({ data: buildDetectRequest(5, wit(1, 1), wit(1, 1)).message });
  assert.deepEqual(scope.berichten, [{ type: DETECT_RESULT, id: 5, changes: [{ type: 'added' }] }]);
});

// ── Client: stale-afhandeling ──────────────────────────────────────────────

test('client: één taak tegelijk; wachtende aanvraag wordt vervangen door de nieuwste', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const { oud, nieuw } = tekeningPaar(100, 80, 11);

  const pA = client.run(kloon(oud), kloon(nieuw), { id: 1 });
  const pB = client.run(kloon(oud), kloon(nieuw), { id: 2 });
  const pC = client.run(kloon(oud), kloon(nieuw), { id: 3 });
  assert.equal(w.gestuurd.length, 1, 'alleen A is verstuurd');
  assert.equal(w.gestuurd[0].id, 1);

  // B is ingehaald door C voordat hij aan de beurt was: nooit verstuurd.
  assert.deepEqual(await pB, { id: 2, changes: null, stale: true });

  w.antwoord(0);
  const a = await pA;
  assert.equal(a.stale, true, 'A is onderweg ingehaald');
  assert.deepEqual(a.changes, detectChanges(oud, nieuw), 'maar zijn resultaat klopt voor zijn eigen invoer');

  assert.equal(w.gestuurd.length, 2, 'C wordt verstuurd zodra A klaar is');
  assert.equal(w.gestuurd[1].id, 3);
  w.antwoord(1);
  const c = await pC;
  assert.equal(c.stale, false);
  assert.deepEqual(c.changes, detectChanges(oud, nieuw));
});

test('client: aanvraag met een ouder id dan de nieuwste wordt direct stale', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const p5 = client.run(wit(2, 2), wit(2, 2), { id: 5 });
  // Een trage oudere taak (bijv. rasteren duurde langer) komt pas na 5 aan.
  assert.deepEqual(await client.run(wit(2, 2), wit(2, 2), { id: 4 }), { id: 4, changes: null, stale: true });
  assert.equal(w.gestuurd.length, 1);
  assert.equal(client.latestId(), 5);
  w.antwoord(0);
  assert.equal((await p5).stale, false);
});

test('client: antwoorden met een onbekend id worden genegeerd', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const p = client.run(wit(2, 2), wit(2, 2), { id: 1 });
  w.onmessage({ data: { type: DETECT_RESULT, id: 99, changes: ['vals'] } });
  w.onmessage({ data: null });
  w.antwoord(0);
  assert.deepEqual(await p, { id: 1, changes: [], stale: false });
});

test('client: zonder id telt hij zelf op', async () => {
  const client = createDetectClient();
  const a = await client.run(wit(2, 2), wit(2, 2));
  const b = await client.run(wit(2, 2), wit(2, 2));
  assert.deepEqual([a.id, b.id], [1, 2]);
});

test('client: oude buffer wordt overgedragen, nieuwe niet', () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const oud = wit(3, 3), nieuw = wit(3, 3);
  client.run(oud, nieuw, { id: 1, transferOld: true });
  assert.deepEqual(w.transfers[0], [oud.data.buffer]);
});

test('client: fout in de detectie geeft een gewone reject en de worker blijft', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const p1 = client.run(wit(2, 2), wit(2, 2), { id: 1 });
  w.antwoord(0, () => { throw new Error('boem'); });
  await assert.rejects(p1, (e) => e.message === 'boem' && e.code !== WORKER_UNAVAILABLE);
  assert.equal(client.usesWorker(), true);
  const p2 = client.run(wit(2, 2), wit(2, 2), { id: 2 });
  assert.equal(w.gestuurd.length, 2);
  w.antwoord(1);
  assert.equal((await p2).stale, false);
});

test('client: falende worker → WORKER_UNAVAILABLE voor lopende en wachtende taak, daarna synchroon', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const { oud, nieuw } = tekeningPaar(90, 70, 21);
  const p1 = client.run(kloon(oud), kloon(nieuw), { id: 1 });
  const p2 = client.run(kloon(oud), kloon(nieuw), { id: 2 });
  let voorkomen = false;
  w.onerror({ message: 'laden mislukt', preventDefault() { voorkomen = true; } });
  await assert.rejects(p1, (e) => e.code === WORKER_UNAVAILABLE);
  await assert.rejects(p2, (e) => e.code === WORKER_UNAVAILABLE);
  assert.equal(voorkomen, true);
  assert.equal(w.terminated, true);
  assert.equal(client.usesWorker(), false);

  const r = await client.run(kloon(oud), kloon(nieuw), { id: 3 });
  assert.deepEqual(r, { id: 3, changes: detectChanges(oud, nieuw), stale: false });
  assert.equal(w.gestuurd.length, 1, 'niets meer naar de dode worker');
});

test('client: postMessage die gooit (DataCloneError) schakelt over op synchroon', async () => {
  const client = createDetectClient({
    createWorker: () => ({ postMessage() { throw new Error('DataCloneError'); }, terminate() {} }),
  });
  await assert.rejects(client.run(wit(2, 2), wit(2, 2), { id: 1 }), (e) => e.code === WORKER_UNAVAILABLE);
  assert.equal(client.usesWorker(), false);
  assert.equal((await client.run(wit(2, 2), wit(2, 2), { id: 2 })).stale, false);
});

test('client: geen Worker (null of exceptie) → synchrone terugval met hetzelfde resultaat', async () => {
  const { oud, nieuw } = tekeningPaar(160, 120, 5);
  const verwacht = detectChanges(oud, nieuw);
  for (const createWorker of [undefined, () => null, () => { throw new Error('SecurityError'); }]) {
    const client = createDetectClient({ createWorker });
    const r = await client.run(kloon(oud), kloon(nieuw), { id: 1, transferOld: true });
    assert.deepEqual(r, { id: 1, changes: verwacht, stale: false });
    assert.equal(client.usesWorker(), false);
  }
});

test('client: dispose lost openstaande taken op als stale en stopt de worker', async () => {
  const w = nepWorker();
  const client = createDetectClient({ createWorker: () => w });
  const p1 = client.run(wit(2, 2), wit(2, 2), { id: 1 });
  const p2 = client.run(wit(2, 2), wit(2, 2), { id: 2 });
  client.dispose();
  assert.deepEqual(await p1, { id: 1, changes: null, stale: true });
  assert.deepEqual(await p2, { id: 2, changes: null, stale: true });
  assert.equal(w.terminated, true);
});

// ── Gelijkheid: directe aanroep vs. echte worker-thread ────────────────────

// Laat het echte change-detect.worker.js draaien in een worker_threads-thread,
// met een `self` die zich gedraagt als een DedicatedWorkerGlobalScope.
function threadWorker() {
  const workerUrl = new URL('./change-detect.worker.js', import.meta.url).href;
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const scope = {
      postMessage: (m, t) => parentPort.postMessage(m, t),
      set onmessage(fn) { parentPort.on('message', (data) => fn({ data })); },
    };
    globalThis.self = scope;
    import(workerData.url).catch((e) => { throw e; });
  `;
  const t = new NodeWorker(code, { eval: true, workerData: { url: workerUrl } });
  const w = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (m, transfer) => t.postMessage(m, transfer),
    terminate: () => t.terminate(),
  };
  t.on('message', (data) => w.onmessage && w.onmessage({ data }));
  t.on('error', (err) => w.onerror && w.onerror({ message: err.message }));
  return w;
}

test('gelijkheid: directe aanroep en worker-thread geven exact dezelfde wijzigingen', async () => {
  const client = createDetectClient({ createWorker: threadWorker });
  try {
    const gevallen = [
      tekeningPaar(400, 300, 1),
      tekeningPaar(640, 452, 2),
      tekeningPaar(257, 513, 99),
      { oud: wit(50, 50), nieuw: wit(50, 50) },
    ];
    let id = 0;
    for (const { oud, nieuw } of gevallen) {
      const verwacht = detectChanges(oud, nieuw);
      const oudKopie = kloon(oud);
      const r = await client.run(oudKopie, kloon(nieuw), { id: ++id, transferOld: true });
      assert.equal(r.stale, false);
      assert.deepEqual(r.changes, verwacht);
      assert.equal(oudKopie.data.byteLength, 0, 'oude buffer is overgedragen (ontkoppeld)');
    }
    assert.ok(gevallen.slice(0, 3).every(({ oud, nieuw }) => detectChanges(oud, nieuw).length > 0),
      'de testtekeningen bevatten echte wijzigingen');
    assert.equal(client.usesWorker(), true);

    // Met expliciete drempel ook gelijk.
    const { oud, nieuw } = gevallen[0];
    const r = await client.run(kloon(oud), kloon(nieuw), { id: ++id, threshold: 300 });
    assert.deepEqual(r.changes, detectChanges(oud, nieuw, 300));

    // Snel achter elkaar: alleen de laatste is actueel, en die klopt.
    const ps = [1, 2, 3, 4].map((k) => client.run(kloon(gevallen[k % 3].oud), kloon(gevallen[k % 3].nieuw), { id: ++id }));
    const rs = await Promise.all(ps);
    assert.deepEqual(rs.map((x) => x.stale), [true, true, true, false]);
    assert.equal(rs[1].changes, null);
    assert.equal(rs[2].changes, null);
    assert.deepEqual(rs[0].changes, detectChanges(gevallen[1].oud, gevallen[1].nieuw));
    assert.deepEqual(rs[3].changes, detectChanges(gevallen[1].oud, gevallen[1].nieuw));
  } finally {
    client.dispose();
    await tick();
  }
});
