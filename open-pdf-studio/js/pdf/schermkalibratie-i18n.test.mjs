// Schermkalibratie (#520): elke taal heeft de teksten, echt vertaald, met de
// invulplekken ({{scale}}, {{ppi}}) intact.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const LOCALES = new URL('../i18n/locales/', import.meta.url);
const lees = (taal) => JSON.parse(readFileSync(new URL(`${taal}/preferences.json`, LOCALES), 'utf8'));

const PAGINA = ['actualSize', 'calibrationNone', 'calibrationActive', 'calibrate', 'removeCalibration', 'calibrationHint'];

// Teksten die in die taal echt hetzelfde zijn als in het Engels.
const GELIJK_AAN_ENGELS = {
  nl: ['px/inch'],
};

function teksten(taal) {
  const d = lees(taal);
  const uit = {};
  for (const k of PAGINA) uit[`pageDisplay.${k}`] = d.pageDisplay?.[k];
  for (const [k, v] of Object.entries(d.screenCalibration || {})) uit[`screenCalibration.${k}`] = v;
  return uit;
}

test('alle 40 talen hebben dezelfde kalibratiesleutels als het Engels, niet leeg', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = teksten('en');
  assert.equal(Object.keys(en).length, PAGINA.length + 13);
  for (const taal of talen) {
    const t = teksten(taal);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), taal);
    for (const [k, v] of Object.entries(t)) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${taal} ${k} is leeg`);
    }
  }
});

test('geen taal kopieert de Engelse tekst', () => {
  const en = teksten('en');
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const mag = new Set(GELIJK_AAN_ENGELS[taal] || []);
    const t = teksten(taal);
    for (const [k, v] of Object.entries(en)) {
      if (t[k] === v && !mag.has(v)) gekopieerd.push(`${taal} ${k}: ${v}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});

test('de invulplekken staan in elke vertaling', () => {
  const en = teksten('en');
  const fout = [];
  for (const taal of readdirSync(LOCALES)) {
    const t = teksten(taal);
    for (const [k, v] of Object.entries(en)) {
      const plekken = v.match(/\{\{\w+\}\}/g) || [];
      for (const plek of plekken) if (!t[k].includes(plek)) fout.push(`${taal} ${k} mist ${plek}`);
    }
  }
  assert.deepEqual(fout, []);
});

test('elke kalibratiesleutel in de code bestaat in het Engels', () => {
  const d = lees('en');
  const en = {};
  for (const blok of ['pageDisplay', 'screenCalibration']) {
    for (const [k, v] of Object.entries(d[blok])) en[`${blok}.${k}`] = v;
  }
  const bronnen = [
    '../solid/components/preferences/PageDisplayTab.jsx',
    '../solid/components/dialogs/ScreenCalibrationDialog.jsx',
  ].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  const gebruikt = new Set([...bronnen.matchAll(/'((?:pageDisplay|screenCalibration)\.\w+)'/g)].map((m) => m[1]));
  assert.ok(gebruikt.size >= 15);
  for (const sleutel of gebruikt) assert.ok(sleutel in en, `${sleutel} ontbreekt`);
});
