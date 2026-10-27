// Workers in de gehoste bouw starten uit een blob:-adres (#704).
//
// In de werkplek van de OpenAEC SuperCloud draait de bundel in een sandbox
// zonder allow-same-origin: een opaque origin ("null"). Daar mag
// `new Worker('https://…/assets/x.js')` niet (andere oorsprong dan "null"),
// en een module-worker uit een blob:-adres start in Chromium ook niet. Een
// klassieke blob-worker mag wel, en die laadt het eigenlijke script uit de
// bundel: klassiek met importScripts(), een module met import(). Het script
// komt dus nog steeds uit de eigen bundel (CSP script-src), alleen de kleine
// starter staat in een blob (CSP worker-src blob:).
//
// Een module heeft even nodig om te laden. Berichten die intussen binnenkomen
// houdt de starter vast en stuurt hij daarna door, zodat bv. de PDF.js-worker
// zijn eerste opdrachten niet mist.
//
// - maakBlobWorker(): één worker zo starten (de PDF.js-worker, pdf/loader.js);
// - installeerWorkerShim(): in de gehoste bouw `Worker` zelf vervangen, zodat
//   elke `new Worker(url)` in de app (en wat er later bijkomt) zo start.
//
// Vrij van DOM- en app-imports: venster, Blob en URL komen van buiten, zodat
// dit onder node te testen is (blob-worker.test.mjs).

/** Na deze tijd mag het blob-adres van de starter weg (de worker draait dan al). */
export const STARTER_OPRUIMEN_MS = 60_000;

/**
 * De code van de klassieke starter voor het script op `adres`.
 * @param {string} adres absoluut adres van het script in de bundel
 * @param {boolean} module laden met import() in plaats van importScripts()
 */
export function blobWorkerCode(adres, module) {
  const doel = JSON.stringify(String(adres));
  if (!module) return `importScripts(${doel});\n`;
  return [
    'var wacht = [];',
    'function vasthouden(e) { wacht.push(e); }',
    "self.addEventListener('message', vasthouden);",
    `import(${doel}).then(function () {`,
    "  self.removeEventListener('message', vasthouden);",
    '  var lijst = wacht;',
    '  wacht = null;',
    '  lijst.forEach(function (e) {',
    "    self.dispatchEvent(new MessageEvent('message', { data: e.data, ports: e.ports }));",
    '  });',
    '}, function (fout) {',
    '  setTimeout(function () { throw fout; });',
    '});',
    '',
  ].join('\n');
}

function omgevingVan(o = {}) {
  const g = globalThis;
  return {
    Worker: o.Worker ?? g.Worker,
    Blob: o.Blob ?? g.Blob,
    URL: o.URL ?? g.URL,
    basis: o.basis ?? g.location?.href,
    setTimeout: o.setTimeout ?? g.setTimeout?.bind(g),
  };
}

/**
 * Start het script op `url` als klassieke blob-worker.
 * @param {string|URL} url
 * @param {{ type?: 'classic'|'module', name?: string }} [opties] zoals bij new Worker()
 * @param {object} [omgeving] { Worker, Blob, URL, basis, setTimeout } (tests)
 */
export function maakBlobWorker(url, opties = {}, omgeving = {}) {
  const o = omgevingVan(omgeving);
  const adres = new o.URL(String(url), o.basis).href;
  const code = blobWorkerCode(adres, opties?.type === 'module');
  const starter = o.URL.createObjectURL(new o.Blob([code], { type: 'text/javascript' }));
  const worker = new o.Worker(starter, opties?.name ? { name: opties.name } : {});
  if (typeof o.setTimeout === 'function' && typeof o.URL.revokeObjectURL === 'function') {
    o.setTimeout(() => o.URL.revokeObjectURL(starter), STARTER_OPRUIMEN_MS);
  }
  return worker;
}

/**
 * Vervang `venster.Worker` door een versie die elk http(s)-adres als
 * klassieke blob-worker start. Een blob:- of data:-adres gaat ongewijzigd
 * naar de echte Worker. Twee keer installeren doet niets.
 * @returns {boolean} of de vervanging nu staat
 */
export function installeerWorkerShim(venster = globalThis) {
  const Echt = venster?.Worker;
  if (typeof Echt !== 'function') return false;
  if (Echt.opdsBlobWorker === true) return true;
  function BlobWorker(url, opties) {
    let adres;
    try {
      adres = new venster.URL(String(url), venster.location?.href);
    } catch {
      return new Echt(url, opties);
    }
    if (adres.protocol !== 'http:' && adres.protocol !== 'https:') return new Echt(url, opties);
    return maakBlobWorker(adres.href, opties, {
      Worker: Echt, Blob: venster.Blob, URL: venster.URL, basis: venster.location?.href,
      setTimeout: venster.setTimeout?.bind(venster),
    });
  }
  BlobWorker.prototype = Echt.prototype;
  BlobWorker.opdsBlobWorker = true;
  venster.Worker = BlobWorker;
  return true;
}
