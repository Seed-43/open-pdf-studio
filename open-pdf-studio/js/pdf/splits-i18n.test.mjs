import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Document splitsen (#381): elke locale heeft de teksten, echt vertaald, met
// dezelfde plaatshouders als het Engels.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, '../i18n/locales');

const readJson = (locale, file) => JSON.parse(readFileSync(join(LOCALES, locale, file), 'utf8'));
const splitBlock = (locale) => readJson(locale, 'dialogs.json').splitDocument || {};
const plaatshouders = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

// Woorden die in die taal echt hetzelfde zijn als in het Engels.
const SAME_AS_ENGLISH = {
  fr: ['pages'],
  it: ['Output'],
  da: ['Output'],
  id: ['Folder:'],
  ms: ['Folder:'],
  pl: ['Folder:'],
  ro: ['Folder:'],
};

test('alle 40 locales hebben dezelfde splitsteksten als het Engels, geen lege', () => {
  const locales = readdirSync(LOCALES);
  assert.equal(locales.length, 40);
  const en = splitBlock('en');
  assert.ok(Object.keys(en).length >= 30);
  for (const locale of locales) {
    const block = splitBlock(locale);
    assert.deepEqual(Object.keys(block).sort(), Object.keys(en).sort(), locale);
    for (const [key, text] of Object.entries(block)) {
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${locale} splitDocument.${key} is leeg`);
      assert.deepEqual(plaatshouders(text), plaatshouders(en[key]), `${locale} splitDocument.${key}: plaatshouders`);
    }
    const organize = readJson(locale, 'ribbon.json').organize || {};
    assert.ok(organize.splitDocument && organize.splitLabel, `${locale} ribbon organize.splitDocument/splitLabel`);
  }
});

test('de plaatshouders voor de bestandsnamen blijven letterlijk staan', () => {
  for (const locale of readdirSync(LOCALES)) {
    const tekst = splitBlock(locale).placeholders;
    for (const p of ['{name}', '{n}', '{bookmark}', '{start}', '{end}']) {
      assert.ok(tekst.includes(p), `${locale} splitDocument.placeholders mist ${p}`);
    }
  }
});

test('geen locale kopieert het Engels', () => {
  const en = splitBlock('en');
  const kopieen = [];
  for (const locale of readdirSync(LOCALES)) {
    if (locale === 'en') continue;
    const toegestaan = new Set(SAME_AS_ENGLISH[locale] || []);
    const block = splitBlock(locale);
    for (const [key, text] of Object.entries(en)) {
      if (block[key] === text && !toegestaan.has(text)) kopieen.push(`${locale} ${key}: ${text}`);
    }
    const organize = readJson(locale, 'ribbon.json').organize;
    if (organize.splitDocument === 'Split Document') kopieen.push(`${locale} organize.splitDocument`);
  }
  assert.deepEqual(kopieen, []);
});

test('de titel van de dialoog is het label van de lintknop', () => {
  for (const locale of readdirSync(LOCALES)) {
    assert.equal(splitBlock(locale).title, readJson(locale, 'ribbon.json').organize.splitDocument, locale);
  }
});

test('elke sleutel die de code gebruikt bestaat', () => {
  const lees = (pad) => readFileSync(join(HERE, pad), 'utf8');
  const dialoog = lees('../solid/components/dialogs/SplitDocumentDialog.jsx');
  const app = lees('splits-app.js');
  const en = splitBlock('en');
  const gebruikt = new Set([
    ...[...dialoog.matchAll(/['"`]splitDocument\.(\w+)['"`]/g)].map((m) => m[1]),
    // splits-app.js vertaalt met t('sleutel') binnen dialogs:splitDocument.
    ...[...app.matchAll(/\bt\(\s*'(\w+)'/g)].map((m) => m[1]),
    ...[...app.matchAll(/\?\s*'(\w+)'\s*:\s*'(\w+)'/g)].flatMap((m) => [m[1], m[2]]),
  ]);
  assert.ok(gebruikt.size > 20, `${gebruikt.size} sleutels gevonden`);
  for (const key of gebruikt) assert.ok(en[key], `splitDocument.${key} wordt gebruikt maar ontbreekt`);
  assert.ok(readJson('en', 'ribbon.json').organize.splitDocument);
});
