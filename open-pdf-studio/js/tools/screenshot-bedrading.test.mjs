// Home → Screenshot: the button selects an area and opens the dialog, the
// dropdown has the quick copy, the dialog is registered, the remembered
// choices start at the defaults, and every language has the texts.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { DEFAULT_PREFERENCES } = await import('../core/constants.ts');
const { keuzeUitVoorkeuren, keuzeNaarVoorkeuren, STANDAARD_KEUZE } = await import('./screenshot-keuze.js');

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('de standaardvoorkeuren zijn de standaardkeuze van de dialoog', () => {
  assert.deepEqual(keuzeUitVoorkeuren(DEFAULT_PREFERENCES), { ...STANDAARD_KEUZE });
  for (const k of Object.keys(keuzeNaarVoorkeuren(STANDAARD_KEUZE))) {
    assert.ok(k in DEFAULT_PREFERENCES, `${k} staat in DEFAULT_PREFERENCES`);
  }
});

test('de knop selecteert een gebied; het menu heeft gebied, pagina, snel kopiëren en overlay', () => {
  const tab = bron('../solid/components/ribbon/HomeTab.jsx');
  const knop = tab.slice(tab.indexOf('id="screenshot-split-btn"'), tab.indexOf('</SplitButton>'));
  const hoofd = knop.slice(knop.indexOf('onMainClick'), knop.indexOf('>\n'));
  assert.match(hoofd, /startRegionScreenshot\(\)/, 'hoofdknop start de gebiedsselectie');
  const volgorde = ['screenshot-menu-region', 'screenshot-menu-page', 'screenshot-menu-quick-copy', 'screenshot-menu-overlay']
    .map((id) => knop.indexOf(`id="${id}"`));
  assert.ok(volgorde.every((i) => i > 0), 'alle menu-items bestaan');
  assert.deepEqual([...volgorde].sort((a, b) => a - b), volgorde, 'in deze volgorde');
  assert.match(knop, /startRegionScreenshot\(\{ snelKopieren: true \}\)/);
});

test('de dialoog is geregistreerd en de tool opent hem na de selectie', () => {
  assert.match(bron('../solid/components/DialogHost.jsx'), /'screenshot': ScreenshotDialog/);
  const tool = bron('./screenshot.js');
  assert.match(tool, /openDialog\('screenshot', \{ gebied \}\)/);
  // Renderen vanaf de pagina, niet het schermbeeld vergroten.
  assert.match(tool, /renderPageOffscreen\(/);
  assert.match(tool, /renderMarkeringenOffscreen\(/);
  assert.doesNotMatch(tool, /mergeCanvases|pdf-canvas'\)\.toDataURL/);
});

test('Esc annuleert de selectie, ook als de focus nog op het lint staat', () => {
  const overlay = bron('../solid/components/ScreenshotOverlay.jsx');
  assert.match(overlay, /document\.addEventListener\('keydown', handleKeyDown, true\)/);
  assert.match(overlay, /e\.key !== 'Escape'/);
});

test('Enter in de dialoog voert de standaardactie uit', () => {
  const dlg = bron('../solid/components/dialogs/ScreenshotDialog.jsx');
  assert.match(dlg, /e\.key !== 'Enter'/);
  assert.match(dlg, /voerUit\(standaardActie\(\)\)/);
});

const LOCALES = new URL('../i18n/locales/', import.meta.url);
const lees = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));
const DIALOOG = ['title', 'selectHint', 'area', 'clipped', 'resolution', 'screenResolution', 'custom', 'size',
  'limited', 'format', 'quality', 'clipboardNote', 'copy', 'saveAs', 'busy', 'copied', 'saved',
  'copyFailed', 'saveFailed', 'cancelled', 'noPage', 'notOnPage', 'documentChanged', 'pngFiles', 'jpegFiles'];
const LINT = ['captureRegionTitle', 'quickCopy', 'quickCopyTitle'];

test('alle 40 talen hebben de teksten, niet leeg, met dezelfde invulplekken als het Engels', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const enD = lees('en', 'dialogs').screenshot;
  const plekken = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join(',');
  const fout = [];
  for (const taal of talen) {
    const d = lees(taal, 'dialogs').screenshot || {};
    const r = lees(taal, 'ribbon').home || {};
    for (const k of DIALOOG) {
      if (!(typeof d[k] === 'string' && d[k].trim())) fout.push(`${taal} dialogs ${k} leeg`);
      else if (plekken(d[k]) !== plekken(enD[k])) fout.push(`${taal} dialogs ${k} invulplekken`);
    }
    for (const k of LINT) {
      if (!(typeof r[k] === 'string' && r[k].trim())) fout.push(`${taal} ribbon ${k} leeg`);
    }
  }
  assert.deepEqual(fout, []);
});

// "Page" is ook Frans: die regel is terecht gelijk aan het Engels.
const ZELFDE_WOORD = new Set(['fr area']);

test('geen taal kopieert de Engelse zinnen', () => {
  const enD = lees('en', 'dialogs').screenshot;
  const enR = lees('en', 'ribbon').home;
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const d = lees(taal, 'dialogs').screenshot;
    const r = lees(taal, 'ribbon').home;
    for (const k of DIALOOG) if (d[k] === enD[k] && !ZELFDE_WOORD.has(`${taal} ${k}`)) gekopieerd.push(`${taal} ${k}`);
    for (const k of LINT) if (r[k] === enR[k]) gekopieerd.push(`${taal} ${k}`);
  }
  assert.deepEqual(gekopieerd, []);
});

test('app_capture_region staat in de brug, de Rust-server, de metatabel, tools.json en de manifest', () => {
  const repo = (pad) => readFileSync(new URL(`../../../${pad}`, import.meta.url), 'utf8');
  assert.match(repo('open-pdf-studio/js/mcp-bridge.js'), /'mcp:capture-region':\s+handleCaptureRegion/);
  const server = repo('open-pdf-studio/src-tauri/src/mcp_server.rs');
  assert.match(server, /"name": "app_capture_region"/);
  assert.match(server, /"app_capture_region"\s+=> tool_app_request\(state, "mcp:capture-region"/);
  assert.match(repo('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs'), /"app_capture_region"/);
  const tools = JSON.parse(repo('mcp-stdio/tools.json'));
  const t = tools.find((x) => x.name === 'app_capture_region');
  assert.ok(t, 'in tools.json');
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(),
    ['dpi', 'format', 'height', 'page', 'path', 'quality', 'width', 'x', 'y']);
  assert.equal(t.annotations.destructiveHint, false);
  assert.ok(JSON.parse(repo('mcpb/manifest.json')).tools.some((x) => x.name === 'app_capture_region'), 'in manifest.json');
});
