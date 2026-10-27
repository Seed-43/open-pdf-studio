// Polyfills voor oudere WebViews (#596).
//
// Android werkt de systeem-WebView los van de app bij; een toestel met
// Android 12 kan nog Chromium 91 hebben. PDF.js 6 (ook de legacy-build) roept
// zonder terugvaloptie onder meer Promise.withResolvers (Chromium 119),
// Array.prototype.at (92) en Object.hasOwn (93) aan: het openen van een PDF
// gaf daar "TypeError: undefined is not a function" en een lege pagina.
//
// installeerPolyfills() vult alleen aan wat ontbreekt en laat bestaande
// implementaties met rust. De functie is bewust zelfstandig (geen verwijzing
// naar iets buiten de functie): vite.config.js plakt haar broncode ook vóór de
// PDF.js-worker, die als los bestand geladen wordt.

/**
 * @param {any} g het globale object (window, self of een nep-object in tests)
 * @returns {string[]} namen van de aangevulde functies
 */
export function installeerPolyfills(g) {
  const aangevuld = [];
  const zet = (doel, naam, waarde, label) => {
    if (!doel || typeof doel[naam] === 'function') return;
    Object.defineProperty(doel, naam, { value: waarde, writable: true, configurable: true, enumerable: false });
    aangevuld.push(label);
  };

  if (g.Promise) {
    zet(g.Promise, 'withResolvers', function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }, 'Promise.withResolvers');
  }

  if (g.Object) {
    zet(g.Object, 'hasOwn', function hasOwn(obj, sleutel) {
      if (obj == null) throw new TypeError('Cannot convert undefined or null to object');
      return Object.prototype.hasOwnProperty.call(Object(obj), sleutel);
    }, 'Object.hasOwn');
  }

  function at(index) {
    const lengte = this.length >>> 0;
    let i = Math.trunc(Number(index)) || 0;
    if (i < 0) i += lengte;
    if (i < 0 || i >= lengte) return undefined;
    return typeof this === 'string' ? this.charAt(i) : this[i];
  }
  function stringAt(index) {
    return at.call(String(this), index);
  }
  function findLast(test, thisArg) {
    for (let i = (this.length >>> 0) - 1; i >= 0; i--) {
      if (test.call(thisArg, this[i], i, this)) return this[i];
    }
    return undefined;
  }
  function findLastIndex(test, thisArg) {
    for (let i = (this.length >>> 0) - 1; i >= 0; i--) {
      if (test.call(thisArg, this[i], i, this)) return i;
    }
    return -1;
  }

  const getypeerd = g.Uint8Array ? Object.getPrototypeOf(g.Uint8Array.prototype) : null;
  for (const [proto, naam] of [[g.Array?.prototype, 'Array'], [getypeerd, 'TypedArray']]) {
    zet(proto, 'at', at, `${naam}.prototype.at`);
    zet(proto, 'findLast', findLast, `${naam}.prototype.findLast`);
    zet(proto, 'findLastIndex', findLastIndex, `${naam}.prototype.findLastIndex`);
  }
  zet(g.String?.prototype, 'at', stringAt, 'String.prototype.at');

  // structuredClone (Chromium 98): een synchrone kopie van gewone gegevens.
  // `transfer` wordt een kopie; objecten die niet te kopiëren zijn (bitmaps,
  // functies) gaan als dezelfde verwijzing mee.
  zet(g, 'structuredClone', function structuredClone(waarde) {
    const gezien = new Map();
    const kopie = (w) => {
      if (w === null || typeof w !== 'object') return w;
      if (gezien.has(w)) return gezien.get(w);
      let uit;
      if (Array.isArray(w)) {
        uit = [];
        gezien.set(w, uit);
        for (let i = 0; i < w.length; i++) uit[i] = kopie(w[i]);
        return uit;
      }
      if (w instanceof Date) return new Date(w.getTime());
      if (w instanceof RegExp) return new RegExp(w.source, w.flags);
      if (w instanceof ArrayBuffer) return w.slice(0);
      if (ArrayBuffer.isView(w)) {
        if (typeof DataView !== 'undefined' && w instanceof DataView) {
          return new DataView(w.buffer.slice(0), w.byteOffset, w.byteLength);
        }
        return new w.constructor(w);
      }
      if (w instanceof Map) {
        uit = new Map();
        gezien.set(w, uit);
        for (const [k, v] of w) uit.set(kopie(k), kopie(v));
        return uit;
      }
      if (w instanceof Set) {
        uit = new Set();
        gezien.set(w, uit);
        for (const v of w) uit.add(kopie(v));
        return uit;
      }
      const proto = Object.getPrototypeOf(w);
      if (proto !== Object.prototype && proto !== null && !(w instanceof Error)) return w;
      uit = w instanceof Error ? new w.constructor(w.message) : {};
      gezien.set(w, uit);
      for (const k of Object.keys(w)) uit[k] = kopie(w[k]);
      return uit;
    };
    return kopie(waarde);
  }, 'structuredClone');

  // AbortSignal.any (Chromium 116): afgebroken zodra één bron afbreekt.
  if (g.AbortSignal && g.AbortController) {
    const Controller = g.AbortController;
    zet(g.AbortSignal, 'any', function any(signalen) {
      const controller = new Controller();
      for (const signaal of signalen) {
        if (signaal.aborted) {
          controller.abort(signaal.reason);
          return controller.signal;
        }
      }
      for (const signaal of signalen) {
        signaal.addEventListener('abort', () => controller.abort(signaal.reason), { once: true });
      }
      return controller.signal;
    }, 'AbortSignal.any');
  }

  // ArrayBuffer.prototype.transfer/transferToFixedLength (Chromium 114): de
  // worker bouwt er de lettertype-informatie mee; zonder deze functie gaf
  // elke pagina met tekst een lege operatorlijst (witte pagina). De
  // vervanger kopieert; de oorspronkelijke buffer blijft bruikbaar.
  function transferToFixedLength(lengte) {
    const nieuw = lengte === undefined ? this.byteLength : Math.max(0, Math.trunc(Number(lengte)) || 0);
    const uit = new ArrayBuffer(nieuw);
    new Uint8Array(uit).set(new Uint8Array(this, 0, Math.min(nieuw, this.byteLength)));
    return uit;
  }
  zet(g.ArrayBuffer?.prototype, 'transferToFixedLength', transferToFixedLength, 'ArrayBuffer.prototype.transferToFixedLength');
  zet(g.ArrayBuffer?.prototype, 'transfer', transferToFixedLength, 'ArrayBuffer.prototype.transfer');

  // for await (const x of readableStream) (Chromium 124): PDF.js leest zo
  // tekstinhoud (tekstlaag, zoeken) en uitgepakte stromen.
  if (g.ReadableStream && typeof Symbol === 'function' && Symbol.asyncIterator) {
    const values = function values(opties) {
      const reader = this.getReader();
      const behoud = !!(opties && opties.preventCancel);
      let klaar = false;
      return {
        next() {
          return reader.read().then((r) => {
            if (r.done) {
              klaar = true;
              reader.releaseLock();
            }
            return r;
          });
        },
        return(waarde) {
          if (!klaar) {
            klaar = true;
            const stop = behoud ? Promise.resolve() : reader.cancel(waarde);
            return stop.then(() => {
              reader.releaseLock();
              return { done: true, value: waarde };
            });
          }
          return Promise.resolve({ done: true, value: waarde });
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };
    zet(g.ReadableStream.prototype, 'values', values, 'ReadableStream.prototype.values');
    zet(g.ReadableStream.prototype, Symbol.asyncIterator, values, 'ReadableStream.prototype[Symbol.asyncIterator]');
  }

  // crypto.randomUUID (Chromium 92), alleen als getRandomValues er is.
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    const crypto = g.crypto;
    zet(crypto, 'randomUUID', function randomUUID() {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }, 'crypto.randomUUID');
  }

  return aangevuld;
}
