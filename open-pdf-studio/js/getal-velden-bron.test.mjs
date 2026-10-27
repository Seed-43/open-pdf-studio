// Broncontrole: elk getalveld accepteert komma én punt.
//
// Een <input type="number"> van de WebView weigert afhankelijk van de
// landinstelling één van beide decimaaltekens; daarom bestaat dat type niet
// meer in js/. Getalvelden zijn tekstvelden met data-getal en
// inputmode="decimal" (ui/getal-veld.js); losse komma-naar-punt-trucs zijn
// vervangen door de gedeelde parser (core/getal-invoer.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');

function bronbestanden(map, uit = []) {
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const pad = path.join(map, e.name);
    if (e.isDirectory()) bronbestanden(pad, uit);
    else if (/\.(jsx?|tsx?|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) uit.push(pad);
  }
  return uit;
}

const bestanden = bronbestanden(hier).map((pad) => ({
  pad: path.relative(app, pad).replace(/\\/g, '/'),
  tekst: fs.readFileSync(pad, 'utf8'),
}));

/**
 * Bewust overgeslagen. Leeg: er is geen enkel getalveld van het browsertype
 * meer. Komt er ooit een uitzondering, dan hier met de reden erbij.
 * @type {Record<string, string>}
 */
const TOEGESTAAN_TYPE_NUMBER = {};

test('geen <input type="number"> meer in js/', () => {
  const fout = [];
  for (const { pad, tekst } of bestanden) {
    if (TOEGESTAAN_TYPE_NUMBER[pad]) continue;
    const treffers = [
      /\btype=["']number["']/,
      /\btype=\{[^}]*['"]number['"]\s*:/,
      /\.type\s*=\s*['"]number['"]/,
      /setAttribute\(\s*['"]type['"]\s*,\s*['"]number['"]/,
    ].filter((re) => re.test(tekst));
    if (treffers.length) fout.push(pad);
  }
  assert.deepEqual(fout, [], 'gebruik type="text" inputmode="decimal" data-getal');
});

test('ook index.html heeft geen getalveld van het browsertype', () => {
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /type=["']?number/);
});

test('elk getalveld heeft inputmode="decimal" en type="text" naast data-getal', () => {
  const fout = [];
  let gezien = 0;
  for (const { pad, tekst } of bestanden) {
    if (!pad.endsWith('.jsx')) continue;
    for (const m of tekst.matchAll(/\bdata-getal\b/g)) {
      const begin = tekst.lastIndexOf('<input', m.index);
      const eind = tekst.indexOf('/>', m.index);
      if (begin < 0 || eind < 0) { fout.push(`${pad}: data-getal buiten een <input>`); continue; }
      const tag = tekst.slice(begin, eind);
      gezien++;
      if (!/\binputmode=(?:"decimal"|\{)/.test(tag) || !/\btype="text"/.test(tag)) {
        fout.push(`${pad}:${tekst.slice(0, m.index).split(/\r?\n/).length}`);
      }
    }
  }
  assert.ok(gezien > 100, `${gezien} getalvelden gevonden`);
  assert.deepEqual(fout, []);
});

test('de migratie raakte de getalvelden die de eigenaar noemde', () => {
  const metGetal = (pad) => {
    const b = bestanden.find((x) => x.pad === pad);
    assert.ok(b, pad);
    return (b.tekst.match(/\bdata-getal\b/g) || []).length;
  };
  // Kalibratie: pixels, afstand en vrije schaal.
  assert.ok(metGetal('js/solid/components/dialogs/CalibrationDialog.jsx') >= 3);
  // Eigenschappenpaneel: lijndikte en doorzichtigheid gaan via PrefComboBox.
  assert.ok(metGetal('js/solid/components/preferences/PrefComboBox.jsx') >= 1);
  // Meetschaal van een annotatie.
  assert.ok(metGetal('js/solid/components/properties-panel/MeasurementSection.jsx') >= 2);
  // Afdrukken en pagina-instelling.
  assert.ok(metGetal('js/solid/components/dialogs/PrintDialog.jsx') >= 5);
  assert.ok(metGetal('js/solid/components/dialogs/PageSetupDialog.jsx') >= 4);
});

test('de app waardeert getalvelden bij de start op', () => {
  const main = fs.readFileSync(path.join(hier, 'main.js'), 'utf8');
  assert.match(main, /installeerGetalVelden\(/);
  assert.match(main, /herformatteerGetalVelden\(/, 'na een taalwissel opnieuw tonen');
});

test('stylesheets kennen getalvelden aan data-getal, niet aan type="number"', () => {
  const fout = [];
  const stijlen = [path.join(app, 'styles.css'), ...fs.readdirSync(path.join(app, 'styles'))
    .filter((n) => n.endsWith('.css')).map((n) => path.join(app, 'styles', n))];
  for (const pad of stijlen) {
    if (!fs.existsSync(pad)) continue;
    if (/\[type=["']?number/.test(fs.readFileSync(pad, 'utf8'))) fout.push(path.basename(pad));
  }
  assert.deepEqual(fout, []);
});

/**
 * Een losse komma-naar-punt-vervanging die geen getal leest maar tekst
 * opbouwt, mag blijven. Al het andere gaat via core/getal-invoer.js.
 */
const TOEGESTAAN_KOMMA_PUNT = {
  'js/drafting/constructie/draagstructuur.js': 'bouwt de profielnaam "Koker 100x100x6.3" op, leest geen getal',
};

test('geen losse komma-naar-punt-parsers meer naast de gedeelde parser', () => {
  const fout = [];
  for (const { pad, tekst } of bestanden) {
    if (TOEGESTAAN_KOMMA_PUNT[pad]) continue;
    if (/\.replace\(\s*(['"]),\1\s*,\s*(['"])\.\2\s*\)/.test(tekst)) fout.push(pad);
  }
  assert.deepEqual(fout, [], 'gebruik leesGetal/leesGetalBegin uit core/getal-invoer.js');
});

test('PrefComboBox gooit de komma niet meer weg', () => {
  const b = bestanden.find((x) => x.pad === 'js/solid/components/preferences/PrefComboBox.jsx');
  assert.doesNotMatch(b.tekst, /\[\^0-9\.\\-\]/, '"0,5" werd "05"');
});
