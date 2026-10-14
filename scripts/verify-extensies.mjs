// Live controle van #550/#551 tegen een eigen MCP-testrig: extensies
// installeren, bijwerken en herladen via MCP, een eigen linttabblad met een
// SVG-actie, een keuzelijst en een status, opdrachten via app_run_command,
// terugrollen bij een fout in activate, verwijderen via het extensiepaneel
// (daarna geen tabblad, geen ext:-opdrachten en geen palet meer), en daarbij
// blijven de open PDF's met hun niet-opgeslagen wijzigingen staan en herstart
// de app niet.
//
// Gebruik:
//   node scripts/verify-extensies.mjs --pakketten <map>
//       alleen de synthetische .oppx-pakketten in <map> schrijven
//   MCP_PORT=<poort> CDP_PORT=<poort> node scripts/verify-extensies.mjs --map <map> [--data <OPDS_DATA_DIR>]
//       de live controle; <map> krijgt de pakketten, --data controleert de schijf
//
// Voorwaarden: een eigen rig (OPDS_DETACHED=1, OPS_ENABLE_MCP=1, eigen
// OPDS_DATA_DIR en WEBVIEW2_USER_DATA_FOLDER) met --mcp-server op een vrije
// poort, en CDP via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<CDP_PORT>
// (alleen om bij het verwijderen de bevestigingsvraag van het paneel te
// beantwoorden). Nooit de poorten van de app van de gebruiker: de bekende
// poorten worden geweigerd. Exit 0 = GOED, 1 = MISLUKT.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const { maakOppx } = await import(pathToFileURL(path.join(hier, '..', 'open-pdf-studio', 'js', 'plugins', 'oppx-testpakket.mjs')).href);

const ID = 'nl.voorbeeld.kozijnen';
const TAB = `${ID}.main`;
const VERBODEN_POORTEN = new Set([9223, 9233, 9235, 9345, 9237, 9347, 9238, 9348]);

const arg = (naam) => {
  const i = process.argv.indexOf(naam);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// ─── De pakketten ────────────────────────────────────────────────────────

const SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="4" y="3" width="16" height="18"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="12" x2="20" y2="12"/></svg>';

function extensieCode({ tabLabel, actieLabel }) {
  return `
const SVG = ${JSON.stringify(SVG)};
let tab = null;
let aantal = 0;
let profiel = 'wood';
export function activate(api) {
  if (api.features?.ribbonTabs !== true) throw new Error('ribbon tabs not supported');
  // Zichtbaar, zodat de controle het palet in de DOM kan tellen.
  api.registerToolPalette({ id: '${ID}.palet', label: 'Kozijnen', icon: null, translationKey: null, tools: [],
    defaultVisible: true, defaultMode: 'docked-right', cssClass: 'kozijnen-palet' });
  tab = api.registerRibbonTab({
    id: 'main', label: ${JSON.stringify(tabLabel)}, icon: SVG,
    groups: [{ id: 'place', label: { en: 'Place', nl: 'Plaatsen' }, items: [
      { type: 'action', id: 'frame', label: ${JSON.stringify(actieLabel)}, title: 'Place a frame', icon: SVG,
        onRun: async (ctx) => { aantal++; tab.update('count', { text: String(aantal), tone: 'success' }); return { aantal, bron: ctx.source }; } },
      { type: 'dropdown', id: 'profile', label: { en: 'Profile', nl: 'Profiel' },
        options: [{ id: 'wood', label: { en: 'Wood', nl: 'Hout' } }, { id: 'alu', label: 'Aluminium' }], value: profiel,
        onChange: async (optie) => { profiel = optie; return { profiel }; } },
      { type: 'status', id: 'count', label: { en: 'Placed', nl: 'Geplaatst' }, text: '0' },
    ] }],
  });
}
export function deactivate() { tab = null; }
`;
}

const PAKKETTEN = {
  '1.0.0': () => maakOppx({ id: ID, name: 'Kozijnen', version: '1.0.0',
    code: extensieCode({ tabLabel: { en: 'Frames', nl: 'Kozijnen' }, actieLabel: { en: 'Frame', nl: 'Kozijn' } }) }),
  '1.1.0': () => maakOppx({ id: ID, name: 'Kozijnen', version: '1.1.0',
    code: extensieCode({ tabLabel: { en: 'Frames 1.1', nl: 'Kozijnen 1.1' }, actieLabel: { en: 'Frame 1.1', nl: 'Kozijn 1.1' } }) }),
  '1.2.0': () => maakOppx({ id: ID, name: 'Kozijnen', version: '1.2.0',
    code: `export function activate(api) {\n  api.registerRibbonTab({ id: 'main', label: 'Kapot', groups: [{ id: 'g', label: 'G', items: [{ type: 'status', id: 's', label: 'S', text: '' }] }] });\n  throw new Error('kapot in 1.2.0');\n}\n` }),
  '1.3.0': () => maakOppx({ id: ID, name: 'Kozijnen', version: '1.3.0',
    code: `export async function activate() {\n  await new Promise((r) => setTimeout(r, 20));\n  throw new Error('async kapot in 1.3.0');\n}\n` }),
  'zipslip': () => maakOppx({ id: ID, name: 'Kozijnen', version: '9.0.0', code: 'export function activate() {}',
    extra: [{ naam: '../buiten.txt', inhoud: 'mag niet' }] }),
};

function schrijfPakketten(map) {
  fs.mkdirSync(map, { recursive: true });
  const paden = {};
  for (const [versie, maak] of Object.entries(PAKKETTEN)) {
    const pad = path.resolve(map, `${ID}-${versie}.oppx`);
    fs.writeFileSync(pad, maak());
    paden[versie] = pad;
  }
  return paden;
}

if (arg('--pakketten')) {
  const paden = schrijfPakketten(arg('--pakketten'));
  for (const [v, p] of Object.entries(paden)) console.log(`${v}\t${p}`);
  process.exit(0);
}

// ─── Live ────────────────────────────────────────────────────────────────

const poort = Number(process.env.MCP_PORT);
const cdpPoort = Number(process.env.CDP_PORT);
for (const [naam, p] of [['MCP_PORT', poort], ['CDP_PORT', cdpPoort]]) {
  if (!Number.isInteger(p) || p <= 0) {
    console.error(`Zet ${naam} op de poort van de eigen testrig.`);
    process.exit(1);
  }
  if (VERBODEN_POORTEN.has(p)) {
    console.error(`Poort ${p} (${naam}) is van de app van de gebruiker of een andere sessie; gebruik een eigen rig.`);
    process.exit(1);
  }
}
const MCP = `http://127.0.0.1:${poort}/mcp`;
const map = arg('--map');
if (!map) { console.error('--map <map> ontbreekt'); process.exit(1); }
const dataMap = arg('--data');
const paden = schrijfPakketten(map);

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
let mcpId = 0;
async function mcp(naam, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: naam, arguments: args } }),
  });
  const j = JSON.parse(await res.text());
  if (j.error) throw new Error(`${naam}: ${j.error.message || JSON.stringify(j.error)}`);
  const c = j?.result?.content?.[0];
  if (c?.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
  return j.result;
}

// CDP, alleen om bij het verwijderen de bevestigingsvraag van het paneel met
// "ja" te beantwoorden (een native dialoog is via MCP niet te bedienen).
let ws = null;
let cdpId = 0;
const cdpWachters = new Map();
async function cdpVerbind() {
  const lijst = await (await fetch(`http://127.0.0.1:${cdpPoort}/json/list`)).json();
  const pagina = lijst.find((t) => t.type === 'page');
  if (!pagina) throw new Error('geen CDP-pagina gevonden');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && cdpWachters.has(m.id)) {
      const { res, rej } = cdpWachters.get(m.id);
      cdpWachters.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    }
  });
}
async function evalJs(expressie) {
  if (!ws) await cdpVerbind();
  const r = await new Promise((res, rej) => {
    const id = ++cdpId;
    cdpWachters.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expressie, returnByValue: true, awaitPromise: true } }));
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

function pidOpPoort() {
  try {
    const uit = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const regel = uit.split(/\r?\n/).find((r) => r.includes(`127.0.0.1:${poort} `) && /LISTENING/.test(r));
    return regel ? Number(regel.trim().split(/\s+/).pop()) : null;
  } catch {
    return null;
  }
}

const fouten = [];
let stap = '';
function controleer(ok, wat, extra) {
  const regel = `${ok ? 'GOED   ' : 'MISLUKT'} [${stap}] ${wat}`;
  console.log(extra !== undefined && !ok ? `${regel}\n          ${JSON.stringify(extra).slice(0, 600)}` : regel);
  if (!ok) fouten.push(`[${stap}] ${wat}`);
}
const ui = (selector) => mcp('app_ui_state', { selector, searchTabs: false });
const extensie = async () => (await mcp('app_list_extensions', { includeContributions: true })).extensions?.find((e) => e.id === ID);
async function precies1Tabblad() {
  const een = await ui(`.ribbon-tab[data-tab="${TAB}"]`);
  const twee = await ui('.ribbon-tab[data-tab^="nl.voorbeeld."] ~ .ribbon-tab[data-tab^="nl.voorbeeld."]');
  return een.found === true && twee.found === false;
}
// Het palet in de DOM: geen, één of (fout) meer.
async function aantalPaletten() {
  if ((await ui('.tp-ext.kozijnen-palet')).found !== true) return 0;
  return (await ui('.tp-ext.kozijnen-palet ~ .tp-ext.kozijnen-palet')).found === true ? 2 : 1;
}

// 1. Twee PDF-tabbladen, één met een niet-opgeslagen wijziging.
stap = '1';
await mcp('app_new_blank_pdf', { widthPt: 595, heightPt: 842 });
await wacht(1500);
await mcp('app_new_blank_pdf', { widthPt: 842, heightPt: 595 });
await wacht(1500);
await mcp('app_create_annotation', { type: 'box', page: 1, props: { x: 60, y: 60, width: 120, height: 60, color: '#cc0000' } });
await wacht(500);
const tabsVoor = (await mcp('app_list_tabs')).tabs;
const pidVoor = pidOpPoort();
controleer(tabsVoor?.length >= 2, `${tabsVoor?.length} PDF-tabbladen open`);
controleer(tabsVoor?.some((t) => t.modified), 'één document heeft niet-opgeslagen wijzigingen', tabsVoor);
console.log(`          rig-PID ${pidVoor}`);

// 2. Installeren, idempotentie.
stap = '2';
const r1 = await mcp('app_install_extension', { path: paden['1.0.0'], replace: 'never', idempotencyKey: 'verify-k1-0001' });
controleer(r1.ok === true && r1.outcome === 'installed' && r1.activated === true, 'installed en activated', r1);
const e1 = await extensie();
controleer(e1?.status === 'active' && e1?.version === '1.0.0', 'app_list_extensions: active 1.0.0', e1);
const r1b = await mcp('app_install_extension', { path: paden['1.0.0'], replace: 'never', idempotencyKey: 'verify-k1-0001' });
controleer(r1b.replayed === true && r1b.outcome === 'installed', 'zelfde sleutel: replayed', r1b);
const r1c = await mcp('app_install_extension', { path: paden['1.0.0'], replace: 'always', idempotencyKey: 'verify-k1-0001' });
controleer(r1c.code === 'IDEMPOTENCY_KEY_REUSED', 'zelfde sleutel met always: IDEMPOTENCY_KEY_REUSED', r1c);

// 3. Opdrachten via MCP; resultaat en status in het lint.
stap = '3';
const lijst = await mcp('app_list_commands', { filter: 'ext:' });
const cmds = (lijst.commands || []).map((c) => c.command);
controleer(['frame', 'profile=wood', 'profile=alu'].every((c) => cmds.includes(`ext:${ID}:${c}`)) && lijst.extensionCommands >= 3,
  'app_list_commands toont de actie en de twee keuzes', lijst);
const run = await mcp('app_run_command', { command: `ext:${ID}:frame` });
controleer(run.ok === true && run.result?.aantal === 1 && run.result?.bron === 'mcp', 'actie uitgevoerd via MCP', run);
const keuze = await mcp('app_run_command', { command: `ext:${ID}:profile=alu` });
controleer(keuze.ok === true, 'keuze gezet via MCP', keuze);
const naKeuze = await mcp('app_list_commands', { filter: `ext:${ID}:profile` });
controleer(naKeuze.commands?.find((c) => c.command === `ext:${ID}:profile=alu`)?.active === true, 'alu is de actieve keuze', naKeuze);
await mcp('app_click_element', { selector: `.ribbon-tab[data-tab="${TAB}"]`, searchTabs: false });
await wacht(300);
const status = await ui(`[data-ext-status="${ID}:count"]`);
controleer(status.found && /1/.test(status.text), `status in het lint: "${status.text}"`, status);
controleer((await ui(`button[data-ext-command="ext:${ID}:frame"] .ribbon-btn-icon svg`)).found === true, 'SVG-pictogram op de actie');
controleer((await ui(`button[data-ext-command="ext:${ID}:frame"][id]`)).found === false, 'extensieknoppen hebben geen DOM-id');
const onbekend = await mcp('app_run_command', { command: `ext:${ID}:bestaatniet` });
controleer(onbekend.code === 'UNKNOWN_COMMAND', 'onbekende opdracht: UNKNOWN_COMMAND', onbekend);

// 4. Wisselen naar ingebouwde tabbladen en terug; inklappen.
stap = '4';
for (const t of ['home', 'view', TAB]) {
  await mcp('app_click_element', { selector: `.ribbon-tab[data-tab="${t}"]`, searchTabs: false });
  await wacht(250);
  controleer((await ui(`.ribbon-tab.active[data-tab="${t}"]`)).found === true, `tabblad ${t} actief`);
}
await mcp('app_click_element', { selector: '#ribbon-collapse-toggle', searchTabs: false });
await wacht(250);
controleer((await ui('.ribbon-ext-content')).found === false, 'lint ingeklapt');
const ingeklapt = await mcp('app_run_command', { command: `ext:${ID}:frame` });
controleer(ingeklapt.ok === true && ingeklapt.result?.aantal === 2, 'opdracht werkt bij een ingeklapt lint', ingeklapt);
await mcp('app_click_element', { selector: '#ribbon-collapse-toggle', searchTabs: false });
await wacht(250);
controleer((await ui('.ribbon-ext-content')).found === true, 'lint weer uitgeklapt');

// 5. Bijwerken; ifNewer met een oudere versie.
stap = '5';
const r2 = await mcp('app_install_extension', { path: paden['1.1.0'], replace: 'ifNewer', idempotencyKey: 'verify-k2-0001' });
controleer(r2.ok === true && r2.outcome === 'updated' && r2.previousVersion === '1.0.0', 'updated naar 1.1.0', r2);
const label = await ui(`.ribbon-tab[data-tab="${TAB}"]`);
controleer(/1\.1/.test(label.text), `nieuw label "${label.text}"`, label);
const r2b = await mcp('app_install_extension', { path: paden['1.0.0'], replace: 'ifNewer', idempotencyKey: 'verify-k2-0002' });
controleer(r2b.code === 'VERSION_NOT_NEWER', '1.0.0 met ifNewer: VERSION_NOT_NEWER', r2b);

// 6. Herladen: precies één tabblad en één palet, tabblad blijft actief.
stap = '6';
await mcp('app_click_element', { selector: `.ribbon-tab[data-tab="${TAB}"]`, searchTabs: false });
await wacht(250);
const r3 = await mcp('app_reload_extension', { id: ID });
controleer(r3.ok === true && r3.outcome === 'reloaded' && r3.activated === true, 'reloaded', r3);
await wacht(300);
controleer(await precies1Tabblad(), 'precies één extensietabblad');
const e3 = await extensie();
controleer(e3?.contributions?.palettes?.length === 1 && e3?.contributions?.ribbonTabs?.length === 1, 'één palet en één tabblad in de bijdragen', e3?.contributions);
controleer(await aantalPaletten() === 1, 'precies één palet in de DOM');
controleer((await ui(`.ribbon-tab.active[data-tab="${TAB}"]`)).found === true, 'het extensietabblad is nog actief');

// 7. Fout in activate: terugrollen naar 1.1.0.
stap = '7';
for (const v of ['1.2.0', '1.3.0']) {
  const r = await mcp('app_install_extension', { path: paden[v], replace: 'always', idempotencyKey: `verify-k7-${v}` });
  controleer(r.code === 'ACTIVATION_FAILED' && r.rolledBack === true && r.active?.version === '1.1.0' && r.active?.activated === true,
    `${v}: ACTIVATION_FAILED, teruggerold naar 1.1.0`, r);
}
controleer(await precies1Tabblad(), 'het tabblad van 1.1.0 staat er (één keer)');
const na7 = await mcp('app_run_command', { command: `ext:${ID}:frame` });
controleer(na7.ok === true, 'de opdrachten van 1.1.0 werken nog', na7);
if (dataMap) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataMap, 'OpenPDFStudio', 'plugins', ID, 'plugin.json'), 'utf8'));
  controleer(manifest.version === '1.1.0', `op schijf staat ${manifest.version}`);
}

// 8. Ongeldige pakketten en paden.
stap = '8';
const slip = await mcp('app_install_extension', { path: paden.zipslip, replace: 'always', idempotencyKey: 'verify-k8-zipslip' });
controleer(slip.code === 'PACKAGE_INVALID', 'ZIP-slip: PACKAGE_INVALID', slip);
const relatief = await mcp('app_install_extension', { path: 'kozijnen.oppx', replace: 'always', idempotencyKey: 'verify-k8-relatief' });
controleer(relatief.code === 'PATH_NOT_ALLOWED', 'relatief pad: PATH_NOT_ALLOWED', relatief);
const e8 = await extensie();
controleer(e8?.version === '1.1.0' && e8?.status === 'active', 'installatie ongewijzigd (1.1.0, actief)', e8);
if (dataMap) controleer(!fs.existsSync(path.join(dataMap, 'OpenPDFStudio', 'buiten.txt')), 'niets buiten de pluginmap geschreven');

// 9. Verwijderen via het extensiepaneel: uitzetten, opruimen, van schijf.
stap = '9';
const vraagNagebootst = await evalJs(`(() => {
  const d = window.__TAURI__?.dialog;
  if (!d) return 'geen dialog-API';
  const ja = async () => true;
  ja.__opdsVerify = true;
  try { Object.defineProperty(d, 'ask', { value: ja, configurable: true, writable: true }); } catch { try { d.ask = ja; } catch { /* bevroren */ } }
  return d.ask?.__opdsVerify === true ? 'ok' : 'niet te vervangen';
})()`);
controleer(vraagNagebootst === 'ok', `bevestigingsvraag nagebootst (${vraagNagebootst})`);
await mcp('app_click_element', { selector: '#ribbon-extensions', searchTabs: true });
await wacht(500);
await mcp('app_click_element', { selector: `.ext-card[data-extension-id="${ID}"] .ext-uninstall-btn`, searchTabs: false });
await wacht(800);
controleer((await ui(`.ribbon-tab[data-tab="${TAB}"]`)).found === false, 'het extensietabblad is weg');
const naUit = await mcp('app_list_commands', { filter: 'ext:' });
const restOpdrachten = (naUit.commands || []).filter((c) => c.command.startsWith(`ext:${ID}:`));
controleer(restOpdrachten.length === 0, 'app_list_commands toont geen ext:-opdrachten van de extensie meer', restOpdrachten);
controleer(await aantalPaletten() === 0, 'het palet is uit de DOM (en dus uit het register)');
controleer(!(await mcp('app_list_extensions', {})).extensions?.some((e) => e.id === ID), 'app_list_extensions kent de extensie niet meer');
if (dataMap) controleer(!fs.existsSync(path.join(dataMap, 'OpenPDFStudio', 'plugins', ID)), 'de map is van schijf');
await mcp('app_key', { key: 'Escape' }).catch(() => {});

// 10. Documenten en proces ongewijzigd.
stap = '10';
const tabsNa = (await mcp('app_list_tabs')).tabs;
const vorm = (tabs) => (tabs || []).map((t) => ({ fileName: t.fileName, modified: t.modified, annotationCount: t.annotationCount }));
controleer(JSON.stringify(vorm(tabsNa)) === JSON.stringify(vorm(tabsVoor)), 'zelfde tabbladen, modified en aantallen annotaties', { voor: vorm(tabsVoor), na: vorm(tabsNa) });
const pidNa = pidOpPoort();
controleer(pidVoor !== null && pidVoor === pidNa, `zelfde rig-proces (PID ${pidVoor} -> ${pidNa})`);

ws?.close();
console.log(fouten.length ? `\nMISLUKT: ${fouten.length} controle(s)` : '\nGOED: alle controles');
process.exit(fouten.length ? 1 : 0);
