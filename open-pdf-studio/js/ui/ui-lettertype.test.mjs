// Eén interface-lettertype (#600). De bediening (menu's, lint, dialogen,
// panelen, eigenschappen, tabellen, knoppen, tooltips) gebruikt overal het
// lettertype van het besturingssysteem via var(--ui-font) uit base.css.
// Deze wacht faalt zodra een stylesheet of inline stijl van de bediening
// weer een eigen lettertype vastzet in plaats van de variabele.
//
// Uitzonderingen staan in TOEGESTAAN met een reden: tekst die PDF-inhoud
// weergeeft of als typografisch pictogram dient.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const app = join(hier, '../..');
const lees = (pad) => readFileSync(join(app, pad), 'utf8');
const pad = (abs) => relative(app, abs).replace(/\\/g, '/');

function bestanden(map, filter) {
  const uit = [];
  for (const naam of readdirSync(map)) {
    const vol = join(map, naam);
    if (statSync(vol).isDirectory()) uit.push(...bestanden(vol, filter));
    else if (filter(naam)) uit.push(vol);
  }
  return uit;
}

const zonderCommentaar = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Alle lettertype-declaraties per regel: { bestand, selector, eigenschap, waarde }.
function declaraties(bestand) {
  const css = zonderCommentaar(lees(bestand));
  const uit = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    for (const d of m[2].matchAll(/(?:^|;)\s*(font-family|font)\s*:\s*([^;]+)/g)) {
      uit.push({ bestand, selector, eigenschap: d[1], waarde: d[2].trim() });
    }
  }
  return uit;
}

const UI_WAARDE = /^(inherit|var\(--ui-font(-mono)?\))$/;

// Bewuste uitzonderingen: [bestand, selector, reden].
const TOEGESTAAN = [
  ['styles/dialogs.css', '#text-annot-input',
    'invoer van annotatietekst: toont de tekst in het PDF-lettertype (standaard Arial, inline overschreven)'],
  ['styles/form-layer.css', '.formLayer .textWidgetAnnotation :is(input, textarea), .formLayer .choiceWidgetAnnotation select, .formLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input',
    'formuliervelden op de PDF-pagina: inhoud, geen bediening'],
  ['styles/form-layer.css', '.formLayer .textWidgetAnnotation input.comb',
    'kamveld op de PDF-pagina: vaste tekenbreedte hoort bij het veldtype'],
  ['styles/properties-panel.css', '.text-style-btn',
    'de knoppen B/I/U/S tonen hun letter als typografisch pictogram'],
  ['styles/ribbon.css', '.ribbon-style-preview',
    'voorbeeld-"T" van een tekststijl: toont het uiterlijk van PDF-tekst'],
];

const isToegestaan = ({ bestand, selector }) =>
  TOEGESTAAN.some(([b, s]) => b === bestand && s === selector);

const stylesheets = () => [
  'styles.css',
  ...bestanden(join(app, 'styles'), (n) => n.endsWith('.css')).map(pad),
];

test('base.css definieert het interface-lettertype centraal en laat het systeemfont voorgaan', () => {
  const css = zonderCommentaar(lees('styles/base.css'));
  const root = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, ':root-blok in base.css');
  const ui = root[1].match(/--ui-font\s*:\s*([^;]+);/);
  const mono = root[1].match(/--ui-font-mono\s*:\s*([^;]+);/);
  assert.ok(ui && mono, '--ui-font en --ui-font-mono staan op :root');
  const stapel = ui[1].split(',').map((s) => s.trim());
  assert.equal(stapel[0], 'system-ui', 'het besturingssysteem bepaalt het lettertype');
  for (const f of ['-apple-system', "'Segoe UI'", 'sans-serif']) {
    assert.ok(stapel.includes(f), `terugval ${f} voor WebViews zonder system-ui`);
  }
  assert.equal(stapel.at(-1), 'sans-serif');
  assert.equal(mono[1].split(',').map((s) => s.trim()).at(-1), 'monospace');

  assert.match(css, /body\s*\{[^}]*font-family:\s*var\(--ui-font\);/, 'body gebruikt de variabele');
  const controls = css.match(/((?:\s*[a-z]+\s*,)*\s*[a-z]+)\s*\{\s*font-family:\s*inherit;\s*\}/);
  assert.ok(controls, 'formulierelementen erven het lettertype');
  const elementen = controls[1].split(',').map((s) => s.trim());
  for (const el of ['button', 'input', 'select', 'textarea']) {
    assert.ok(elementen.includes(el), `${el} erft het lettertype (doet dat niet uit zichzelf)`);
  }
});

test('taalafhankelijke stapels zetten alleen --ui-font en beginnen met system-ui', () => {
  const css = zonderCommentaar(lees('styles/fonts.css'));
  assert.doesNotMatch(css, /(^|[;{\s])font(-family)?\s*:/, 'fonts.css zet geen lettertype op elementen');
  const blokken = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(blokken.length > 5);
  for (const [, selector, body] of blokken) {
    for (const s of selector.split(',')) assert.match(s.trim(), /^:root:lang\([a-z]+\)$/, s);
    const ui = body.match(/--ui-font\s*:\s*([^;]+);/);
    assert.ok(ui, `${selector.trim()} zet --ui-font`);
    const stapel = ui[1].split(',').map((s) => s.trim());
    assert.equal(stapel[0], 'system-ui', `${selector.trim()}: systeemfont eerst`);
    assert.equal(stapel.at(-1), 'sans-serif');
  }
});

test('geen stylesheet van de bediening zet een eigen lettertype vast', () => {
  const fout = [];
  let gezien = 0;
  for (const bestand of stylesheets()) {
    if (bestand === 'styles/fonts.css') continue;
    for (const d of declaraties(bestand)) {
      gezien++;
      if (UI_WAARDE.test(d.waarde) || isToegestaan(d)) continue;
      fout.push(`${d.bestand} ${d.selector} { ${d.eigenschap}: ${d.waarde} }`);
    }
  }
  assert.ok(gezien > 50, 'de stylesheets zijn gevonden en gelezen');
  assert.deepEqual(fout, [],
    'gebruik var(--ui-font), var(--ui-font-mono) of inherit; PDF-inhoud hoort in TOEGESTAAN met reden');
});

test('elke uitzondering bestaat nog (geen verouderde vrijstelling)', () => {
  const alle = stylesheets().flatMap(declaraties);
  for (const [bestand, selector, reden] of TOEGESTAAN) {
    assert.ok(reden.length > 10, `reden bij ${selector}`);
    const d = alle.find((x) => x.bestand === bestand && x.selector === selector);
    assert.ok(d, `${bestand} ${selector} heeft geen lettertype meer: haal hem uit TOEGESTAAN`);
    assert.doesNotMatch(d.waarde, UI_WAARDE, `${selector} gebruikt al de variabele`);
  }
});

test('inline stijlen in componenten zetten geen eigen interface-lettertype', () => {
  const bronnen = [
    ...bestanden(join(app, 'js/solid/components'), (n) => /\.(jsx?|tsx?)$/.test(n) && !n.includes('.test.')),
    ...bestanden(join(app, 'js/ui'), (n) => /\.(jsx?|tsx?)$/.test(n) && !n.includes('.test.')),
  ];
  const patronen = [
    /'font-family'\s*:\s*'([^']*)'/g,          // style={{ 'font-family': '…' }}
    /"font-family"\s*:\s*"([^"]*)"/g,
    /font-family\s*:\s*([^;"'`}]+)/g,          // style="font-family: …"
    /\.style\.fontFamily\s*=\s*['"`]([^'"`]*)/g, // el.style.fontFamily = '…'
  ];
  const fout = [];
  for (const abs of bronnen) {
    const bron = readFileSync(abs, 'utf8');
    for (const re of patronen) {
      for (const m of bron.matchAll(re)) {
        const waarde = m[1].trim();
        if (waarde.startsWith('$') || UI_WAARDE.test(waarde)) continue; // dynamisch of de variabele
        fout.push(`${pad(abs)}: ${m[0].trim()}`);
      }
    }
  }
  assert.deepEqual(fout, [], 'gebruik var(--ui-font) of var(--ui-font-mono) in inline stijlen');
});
