// Polyfills voor oudere WebViews (#596): op een Android-WebView met
// Chromium 91 opende PDF.js geen enkel document.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { installeerPolyfills } from './oude-webview.js';

// Een verse context waarin de nieuwe API's ontbreken, zoals in Chromium 91.
function oudeContext() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    delete Promise.withResolvers;
    delete Object.hasOwn;
    delete Array.prototype.at;
    delete Array.prototype.findLast;
    delete Array.prototype.findLastIndex;
    delete String.prototype.at;
    const T = Object.getPrototypeOf(Uint8Array.prototype);
    delete T.at; delete T.findLast; delete T.findLastIndex;
    delete globalThis.structuredClone;
  `, ctx);
  return ctx;
}

test('vult de API\'s aan die PDF.js nodig heeft', () => {
  const ctx = oudeContext();
  const aangevuld = vm.runInContext(`(${installeerPolyfills.toString()})(globalThis)`, ctx);
  for (const naam of ['Promise.withResolvers', 'Object.hasOwn', 'Array.prototype.at', 'TypedArray.prototype.at',
    'String.prototype.at', 'Array.prototype.findLast', 'structuredClone']) {
    assert.ok(aangevuld.includes(naam), `${naam} niet aangevuld`);
  }
  const uit = vm.runInContext(`(async () => {
    const { promise, resolve } = Promise.withResolvers();
    resolve(7);
    return {
      waarde: await promise,
      at: [[1, 2, 3].at(-1), [1, 2, 3].at(0), [1].at(5), 'abc'.at(-1), new Uint8Array([4, 5]).at(-1)],
      hasOwn: [Object.hasOwn({ a: 1 }, 'a'), Object.hasOwn({}, 'toString')],
      findLast: [[1, 2, 3, 4].findLast((x) => x % 2), [1, 2, 3, 4].findLastIndex((x) => x > 9)],
    };
  })()`, ctx);
  return uit.then((r) => {
    assert.equal(r.waarde, 7);
    // Arrays uit een andere context: vergelijken als gewone arrays.
    assert.deepEqual(Array.from(r.at), [3, 1, undefined, 'c', 5]);
    assert.deepEqual(Array.from(r.hasOwn), [true, false]);
    assert.deepEqual(Array.from(r.findLast), [3, -1]);
  });
});

test('structuredClone-vervanger kopieert gegevens diep', () => {
  const ctx = oudeContext();
  vm.runInContext(`(${installeerPolyfills.toString()})(globalThis)`, ctx);
  const r = vm.runInContext(`
    const bron = { a: [1, { b: 2 }], m: new Map([['k', { v: 1 }]]), s: new Set([1]), d: new Uint8Array([1, 2]) };
    bron.zelf = bron;
    const k = structuredClone(bron);
    ({
      gelijk: JSON.stringify(k.a) === JSON.stringify(bron.a),
      diep: k.a[1] !== bron.a[1] && k.m.get('k') !== bron.m.get('k') && k.d !== bron.d,
      kring: k.zelf === k,
      map: k.m.get('k').v, set: k.s.has(1), bytes: Array.from(k.d).join(','),
    })`, ctx);
  assert.deepEqual({ ...r }, { gelijk: true, diep: true, kring: true, map: 1, set: true, bytes: '1,2' });
});

test('laat bestaande implementaties ongemoeid', () => {
  const eigen = () => 'eigen';
  const g = { Promise: { withResolvers: eigen }, Object: { hasOwn: eigen } };
  installeerPolyfills(g);
  assert.equal(g.Promise.withResolvers, eigen);
  assert.equal(g.Object.hasOwn, eigen);
  // In een moderne omgeving (node) hoeft niets aangevuld te worden.
  assert.deepEqual(installeerPolyfills(globalThis), []);
});

test('AbortSignal.any breekt af zodra één bron afbreekt', () => {
  const g = { AbortSignal: { }, AbortController };
  installeerPolyfills(g);
  const a = new AbortController();
  const b = new AbortController();
  const samen = g.AbortSignal.any([a.signal, b.signal]);
  assert.equal(samen.aborted, false);
  b.abort('reden');
  assert.equal(samen.aborted, true);
  assert.equal(samen.reason, 'reden');
  const al = new AbortController();
  al.abort('eerder');
  assert.equal(g.AbortSignal.any([al.signal]).reason, 'eerder');
});

test('ArrayBuffer.transferToFixedLength kort een buffer in (lettertype-info in de worker)', () => {
  const ctx = vm.createContext({});
  vm.runInContext('delete ArrayBuffer.prototype.transferToFixedLength; delete ArrayBuffer.prototype.transfer;', ctx);
  const aangevuld = vm.runInContext(`(${installeerPolyfills.toString()})(globalThis)`, ctx);
  assert.ok(aangevuld.includes('ArrayBuffer.prototype.transferToFixedLength'));
  const r = vm.runInContext(`
    const b = new ArrayBuffer(8); new Uint8Array(b).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const kort = b.transferToFixedLength(3), lang = b.transfer(10), zelfde = b.transferToFixedLength();
    [kort.byteLength, Array.from(new Uint8Array(kort)).join(','), lang.byteLength, new Uint8Array(lang)[9], zelfde.byteLength].join('|')`, ctx);
  assert.equal(r, '3|1,2,3|10|0|8');
});

test('for await over een ReadableStream (tekstinhoud van PDF.js)', async () => {
  // Nep-stroom: alleen getReader(), zoals een stroom zonder async iterator.
  class Stroom {
    constructor(items) { this.items = items; this.geannuleerd = false; this.vrij = 0; }
    getReader() {
      const s = this;
      let i = 0;
      return {
        read: () => Promise.resolve(i < s.items.length ? { done: false, value: s.items[i++] } : { done: true, value: undefined }),
        cancel: () => { s.geannuleerd = true; return Promise.resolve(); },
        releaseLock: () => { s.vrij++; },
      };
    }
  }
  const g = { ReadableStream: Stroom };
  const aangevuld = installeerPolyfills(g);
  assert.ok(aangevuld.includes('ReadableStream.prototype[Symbol.asyncIterator]'));
  const gelezen = [];
  for await (const x of new Stroom([1, 2, 3])) gelezen.push(x);
  assert.deepEqual(gelezen, [1, 2, 3]);
  const s = new Stroom([1, 2, 3]);
  for await (const x of s) { if (x === 2) break; }
  assert.equal(s.geannuleerd, true, 'break annuleert de stroom');
  assert.equal(s.vrij, 1);
});

test('main.js laadt de polyfills vóór de app-modules', async () => {
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const imports = [...main.matchAll(/^import\s[\s\S]*?['"]([^'"]+)['"];/gm)].map((m) => m[1]);
  // Alleen pdf-lib-snelheid (pdf-lib, geen PDF.js) mag ervoor.
  assert.deepEqual(imports.slice(0, 2), ['./pdf/pdf-lib-snelheid.js', './core/oude-webview-start.js']);
});
