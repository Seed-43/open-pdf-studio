// index.html van de gehoste bouw klaar voor een strikte CSP (#693).
//
// Een platform dat de bundel serveert (#691) zet een beleid zonder
// 'unsafe-inline' voor scripts en wil de bestanden niet herschrijven: dan
// klopt de release niet meer. Daarom doet de bouw het, alleen in de modus
// hosted (de desktopbouw blijft gelijk):
//  - inline <style> verhuist naar een eigen bestand (opds-vooraf.css);
//  - een inline <script> is een bouwfout (het script vóór de app-boot staat
//    al in opds-vooraf.js, zie scripts/oude-webview.mjs);
//  - elke <script src>, <link rel=stylesheet> en <link rel=modulepreload>
//    krijgt integrity="sha384-…" en crossorigin="anonymous";
//  - een verwijzing naar een andere host is een bouwfout.
//
// De plugin werkt in writeBundle, op de bestanden zoals ze op schijf staan:
// de hashes horen bij de bytes die de host serveert.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GAST_MODUS } from '../js/core/gehost.js';

/** Bestandsnaam van de stijlen die eerst inline in index.html stonden. */
export const CSS_BESTAND = 'opds-vooraf.css';

/** Het beleid uit #693; `<host origin>` is de oorsprong van de gastsite. */
export function cspBeleid(hostOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${hostOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** De sandbox van de werkplek (#704): zonder allow-same-origin, dus een opaque origin. */
export const WERKPLEK_SANDBOX = 'allow-scripts allow-downloads allow-modals';

/**
 * Het beleid op elk app-document in de werkplek van de OpenAEC SuperCloud
 * (#704), zoals de host het zet (csp_app in openaec_werkplek/oorsprong.py):
 * de sandbox, geen 'self', alles alleen binnen de absolute bundel-URL.
 * @param {string} bundelUrl  bv. https://klant/werkplek/app/pdf/
 * @param {string} klantOrigin de oorsprong van de gastpagina
 * @param {string} [brugUrl]  de map van de brug van de host (bv. …/werkplek/app/brug/)
 */
export function werkplekCsp(bundelUrl, klantOrigin, brugUrl = null) {
  return [
    `sandbox ${WERKPLEK_SANDBOX}`,
    "default-src 'none'",
    `script-src ${bundelUrl}${brugUrl ? ` ${brugUrl}` : ''} 'wasm-unsafe-eval'`,
    `worker-src ${bundelUrl} blob:`,
    `style-src ${bundelUrl} 'unsafe-inline'`,
    `img-src ${bundelUrl} data: blob:`,
    `font-src ${bundelUrl} data:`,
    `media-src ${bundelUrl} data: blob:`,
    `connect-src ${bundelUrl}`,
    `frame-ancestors ${klantOrigin}`,
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function sri(data) {
  return `sha384-${createHash('sha384').update(data).digest('base64')}`;
}

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const TAG = /<(script|link)\b([^>]*?)(\/?)>/gi;

function attribuut(attrs, naam) {
  const m = new RegExp(`(?:^|\\s)${naam}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!m) return new RegExp(`(?:^|\\s)${naam}(?=\\s|$)`, 'i').test(attrs) ? '' : null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

function zonderAttribuut(attrs, naam) {
  return attrs.replace(new RegExp(`\\s+${naam}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+))?`, 'gi'), '');
}

/** Moet deze tag een integrity krijgen? Geeft de URL, of null. */
function sriUrl(soort, attrs) {
  if (soort.toLowerCase() === 'script') return attribuut(attrs, 'src');
  const rel = (attribuut(attrs, 'rel') || '').toLowerCase().split(/\s+/);
  return rel.includes('stylesheet') || rel.includes('modulepreload') ? attribuut(attrs, 'href') : null;
}

/**
 * Pad binnen de bundel bij een URL uit index.html, of null voor een andere
 * host. Kent de basis: './', '/', '/sub/pad/'.
 */
export function bundelPad(url, basis = '/') {
  const schoon = String(url).split(/[?#]/)[0];
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(schoon)) return null;
  if (basis && basis !== './' && schoon.startsWith(basis)) return schoon.slice(basis.length);
  if (schoon.startsWith('./')) return schoon.slice(2);
  if (schoon.startsWith('/')) return null; // buiten de basis
  return schoon;
}

/**
 * Maak index.html CSP-klaar.
 * @param {string} html
 * @param {{ basis?: string, lees: (pad: string) => Buffer|string }} opties
 * @returns {{ html: string, css: string|null }}  css: inhoud voor CSS_BESTAND
 */
export function maakCspKlaar(html, { basis = '/', lees }) {
  const stijlen = [];
  let uit = html.replace(STYLE, (_m, inhoud) => {
    const eerste = stijlen.length === 0;
    stijlen.push(inhoud.trim());
    return eerste ? `<link rel="stylesheet" href="${basis}${CSS_BESTAND}">` : '';
  });
  const css = stijlen.length ? `${stijlen.join('\n')}\n` : null;

  for (const m of uit.matchAll(SCRIPT)) {
    if (attribuut(m[1], 'src') === null) throw new Error('index.html has an inline <script>; move it into a file');
  }

  uit = uit.replace(TAG, (geheel, soort, attrs, sluit) => {
    const url = sriUrl(soort, attrs);
    if (url === null || url === '') return geheel;
    const pad = bundelPad(url, basis);
    if (pad === null) throw new Error(`index.html refers to another host or outside the bundle: ${url}`);
    const data = pad === CSS_BESTAND && css !== null ? css : lees(pad);
    const schoon = zonderAttribuut(zonderAttribuut(attrs, 'integrity'), 'crossorigin').replace(/\s+$/, '');
    return `<${soort}${schoon} integrity="${sri(data)}" crossorigin="anonymous"${sluit}>`;
  });
  return { html: uit, css };
}

/**
 * Controleer een gebouwde index.html: geen inline code, en elke
 * script/stylesheet/modulepreload heeft de juiste integrity en
 * crossorigin="anonymous". @returns {string[]} fouten
 */
export function controleerIndexHtml(html, lees, basis = './') {
  const fouten = [];
  if (/<style\b/i.test(html)) fouten.push('inline <style>');
  for (const m of html.matchAll(SCRIPT)) {
    if (attribuut(m[1], 'src') === null) fouten.push('inline <script>');
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) fouten.push('inline event handler');
  for (const [, soort, attrs] of html.matchAll(TAG)) {
    const url = sriUrl(soort, attrs);
    if (url === null) continue;
    const pad = bundelPad(url, basis);
    if (pad === null) { fouten.push(`other host: ${url}`); continue; }
    const integriteit = attribuut(attrs, 'integrity');
    if (!integriteit) { fouten.push(`no integrity: ${url}`); continue; }
    let data;
    try { data = lees(pad); } catch { fouten.push(`missing file: ${url}`); continue; }
    if (integriteit !== sri(data)) fouten.push(`wrong integrity: ${url}`);
    if (attribuut(attrs, 'crossorigin') !== 'anonymous') fouten.push(`no crossorigin="anonymous": ${url}`);
  }
  return fouten;
}

/** Vite-plugin: alleen in de modus hosted, na het wegschrijven. */
export function gehostHtmlPlugin() {
  let actief = false;
  let basis = '/';
  let uitMap = '';
  return {
    name: 'opds-gehost-html',
    apply: 'build',
    configResolved(config) {
      actief = config.mode === GAST_MODUS;
      basis = config.base || '/';
      uitMap = path.resolve(config.root, config.build.outDir);
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (!actief) return;
        const index = path.join(uitMap, 'index.html');
        const { html, css } = maakCspKlaar(fs.readFileSync(index, 'utf8'), {
          basis,
          lees: (pad) => fs.readFileSync(path.join(uitMap, ...pad.split('/'))),
        });
        if (css !== null) fs.writeFileSync(path.join(uitMap, CSS_BESTAND), css);
        fs.writeFileSync(index, html);
      },
    },
  };
}
