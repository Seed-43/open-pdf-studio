// Bouwstappen voor oudere WebViews en de Android-CSP (#596).
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import {
  isPdfjsWorker, polyfillVoorvoegsel, voorafScript, workerVoorOudeWebview, VOORAF_BESTAND,
} from './oude-webview.mjs';

test('herkent het workerbestand van PDF.js in de bundel', () => {
  assert.equal(isPdfjsWorker('assets/pdf.worker-DTrjDNvb.js'), true);
  assert.equal(isPdfjsWorker('pdf.worker-abc.mjs'), true);
  assert.equal(isPdfjsWorker('assets/index-DUOKkZF3.js'), false);
  assert.equal(isPdfjsWorker('assets/pdf-viewer-worker-ish.js'), false);
});

test('de worker verliest syntaxis die Chromium 91 niet kent en krijgt de polyfills', async () => {
  const bron = 'class W {\n  static {\n    this.klaar = [1, 2].at(-1);\n  }\n}\nexport { W };\n';
  const uit = await workerVoorOudeWebview(bron);
  assert.ok(uit.startsWith(polyfillVoorvoegsel()), 'polyfills staan vooraan');
  assert.doesNotMatch(uit.slice(polyfillVoorvoegsel().length), /static\s*\{/, 'statisch klasseblok omgezet');
});

test('de echte PDF.js-worker laat zich omzetten', async () => {
  const pad = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url);
  const uit = await workerVoorOudeWebview(readFileSync(pad, 'utf8'));
  const worker = uit.slice(polyfillVoorvoegsel().length);
  assert.doesNotMatch(worker, /^\s*static\s*\{/m);
  assert.match(worker, /initializeFromPort\(self\)/, 'de worker start nog steeds zichzelf');
});

test('het script vóór de boot is gewoon script zonder imports', () => {
  const code = voorafScript();
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
  const luisteraars = [];
  vm.runInNewContext(code, {
    localStorage: { getItem: () => null },
    document: { documentElement: { setAttribute() {} } },
    window: { matchMedia: () => ({ matches: false }), addEventListener: (soort) => luisteraars.push(soort) },
  });
  assert.deepEqual(luisteraars.sort(), ['error', 'unhandledrejection']);
  assert.equal(VOORAF_BESTAND, 'opds-vooraf.js');
});
