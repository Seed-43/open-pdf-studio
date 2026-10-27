import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isHeadless, headlessVensterOpties, toonEnFocus, slaOverInHeadless,
} from './headless.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const appMap = path.resolve(hier, '..', '..');
const lees = (rel) => readFileSync(path.join(appMap, rel), 'utf8');

function omgeving(headless) {
  const meldingen = [];
  const g = { console: { warn: (m) => meldingen.push(m) } };
  if (headless) g.__OPDS_HEADLESS__ = true;
  return { g, meldingen };
}

test('isHeadless: alleen bij de vlag van het init-script', () => {
  assert.equal(isHeadless(omgeving(true).g), true);
  assert.equal(isHeadless(omgeving(false).g), false);
  assert.equal(isHeadless({ __OPDS_HEADLESS__: 'true' }), false, 'alleen de boolean telt');
  assert.equal(isHeadless(undefined), false);
});

test('headlessVensterOpties: buiten headless exact hetzelfde object', () => {
  const opties = { url: 'index.html?view=printqueue', width: 920, height: 620 };
  assert.equal(headlessVensterOpties(opties, omgeving(false).g), opties);
});

test('headlessVensterOpties: headless onzichtbaar, zonder focus en zonder taakbalkknop', () => {
  const opties = { url: 'x.html', width: 920, height: 620, focus: true, visible: true };
  const uit = headlessVensterOpties(opties, omgeving(true).g);
  assert.notEqual(uit, opties);
  assert.equal(uit.url, 'x.html');
  assert.equal(uit.width, 920);
  assert.equal(uit.visible, false);
  assert.equal(uit.focus, false);
  assert.equal(uit.focusable, false);
  assert.equal(uit.skipTaskbar, true);
  assert.equal(uit.maximized, false);
  assert.equal(uit.fullscreen, false);
  assert.equal(opties.visible, true, 'invoer blijft ongewijzigd');
});

test('toonEnFocus: normaal show + setFocus, headless niets met logregel', async () => {
  const aanroepen = [];
  const venster = { show: async () => aanroepen.push('show'), setFocus: async () => aanroepen.push('setFocus') };
  await toonEnFocus(venster, omgeving(false).g);
  assert.deepEqual(aanroepen, ['show', 'setFocus']);

  aanroepen.length = 0;
  const { g, meldingen } = omgeving(true);
  await toonEnFocus(venster, g);
  assert.deepEqual(aanroepen, []);
  assert.equal(meldingen.length, 1);
  assert.match(meldingen[0], /^\[headless\] .*suppressed$/);
  await toonEnFocus(null, g);
});

test('slaOverInHeadless: logt en slaat alleen headless over', () => {
  assert.equal(slaOverInHeadless('maximize', omgeving(false).g), false);
  const { g, meldingen } = omgeving(true);
  assert.equal(slaOverInHeadless('maximize', g), true);
  assert.deepEqual(meldingen, ['[headless] maximize suppressed']);
});

// Broncontroles: de Rust-tests draaien niet overal (zie headless/regels.rs),
// dus hier ook de afspraken die de testinstanties nodig hebben.

test('Rust: headless-argumenten voor WebView2 en de vervanger van de dialoog-plugin', () => {
  const regels = lees('src-tauri/src/headless/regels.rs');
  for (const vlag of [
    'CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ]) {
    assert.ok(regels.includes(vlag), vlag);
  }
  const glue = lees('src-tauri/src/headless.rs');
  assert.match(glue, /PluginBuilder::new\("dialog"\)/);
  assert.match(glue, /dialoog::open, dialoog::save, dialoog::message/);
  assert.match(glue, /__OPDS_HEADLESS__/);
  for (const veld of ['visible = false', 'focus = false', 'focusable = false', 'skip_taskbar = true']) {
    assert.ok(glue.includes(`venster.${veld}`), veld);
  }
});

test('Rust: elke focus-aanroep in lib.rs staat achter de headless-toets', () => {
  const lib = lees('src-tauri/src/lib.rs');
  const regels = lib.split('\n');
  const focusRegels = regels
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => /\.set_focus\(\)/.test(r) && !r.trim().startsWith('//'));
  assert.ok(focusRegels.length >= 3);
  for (const { i } of focusRegels) {
    const ervoor = regels.slice(Math.max(0, i - 6), i).join('\n');
    assert.match(ervoor, /headless::actief\(\)/, `set_focus op regel ${i + 1}`);
  }
  assert.match(lib, /headless::dialoog_plugin\(\)/);
  assert.match(lib, /tauri_plugin_dialog::init\(\)/);
});

test('scripts: elke start van een testinstantie zet OPDS_HEADLESS=1', () => {
  for (const rel of [
    'scripts/test-move-sweep.ps1',
    'scripts/test-rotate-snap.ps1',
    'scripts/run-dev-debug.mjs',
    '../scripts/verify-prestaties.mjs',
  ]) {
    assert.match(lees(rel), /OPDS_HEADLESS/, rel);
  }
});
