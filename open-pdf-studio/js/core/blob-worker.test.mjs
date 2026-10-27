// Workers uit een blob:-adres in de gehoste bouw (#704): de starter laadt
// het script uit de bundel, een module met import() en vastgehouden
// berichten; de shim vervangt alleen http(s)-adressen.
//
// Dat de starter echt draait in een opaque sandbox onder de strikte CSP,
// toetsen scripts/test-gehost-csp.mjs en scripts/gehost-brug-e2e.mjs in
// Chromium.

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { blobWorkerCode, maakBlobWorker, installeerWorkerShim, STARTER_OPRUIMEN_MS } from './blob-worker.js';

const BUNDEL = 'https://klant.example/werkplek/app/pdf/';

/** Een nepomgeving die bijhoudt welke workers en blobs er gemaakt worden. */
function nepOmgeving() {
  const gemaakt = [];
  const blobs = new Map();
  const ingetrokken = [];
  const timers = [];
  class NepWorker {
    constructor(url, opties) { this.url = url; this.opties = opties; gemaakt.push(this); }
  }
  class NepBlob {
    constructor(delen, opties) { this.tekst = delen.join(''); this.type = opties?.type; }
  }
  let n = 0;
  const NepURL = class extends URL {
    static createObjectURL(blob) { const u = `blob:null/${++n}`; blobs.set(u, blob); return u; }
    static revokeObjectURL(u) { ingetrokken.push(u); }
  };
  return {
    gemaakt, blobs, ingetrokken, timers, NepWorker, NepBlob, NepURL,
    omgeving: {
      Worker: NepWorker, Blob: NepBlob, URL: NepURL, basis: `${BUNDEL}index.html#ouder=x`,
      setTimeout: (f, ms) => timers.push({ f, ms }),
    },
  };
}

test('een klassiek script laadt met importScripts, met het adres als JSON-tekst', () => {
  assert.equal(blobWorkerCode(`${BUNDEL}assets/w.js`, false), `importScripts("${BUNDEL}assets/w.js");\n`);
  // Een adres met aanhalingstekens of een regeleinde breekt de code niet open.
  const raar = `${BUNDEL}assets/a");alert(1);("\n.js`;
  const code = blobWorkerCode(raar, false);
  assert.equal(code, `importScripts(${JSON.stringify(raar)});\n`);
  assert.doesNotThrow(() => new vm.Script(code));
});

test('een module laadt met import(); berichten van vóór het laden worden vastgehouden en daarna doorgegeven', async () => {
  const code = blobWorkerCode(`${BUNDEL}assets/pdf.worker.js`, true);
  assert.match(code, /import\("https:\/\/klant\.example\/werkplek\/app\/pdf\/assets\/pdf\.worker\.js"\)/);
  assert.doesNotMatch(code, /importScripts/);

  // Draai de starter in een nepworker: import() vervangen door een belofte
  // die wij vervullen, zodat te zien is wat er met de berichten gebeurt.
  let laadKlaar;
  const geladen = new Promise((r) => { laadKlaar = r; });
  const self = new EventTarget();
  const ontvangen = [];
  const context = vm.createContext({
    self, MessageEvent: class extends Event { constructor(t, o) { super(t); this.data = o.data; this.ports = o.ports; } },
    setTimeout, laad: () => geladen,
  });
  vm.runInContext(code.replace(/import\(/, 'laad('), context);
  self.dispatchEvent(Object.assign(new Event('message'), { data: 'eerste', ports: [] }));
  self.dispatchEvent(Object.assign(new Event('message'), { data: 'tweede', ports: [] }));
  // Het script zelf luistert pas zodra het geladen is.
  self.addEventListener('message', (e) => ontvangen.push(e.data));
  laadKlaar();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ontvangen, ['eerste', 'tweede'], 'op volgorde, en niet kwijt');
  self.dispatchEvent(Object.assign(new Event('message'), { data: 'derde', ports: [] }));
  assert.deepEqual(ontvangen, ['eerste', 'tweede', 'derde'], 'daarna gewoon, en niet dubbel');
});

test('maakBlobWorker: een klassieke worker uit een blob, met het absolute adres in de bundel', () => {
  const o = nepOmgeving();
  const w = maakBlobWorker('assets/pdf.worker-abc.js', { type: 'module', name: 'pdfjs' }, o.omgeving);
  assert.equal(o.gemaakt.length, 1);
  assert.match(w.url, /^blob:/);
  assert.deepEqual(w.opties, { name: 'pdfjs' }, 'klassiek: geen type module');
  const blob = o.blobs.get(w.url);
  assert.equal(blob.type, 'text/javascript');
  assert.ok(blob.tekst.includes(`import("${BUNDEL}assets/pdf.worker-abc.js")`), 'relatief adres opgelost tegen de pagina');
  assert.equal(o.timers.length, 1);
  assert.equal(o.timers[0].ms, STARTER_OPRUIMEN_MS);
  o.timers[0].f();
  assert.deepEqual(o.ingetrokken, [w.url], 'het blob-adres van de starter gaat later weg');

  const klassiek = maakBlobWorker(`${BUNDEL}assets/u3d.js`, undefined, o.omgeving);
  assert.equal(o.blobs.get(klassiek.url).tekst, `importScripts("${BUNDEL}assets/u3d.js");\n`);
  assert.deepEqual(klassiek.opties, {});
});

test('installeerWorkerShim: http(s) via een blob, blob: en data: ongewijzigd; één keer', () => {
  const o = nepOmgeving();
  const venster = { Worker: o.NepWorker, Blob: o.NepBlob, URL: o.NepURL, location: { href: `${BUNDEL}index.html` }, setTimeout: () => {} };
  const Echt = venster.Worker;
  assert.equal(installeerWorkerShim(venster), true);
  assert.notEqual(venster.Worker, Echt);
  assert.equal(venster.Worker.prototype, Echt.prototype, 'instanceof Worker blijft kloppen');

  const viaBlob = new venster.Worker(new URL('./change-detect.worker.js', `${BUNDEL}assets/index.js`), { type: 'module' });
  assert.ok(viaBlob instanceof Echt);
  assert.match(viaBlob.url, /^blob:/);
  assert.ok(o.blobs.get(viaBlob.url).tekst.includes(`import("${BUNDEL}assets/change-detect.worker.js")`));

  const eigenBlob = new venster.Worker('blob:null/eigen', { type: 'module' });
  assert.equal(eigenBlob.url, 'blob:null/eigen');
  assert.deepEqual(eigenBlob.opties, { type: 'module' });
  const data = new venster.Worker('data:text/javascript,1');
  assert.equal(data.url, 'data:text/javascript,1');

  const nu = venster.Worker;
  assert.equal(installeerWorkerShim(venster), true);
  assert.equal(venster.Worker, nu, 'niet dubbel ingepakt');
  assert.equal(installeerWorkerShim({}), false, 'zonder Worker niets');
});
