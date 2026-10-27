// Bouwstappen voor oudere WebViews en de Android-CSP (#596).
//
// 1. De PDF.js-worker wordt als los bestand meegeleverd (new URL(...) in
//    js/pdf/loader.js) en gaat dus niet door de bundel. Hij bevat syntaxis
//    (statische klasseblokken, Chromium 94) en API's (Promise.withResolvers,
//    Array.prototype.at, Object.hasOwn) die een Android-WebView met
//    Chromium 91 niet kent. De build zet hem om naar dat doel en zet de
//    polyfills uit js/core/oude-webview.js ervoor.
// 2. Op Android voegt de WebView-laag hashes van zijn eigen init-scripts aan
//    de CSP toe; daarmee vervalt 'unsafe-inline' en weigert de WebView elk
//    inline script van de pagina. Het script dat vóór de app-boot moet
//    draaien (thema, opstartdiagnose) staat daarom in een eigen bestand.

import { transformWithEsbuild } from 'vite';
import { installeerPolyfills } from '../js/core/oude-webview.js';
import { themaVoorafScript } from '../js/core/opslag.js';

/** Oudste WebView waar de worker nog op moet draaien. */
export const OUDE_WEBVIEW_DOEL = 'chrome91';

/** Bestandsnaam van het script vóór de app-boot (naast index.html). */
export const VOORAF_BESTAND = 'opds-vooraf.js';

const VOORAF_PLEK = '<!-- opds:thema-vooraf -->';

/** Code die de polyfills installeert, te plakken vóór een los script. */
export function polyfillVoorvoegsel() {
  return `(${installeerPolyfills.toString()})(globalThis);\n`;
}

/** Herkent het uitgevoerde PDF.js-workerbestand in de bundel. */
export function isPdfjsWorker(bestandsnaam) {
  return /(^|\/)pdf\.worker-[^/]*\.m?js$/.test(bestandsnaam);
}

/** Zet de worker om naar het oude doel, met de polyfills ervoor. */
export async function workerVoorOudeWebview(bron, bestandsnaam = 'pdf.worker.mjs') {
  const { code } = await transformWithEsbuild(bron, bestandsnaam, {
    loader: 'js',
    format: 'esm',
    target: OUDE_WEBVIEW_DOEL,
    // Statische klasseblokken komen pas in Chromium 94; esbuild rekent ze
    // al tot Chromium 91 en zou ze anders laten staan.
    supported: { 'class-static-blocks': false },
    minify: false,
  });
  return polyfillVoorvoegsel() + code;
}

export function pdfjsWorkerOudeWebview() {
  return {
    name: 'opds-pdfjs-worker-oude-webview',
    apply: 'build',
    async generateBundle(_opties, bundel) {
      for (const item of Object.values(bundel)) {
        if (item.type !== 'asset' || !isPdfjsWorker(item.fileName)) continue;
        const bron = typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8');
        item.source = await workerVoorOudeWebview(bron, item.fileName);
      }
    },
  };
}

// Opstartdiagnose: vóór de modulegraaf laadt, zodat ook een fout bij het
// importeren als privacyveilige fase wordt vastgelegd in plaats van een stil
// wit scherm. Tauri is er op dat moment al (withGlobalTauri).
const OPSTARTDIAGNOSE = `
window.addEventListener('error', function (e) {
  try {
    window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke(
      'startup_diagnostic', { phase: 'frontend-error', detail: e.message || '?' }
    );
  } catch (_) {}
});
window.addEventListener('unhandledrejection', function (e) {
  try {
    var r = e.reason || {};
    window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke(
      'startup_diagnostic', { phase: 'frontend-rejection', detail: String(r.message || r) }
    );
  } catch (_) {}
});
`;

/** Inhoud van het script vóór de app-boot. */
export function voorafScript() {
  return `${themaVoorafScript()}\n${OPSTARTDIAGNOSE}`;
}

/** Zet het script vóór de app-boot als eigen bestand in de pagina. */
export function voorafScriptPlugin() {
  let basis = '/';
  return {
    name: 'opds-vooraf-script',
    configResolved(config) {
      basis = config.base || '/';
    },
    // Na Vite's eigen HTML-verwerking: een klassiek <script src> laat Vite
    // anders met een waarschuwing staan.
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(VOORAF_PLEK)) throw new Error(`index.html mist ${VOORAF_PLEK}`);
        return html.replace(VOORAF_PLEK, `<script src="${basis}${VOORAF_BESTAND}"></script>`);
      },
    },
    configureServer(server) {
      const pad = `${basis.startsWith('/') ? basis : '/'}${VOORAF_BESTAND}`;
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== pad) return next();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(voorafScript());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VOORAF_BESTAND, source: voorafScript() });
    },
  };
}
