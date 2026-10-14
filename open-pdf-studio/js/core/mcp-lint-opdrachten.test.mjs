// Lint-opdrachten (#584): id's lezen, tabbladen ordenen, activatedTab bepalen.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INGEBOUWDE_TABBLADEN, leesLintOpdracht, knopOpdrachtId, tabSoort, tabVolgorde, geactiveerdTabblad, tabOpdrachten,
} from './mcp-lint-opdrachten.js';

test('opdracht-id\'s lezen, ook met tab-id\'s van extensies', () => {
  assert.deepEqual(leesLintOpdracht('ribbon-tab:home'), { soort: 'tab', tab: 'home' });
  assert.deepEqual(leesLintOpdracht('ribbon-tab:acme.kozijn'), { soort: 'tab', tab: 'acme.kozijn' });
  assert.deepEqual(leesLintOpdracht('ribbon-tab:#mijn-tab'), { soort: 'tab', tab: '#mijn-tab' });
  assert.deepEqual(leesLintOpdracht('ribbon:#btn-vector-snippet'), { soort: 'id', id: 'btn-vector-snippet' });
  assert.deepEqual(leesLintOpdracht('ribbon:home:3'), { soort: 'positie', tab: 'home', n: 3 });
  assert.deepEqual(leesLintOpdracht('ribbon:acme.kozijn-2:12'), { soort: 'positie', tab: 'acme.kozijn-2', n: 12 });
  assert.deepEqual(leesLintOpdracht('ribbon:#tab:0'), { soort: 'id', id: 'tab:0' }, 'een #-id gaat voor');
  for (const geen of ['ribbon-tab:', 'ribbon:#', 'ribbon:home', 'ribbon:home:x', 'tool:line', 'ext:a:b', '', null, 42]) {
    assert.equal(leesLintOpdracht(geen), null, String(geen));
  }
});

test('knop-id\'s: de vaste id gaat voor de positie', () => {
  assert.equal(knopOpdrachtId('home', { id: 'btn-x', n: 4 }), 'ribbon:#btn-x');
  assert.equal(knopOpdrachtId('acme.kozijn', { n: 2 }), 'ribbon:acme.kozijn:2');
  // Heen en terug.
  assert.deepEqual(leesLintOpdracht(knopOpdrachtId('acme.kozijn', { n: 2 })), { soort: 'positie', tab: 'acme.kozijn', n: 2 });
});

test('soorten tabbladen', () => {
  assert.equal(tabSoort('home', ['acme.kozijn']), 'builtin');
  assert.equal(tabSoort('acme.kozijn', ['acme.kozijn']), 'extension');
  assert.equal(tabSoort('kozijnen', ['acme.kozijn']), 'dom');
  assert.equal(tabSoort('#eigen'), 'dom');
});

test('zoekvolgorde: ingebouwd in vaste volgorde, dan de rest in DOM-volgorde, zonder het actieve', () => {
  const inDom = ['home', 'view', 'drawing', 'comment', 'organize', 'help', 'acme.kozijn', 'kozijnen', 'format', 'arrange'];
  assert.deepEqual(tabVolgorde(inDom, 'home'),
    ['view', 'drawing', 'comment', 'organize', 'arrange', 'format', 'help', 'acme.kozijn', 'kozijnen']);
  assert.deepEqual(tabVolgorde(['acme.kozijn', 'home', 'acme.kozijn']), ['home', 'acme.kozijn'], 'dubbele één keer');
  assert.deepEqual(tabVolgorde([], 'home'), []);
  assert.equal(INGEBOUWDE_TABBLADEN.length, 9);
});

test('activatedTab: tabknop, dan een wissel door de klik, dan het zoeken', () => {
  assert.equal(geactiveerdTabblad({ tabKnop: 'acme.kozijn', voor: 'home', na: 'home' }), 'acme.kozijn',
    'een tabknop die het lint niet kent (zelf in de DOM gezet) telt ook');
  assert.equal(geactiveerdTabblad({ voor: 'home', na: 'acme.kozijn' }), 'acme.kozijn');
  assert.equal(geactiveerdTabblad({ gezocht: 'view', voor: 'view', na: 'view' }), 'view');
  assert.equal(geactiveerdTabblad({ gezocht: 'view', voor: 'view', na: 'format' }), 'format');
  assert.equal(geactiveerdTabblad({ voor: 'home', na: 'home' }), null);
  assert.equal(geactiveerdTabblad(), null);
});

test('tabbladen als opdrachten, met extensie en actief', () => {
  const lijst = tabOpdrachten([
    { tab: 'home', label: 'Start' },
    { tab: 'acme.kozijn', label: 'Kozijnen', title: 'Kozijnen', extension: 'acme' },
    { tab: 'kozijnen', label: 'Oud', active: true },
  ], 'acme.kozijn');
  assert.deepEqual(lijst[0], { command: 'ribbon-tab:home', tab: 'home', label: 'Start', title: '', disabled: false, active: false, stableId: true, kind: 'tab' });
  assert.deepEqual(lijst[1], {
    command: 'ribbon-tab:acme.kozijn', tab: 'acme.kozijn', label: 'Kozijnen', title: 'Kozijnen',
    disabled: false, active: true, stableId: true, kind: 'tab', extension: 'acme',
  });
  assert.equal(lijst[2].active, true, 'een tabknop die zichzelf actief markeert');
  for (const o of lijst) assert.deepEqual(leesLintOpdracht(o.command), { soort: 'tab', tab: o.tab });
});

// ─── Aansluiting in de brug ─────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const brug = lees('../mcp-bridge.js');
const stuk = (van, tot) => {
  const a = brug.indexOf(van);
  assert.ok(a >= 0, van);
  return brug.slice(a, brug.indexOf(tot, a + van.length));
};

test('de ingebouwde tabbladen zijn precies die met een vaste dataTab in Ribbon.jsx', () => {
  const ribbon = lees('../solid/components/ribbon/Ribbon.jsx');
  const inLint = [...ribbon.matchAll(/dataTab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(inLint)].sort(), [...INGEBOUWDE_TABBLADEN].sort());
  assert.doesNotMatch(brug, /RIBBON_TAB_ORDER/, 'geen tweede, vaste lijst in de brug');
});

test('zoeken loopt alle tabknoppen in de DOM langs, ook die van extensies', () => {
  const knoppen = stuk('function _lintTabKnoppen()', '\n}\n');
  assert.match(knoppen, /document\.querySelectorAll\('\.ribbon-tab'\)/);
  assert.match(knoppen, /classList\.contains\('file-tab'\)\) continue;/);
  assert.match(knoppen, /const tab = _naamVanTabKnop\(el\);/);
  // De naam komt uit tabNaam: data-tab, #id of het paneel uit aria-controls.
  const naam = stuk('function _naamVanTabKnop', '\n}\n');
  assert.match(naam, /tabNaam\(\{/);
  assert.match(naam, /ariaControls: el\.getAttribute\('aria-controls'\)/);
  // Het actieve tabblad komt uit de DOM, met de lintstore als terugval.
  const actief = stuk('async function _actiefTabblad', '\n}\n');
  assert.match(actief, /return actiefTabblad\(knoppen, storeTab\);/);
  const zoek = stuk('async function _findElementAcrossTabs', '\n}\n');
  assert.match(zoek, /tabVolgorde\(_lintTabKnoppen\(\)\.map\(\(t\) => t\.tab\), originalTab\)/);
});

test('app_click_element meldt het geactiveerde tabblad, ook van een extensie', () => {
  const klik = stuk('async function handleClickElement', '\n}\n');
  assert.match(klik, /const voor = await _actiefTabblad\(\);\n\s*el\.click\(\);/);
  assert.match(klik, /geactiveerdTabblad\(\{\s*gezocht: found\.activatedTab, voor, na: await _actiefTabblad\(\), tabKnop: _tabVanKnop\(el\),\s*\}\)/);
  assert.match(klik, /activeTab: await _actiefTabblad\(\),/);
});

test('app_list_commands: tabbladen eerst; extensietabbladen uit het register, DOM-tabbladen via de DOM', () => {
  const lijst = stuk('async function handleListCommands', 'async function handleRunCommand');
  assert.match(lijst, /let alles = \[\.\.\.tabbladen, \.\.\.lint, \.\.\.gereedschap, \.\.\.extensie\];/);
  assert.match(lijst, /tabCommands: tabbladen\.length,/);
  const perTab = stuk('async function _lintKnoppenPerTab', '\n}\n');
  assert.match(perTab, /if \(soort === 'extension'\) continue;/);
  assert.match(perTab, /_knoppenOpTab\(tab, soort\)/);
  assert.match(perTab, /command: knopOpdrachtId\(tab, \{ id: el\.id, n \}\)/);
  const opTab = stuk('function _knoppenOpTab', '\n}\n');
  assert.match(opTab, /if \(soort === 'builtin'\) \{\n\s*return \[\.\.\.new Set\(document\.querySelectorAll\(LINT_KNOP_SELECTOR\)\)\]\.filter\(_heeftMaat\);/,
    'ingebouwde knoppen houden hun nummering');
  assert.match(opTab, /!el\.hasAttribute\('data-ext-command'\)/);
});

test('app_run_command: ext eerst, dan tool, dan de lint-opdrachten via leesLintOpdracht', () => {
  const run = stuk('async function handleRunCommand', '// ─── Interface lezen');
  const volgorde = ["startsWith('ext:')", "startsWith('tool:')", "lint?.soort === 'tab'", "lint?.soort === 'id'", "lint?.soort === 'positie'"]
    .map((s) => run.indexOf(s));
  assert.ok(volgorde.every((i, n) => i > 0 && (n === 0 || i > volgorde[n - 1])), `volgorde ${volgorde}`);
  assert.match(run, /const knop = _tabKnop\(lint\.tab\);[\s\S]*?knop\.click\(\);[\s\S]*?activatedTab: lint\.tab/);
  assert.match(run, /if \(soort === 'extension'\) \{[\s\S]*?run as ext: commands/);
});

test('tabnaam: data-tab, dan #id, dan het paneel uit aria-controls', async () => {
  const { tabNaam } = await import('./mcp-lint-opdrachten.js');
  assert.equal(tabNaam({ dataTab: 'home', id: 'x', ariaControls: 'tab-y' }), 'home');
  assert.equal(tabNaam({ id: 'mijn-tab', ariaControls: 'tab-y' }), '#mijn-tab');
  // Een extensie die zelf een tabknop in de DOM zet met alleen aria-controls
  // naar haar paneel `tab-<naam>` (zoals de ingebouwde panelen heten).
  assert.equal(tabNaam({ ariaControls: 'tab-inteco' }), 'inteco');
  assert.equal(tabNaam({ ariaControls: 'acme-panel' }), 'acme-panel');
  assert.equal(tabNaam({ ariaControls: 'tab-' }), 'tab-');
  assert.equal(tabNaam({}), null);
  assert.equal(tabNaam(), null);
});

test('actief tabblad: de DOM gaat voor de lintstore, een extensietabblad wint', async () => {
  const { actiefTabblad } = await import('./mcp-lint-opdrachten.js');
  const k = (tab, actief = false) => ({ tab, actief });
  // Een extensietabblad dat zichzelf toont: de store weet daar niets van.
  assert.equal(actiefTabblad([k('home'), k('view'), k('inteco', true)], 'home'), 'inteco');
  assert.equal(actiefTabblad([k('home', true), k('view')], 'home'), 'home');
  // Twee knoppen actief: het niet-ingebouwde tabblad is het getoonde.
  assert.equal(actiefTabblad([k('home', true), k('inteco', true)], 'home'), 'inteco');
  assert.equal(actiefTabblad([k('home', true), k('view', true)], 'view'), 'view');
  // Geen enkele knop actief: terugvallen op de store.
  assert.equal(actiefTabblad([k('home'), k('view')], 'view'), 'view');
  assert.equal(actiefTabblad([], null), null);
});
