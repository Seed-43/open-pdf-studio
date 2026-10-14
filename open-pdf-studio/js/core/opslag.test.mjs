// Alle browseropslag loopt via core/opslag.js, met één vast voorvoegsel
// (#547): op een gedeelde oorsprong (#544) lezen of overschrijven andere
// gereedschappen anders elkaars sleutels.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const winkel = new Map();
globalThis.localStorage = {
  getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
  setItem: (k, v) => { winkel.set(k, String(v)); },
  removeItem: (k) => { winkel.delete(k); },
};
globalThis.window = {};

const {
  OPSLAG_PREFIX, opslagSleutel, leesOpslag, schrijfOpslag, verwijderOpslag,
  leesOpslagJson, schrijfOpslagJson, themaVoorafScript, VOORKEUREN_NAAM,
} = await import('./opslag.js');

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..', '..');

function alsGast(fn) {
  window.__OPDS_HOST__ = {};
  try { return fn(); } finally { delete window.__OPDS_HOST__; }
}

test('elke sleutel krijgt het voorvoegsel', () => {
  winkel.clear();
  schrijfOpslag('recentFiles', '[]');
  schrijfOpslagJson('readerModePosition:C:/a.pdf', { page: 3 });
  assert.deepEqual([...winkel.keys()].sort(), [
    `${OPSLAG_PREFIX}readerModePosition:C:/a.pdf`, `${OPSLAG_PREFIX}recentFiles`,
  ]);
  assert.equal(leesOpslag('recentFiles'), '[]');
  assert.deepEqual(leesOpslagJson('readerModePosition:C:/a.pdf'), { page: 3 });
  verwijderOpslag('recentFiles');
  assert.equal(winkel.has(opslagSleutel('recentFiles')), false);
});

test('een oude sleutel zonder voorvoegsel verhuist bij de eerste lezing', () => {
  winkel.clear();
  winkel.set('pdfEditorSignatures', '[{"dataUrl":"x"}]');
  assert.deepEqual(leesOpslagJson('pdfEditorSignatures'), [{ dataUrl: 'x' }]);
  assert.equal(winkel.has('pdfEditorSignatures'), false, 'de oude sleutel is weg');
  assert.equal(winkel.get(opslagSleutel('pdfEditorSignatures')), '[{"dataUrl":"x"}]');
});

test('schrijven en verwijderen ruimen de oude sleutel mee op', () => {
  winkel.clear();
  winkel.set('paletteIconSize', 'large');
  schrijfOpslag('paletteIconSize', 'small');
  assert.equal(winkel.has('paletteIconSize'), false);
  winkel.set('pdfStudioSession', '{}');
  verwijderOpslag('pdfStudioSession');
  assert.equal(winkel.has('pdfStudioSession'), false);
});

test('als gast blijven sleutels zonder voorvoegsel van een ander', () => {
  winkel.clear();
  winkel.set('i18nextLng', 'fr');
  winkel.set('recentFiles', '["van een ander gereedschap"]');
  alsGast(() => {
    assert.equal(leesOpslag('i18nextLng'), null, 'niet gelezen');
    schrijfOpslag('recentFiles', '[]');
    verwijderOpslag('i18nextLng');
  });
  assert.equal(winkel.get('i18nextLng'), 'fr', 'niet verwijderd');
  assert.equal(winkel.get('recentFiles'), '["van een ander gereedschap"]', 'niet overschreven');
});

test('kapotte JSON of geen opslag geeft de standaardwaarde, schrijven meldt het', () => {
  winkel.clear();
  winkel.set(opslagSleutel('savedPlaces'), '{kapot');
  assert.deepEqual(leesOpslagJson('savedPlaces', []), []);
  const echt = globalThis.localStorage;
  globalThis.localStorage = undefined;
  try {
    assert.equal(leesOpslag('savedPlaces'), null);
    assert.throws(() => schrijfOpslag('savedPlaces', '[]'));
    assert.doesNotThrow(() => verwijderOpslag('savedPlaces'));
  } finally {
    globalThis.localStorage = echt;
  }
});

test('het thema-script vóór de boot leest de sleutel met voorvoegsel', () => {
  const draai = (opgeslagen, donker = false) => {
    const attrs = {};
    const opslag = new Map(Object.entries(opgeslagen));
    vm.runInNewContext(themaVoorafScript(), {
      localStorage: { getItem: (k) => (opslag.has(k) ? opslag.get(k) : null) },
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
      window: { matchMedia: () => ({ matches: donker }) },
    });
    return attrs['data-theme'];
  };
  const sleutel = opslagSleutel(VOORKEUREN_NAAM);
  assert.equal(draai({ [sleutel]: '{"theme":"dark"}' }), 'dark');
  assert.equal(draai({ [sleutel]: '{"theme":"system"}' }, true), 'dark');
  assert.equal(draai({ [sleutel]: '{"theme":"system"}' }, false), 'light');
  assert.equal(draai({ [VOORKEUREN_NAAM]: '{"theme":"dark"}' }), undefined, 'kale sleutel telt niet');
  assert.equal(draai({ [sleutel]: 'kapot' }), undefined, 'gooit niet');
});

test('index.html krijgt het thema-script inline, er is geen los bestand meer', () => {
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  assert.match(html, /<!-- opds:thema-vooraf -->/);
  assert.doesNotMatch(html, /theme-init\.js/);
  assert.equal(fs.existsSync(path.join(app, 'public', 'js', 'theme-init.js')), false);
});

// ── Bronscan: niemand anders raakt de browseropslag aan ─────────────────────

// Uitzonderingen, elk met reden.
const MAG = new Set([
  'js/core/opslag.js', // de helper zelf
  'js/core/app-test-hooks.mjs', // zet onder node een nep-localStorage neer
]);

function bronbestanden(map) {
  if (!fs.existsSync(map)) return [];
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...bronbestanden(p));
    else if (/\.(jsx?|mjs|tsx?|html)$/.test(e.name) && !/\.test\./.test(e.name)) uit.push(p);
  }
  return uit;
}

/** Regels zonder commentaar en zonder de inhoud van tekenreeksen. */
function codeRegels(tekst) {
  return tekst.split(/\r?\n/).map((regel) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(regel)) return '';
    return regel
      .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')
      .replace(/\/\/.*$/, '')
      .replace(/<!--.*?-->/g, '');
  });
}

test('geen localStorage of sessionStorage buiten core/opslag.js', () => {
  const bestanden = [
    ...bronbestanden(path.join(app, 'js')),
    ...bronbestanden(path.join(app, 'public', 'js')),
    ...bronbestanden(path.join(app, 'web-unit', 'src')),
    path.join(app, 'index.html'),
  ];
  assert.ok(bestanden.length > 100, 'de scan ziet de broncode');
  const fouten = [];
  for (const bestand of bestanden) {
    const rel = path.relative(app, bestand).split(path.sep).join('/');
    if (MAG.has(rel)) continue;
    codeRegels(fs.readFileSync(bestand, 'utf8')).forEach((regel, i) => {
      if (/\b(localStorage|sessionStorage)\b/.test(regel)) fouten.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(fouten, [], 'gebruik leesOpslag/schrijfOpslag/verwijderOpslag uit js/core/opslag.js');
});

test('de scan ziet echte toegang en negeert commentaar en tekst', () => {
  const vind = (bron) => codeRegels(bron).some((r) => /\b(localStorage|sessionStorage)\b/.test(r));
  assert.equal(vind("const x = localStorage.getItem('a');"), true);
  assert.equal(vind('window.sessionStorage.clear();'), true);
  assert.equal(vind('// localStorage.getItem staat hier alleen in commentaar'), false);
  assert.equal(vind("console.warn('spiegel (localStorage) niet bijgewerkt', e);"), false);
});
