// Bestanden die de app tijdens het draaien zelf ophaalt, volgen de bouwbasis
// (#545): een bundel onder /assets/openaec/tools/pdf/, geladen door een pagina
// op een ander adres, vraagt niets op buiten dat subpad.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetUrl, bepaalBasis, pdfjsBronnen } from './basis-url.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..', '..');
const SUBPAD = '/assets/openaec/tools/pdf/';

test('een absolute basis blijft staan, met precies één slash aan het eind', () => {
  assert.equal(bepaalBasis('/'), '/');
  assert.equal(bepaalBasis(SUBPAD), SUBPAD);
  assert.equal(bepaalBasis('/assets/openaec/tools/pdf'), SUBPAD);
  assert.equal(bepaalBasis('https://site.test/tools/pdf/'), 'https://site.test/tools/pdf/');
  assert.equal(bepaalBasis(undefined), '/', 'onder node is er geen import.meta.env');
});

test('een relatieve basis hangt aan de bundel, niet aan de pagina die hem laadt', () => {
  const chunk = 'https://site.test/assets/openaec/tools/pdf/assets/index-abc123.js';
  assert.equal(bepaalBasis('./', chunk), `https://site.test${SUBPAD}`);
  assert.equal(bepaalBasis('', chunk), `https://site.test${SUBPAD}`);
  assert.equal(bepaalBasis('./', 'geen url'), '/');
});

test('PDF.js haalt CMaps, standaardfonts en wasm onder de basis op', () => {
  const b = pdfjsBronnen(SUBPAD);
  assert.equal(b.cMapUrl, `${SUBPAD}pdfjs/web/cmaps/`);
  assert.equal(b.standardFontDataUrl, `${SUBPAD}pdfjs/web/standard_fonts/`);
  assert.equal(b.wasmUrl, `${SUBPAD}pdfjs/web/wasm/`);
  assert.equal(b.cMapPacked, true);
  assert.equal(assetUrl('/icon.png', SUBPAD), `${SUBPAD}icon.png`);
  assert.deepEqual(pdfjsBronnen(), pdfjsBronnen('/'), 'zonder bouwbasis: de wortel, zoals vroeger');
});

function bronbestanden(map) {
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...bronbestanden(p));
    else if (/\.(jsx?|mjs|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) uit.push(p);
  }
  return uit;
}

test('geen vast pad naar de PDF.js-bestanden of een relatief app-icoon in de broncode', () => {
  const fouten = [];
  for (const bestand of bronbestanden(path.join(app, 'js'))) {
    const tekst = fs.readFileSync(bestand, 'utf8');
    tekst.split(/\r?\n/).forEach((regel, i) => {
      if (/^\s*(\/\/|\*)/.test(regel)) return; // commentaar
      const plek = `${path.relative(app, bestand)}:${i + 1}`;
      if (/['"`]\/pdfjs\/web\//.test(regel)) fouten.push(`${plek} vast pad /pdfjs/web/`);
      if (/src=["'](?!https?:|data:|blob:)[\w.-]+\.(png|svg|ico)["']/.test(regel)) fouten.push(`${plek} relatief icoon`);
    });
  }
  assert.deepEqual(fouten, [], 'gebruik pdfjsBronnen()/assetUrl() uit js/core/basis-url.js of importeer het bestand');
});

test('index.html verwijst naar publieke bestanden via %BASE_URL%', () => {
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  // Wat Vite zelf bundelt (module-scripts en stylesheets) krijgt de basis al;
  // het pictogram en klassieke scripts niet.
  const refs = [
    ...html.matchAll(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"/g),
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
      .filter((m) => !/type="module"/.test(m[0])),
  ].map((m) => m[1]);
  for (const ref of refs) assert.match(ref, /^%BASE_URL%/, ref);
});
