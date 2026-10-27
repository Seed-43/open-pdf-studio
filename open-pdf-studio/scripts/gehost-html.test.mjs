// Unit-tests voor de CSP-klare index.html van de gehoste bouw (#693).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CSS_BESTAND, WERKPLEK_SANDBOX, bundelPad, controleerIndexHtml, cspBeleid, gehostHtmlPlugin, maakCspKlaar, sri, werkplekCsp,
} from './gehost-html.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BESTANDEN = {
  'opds-vooraf.js': 'thema();',
  'assets/index-a.js': 'import "./b.js";',
  'assets/index-a.css': 'body{}',
  'assets/b.js': 'export {}',
};
const lees = (pad) => {
  if (!(pad in BESTANDEN)) throw new Error(`no such file ${pad}`);
  return Buffer.from(BESTANDEN[pad]);
};

const HTML = (b) => `<!DOCTYPE html>
<html>
<head>
  <link rel="icon" href="${b}favicon.ico">
  <script src="${b}opds-vooraf.js"></script>
  <style>html{background:#f5f5f5}</style>
  <script type="module" crossorigin src="${b}assets/index-a.js"></script>
  <link rel="modulepreload" crossorigin href="${b}assets/b.js">
  <link rel="stylesheet" crossorigin href="${b}assets/index-a.css">
</head>
<body><div id="app-root"></div></body>
</html>`;

test('the policy is the one from the issue', () => {
  assert.equal(cspBeleid('https://cloud.example'),
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; "
    + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
    + "connect-src 'self' https://cloud.example; object-src 'none'; base-uri 'self'; form-action 'none'");
});

test('the workplace policy is the one of the host: sandbox, no self, only the bundle URL (#704)', () => {
  const bundel = 'https://klant.example/werkplek/app/pdf/';
  const beleid = werkplekCsp(bundel, 'https://klant.example', 'https://klant.example/werkplek/app/brug/');
  assert.equal(beleid,
    "sandbox allow-scripts allow-downloads allow-modals; default-src 'none'; "
    + `script-src ${bundel} https://klant.example/werkplek/app/brug/ 'wasm-unsafe-eval'; worker-src ${bundel} blob:; `
    + `style-src ${bundel} 'unsafe-inline'; img-src ${bundel} data: blob:; font-src ${bundel} data:; `
    + `media-src ${bundel} data: blob:; connect-src ${bundel}; frame-ancestors https://klant.example; `
    + "form-action 'none'; base-uri 'none'; object-src 'none'");
  assert.doesNotMatch(beleid, /'self'/);
  assert.doesNotMatch(WERKPLEK_SANDBOX, /allow-same-origin/);
  assert.match(werkplekCsp(bundel, 'https://klant.example'), new RegExp(`script-src ${bundel} 'wasm-unsafe-eval'`));
});

test('sri is sha384 in base64', () => {
  assert.equal(sri(''), 'sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb');
});

test('paths in the bundle for each kind of base', () => {
  assert.equal(bundelPad('./assets/a.js', './'), 'assets/a.js');
  assert.equal(bundelPad('assets/a.js?v=1', './'), 'assets/a.js');
  assert.equal(bundelPad('/assets/a.js', '/'), 'assets/a.js');
  assert.equal(bundelPad('/tools/pdf/assets/a.js', '/tools/pdf/'), 'assets/a.js');
  assert.equal(bundelPad('/elders/a.js', '/tools/pdf/'), null);
  assert.equal(bundelPad('https://cdn.example/a.js', './'), null);
  assert.equal(bundelPad('//cdn.example/a.js', './'), null);
});

for (const basis of ['./', '/', '/tools/pdf/']) {
  test(`index.html becomes CSP-ready with base ${basis}`, () => {
    const { html, css } = maakCspKlaar(HTML(basis), { basis, lees });
    assert.equal(css, 'html{background:#f5f5f5}\n');
    assert.doesNotMatch(html, /<style/);
    assert.match(html, new RegExp(`<link rel="stylesheet" href="${basis}${CSS_BESTAND}" integrity="${sri(css).replace(/[+/]/g, '\\$&')}" crossorigin="anonymous">`));
    assert.ok(html.includes(`<script src="${basis}opds-vooraf.js" integrity="${sri('thema();')}" crossorigin="anonymous"></script>`));
    assert.ok(html.includes(`<script type="module" src="${basis}assets/index-a.js" integrity="${sri(BESTANDEN['assets/index-a.js'])}" crossorigin="anonymous"></script>`));
    assert.ok(html.includes(`<link rel="modulepreload" href="${basis}assets/b.js" integrity="${sri('export {}')}" crossorigin="anonymous">`));
    assert.ok(html.includes(`<link rel="stylesheet" href="${basis}assets/index-a.css" integrity="${sri('body{}')}" crossorigin="anonymous">`));
    assert.ok(html.includes(`<link rel="icon" href="${basis}favicon.ico">`), 'the icon link stays as it is');

    const allesMetCss = (pad) => (pad === CSS_BESTAND ? Buffer.from(css) : lees(pad));
    assert.deepEqual(controleerIndexHtml(html, allesMetCss, basis), []);
  });
}

test('several inline styles end up in one file', () => {
  const { html, css } = maakCspKlaar('<head><style>a{}</style><style media="print">b{}</style></head>', { basis: './', lees });
  assert.equal(css, 'a{}\nb{}\n');
  assert.equal((html.match(/<link/g) || []).length, 1);
});

test('an inline script or another host stops the build', () => {
  assert.throws(() => maakCspKlaar('<script>alert(1)</script>', { basis: './', lees }), /inline <script>/);
  assert.throws(() => maakCspKlaar('<script src="https://cdn.example/x.js"></script>', { basis: './', lees }), /another host/);
  assert.throws(() => maakCspKlaar('<link rel="stylesheet" href="https://fonts.example/x.css">', { basis: './', lees }), /another host/);
});

test('the check finds what a host would trip over', () => {
  const fouten = controleerIndexHtml(`<style>a{}</style>
<script>x()</script>
<div onclick="x()"></div>
<script src="./opds-vooraf.js"></script>
<script src="./assets/b.js" integrity="sha384-fout" crossorigin="anonymous"></script>
<link rel="stylesheet" href="./assets/index-a.css" integrity="${sri('body{}')}">
<script src="https://cdn.example/x.js"></script>`, lees, './');
  assert.deepEqual(fouten, [
    'inline <style>',
    'inline <script>',
    'inline event handler',
    'no integrity: ./opds-vooraf.js',
    'wrong integrity: ./assets/b.js',
    'no crossorigin="anonymous": ./assets/index-a.css',
    'other host: https://cdn.example/x.js',
  ]);
});

function draaiPlugin(mode, uitMap) {
  const plugin = gehostHtmlPlugin();
  plugin.configResolved({ mode, base: './', root: uitMap, build: { outDir: '.' } });
  plugin.writeBundle.handler();
}

test('the plugin only works in hosted mode', () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-gehost-html-'));
  try {
    for (const [pad, inhoud] of Object.entries(BESTANDEN)) {
      fs.mkdirSync(path.dirname(path.join(map, pad)), { recursive: true });
      fs.writeFileSync(path.join(map, pad), inhoud);
    }
    const origineel = HTML('./');
    fs.writeFileSync(path.join(map, 'index.html'), origineel);

    draaiPlugin('production', map);
    assert.equal(fs.readFileSync(path.join(map, 'index.html'), 'utf8'), origineel, 'desktop build unchanged');
    assert.ok(!fs.existsSync(path.join(map, CSS_BESTAND)));

    draaiPlugin('hosted', map);
    const html = fs.readFileSync(path.join(map, 'index.html'), 'utf8');
    const leesSchijf = (pad) => fs.readFileSync(path.join(map, ...pad.split('/')));
    assert.deepEqual(controleerIndexHtml(html, leesSchijf, './'), []);
    assert.equal(fs.readFileSync(path.join(map, CSS_BESTAND), 'utf8'), 'html{background:#f5f5f5}\n');
  } finally {
    fs.rmSync(map, { recursive: true, force: true });
  }
});

test('the plugin is in the vite config, and CI runs the CSP test', () => {
  const config = fs.readFileSync(path.join(APP, 'vite.config.js'), 'utf8');
  assert.match(config, /gehostHtmlPlugin\(\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:hosted-csp'], 'node scripts/test-gehost-csp.mjs');
  const ci = fs.readFileSync(path.join(APP, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm run test:hosted-csp/);
  const release = fs.readFileSync(path.join(APP, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /npm run test:hosted-csp -- --dist "dist-webbundel\/open-pdf-studio-web-\$\{VERSION#v\}"/);
});
