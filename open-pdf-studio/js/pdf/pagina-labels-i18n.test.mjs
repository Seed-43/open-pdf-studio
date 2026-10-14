import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paginalabels (#580): elke taal heeft de teksten van de naambouwer, echt
// vertaald, en elke sleutel die de code gebruikt bestaat.
const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');

const lees = (taal, bestand) => JSON.parse(readFileSync(join(LOCALES, taal, bestand), 'utf8'));
const blok = (taal) => lees(taal, 'dialogs.json').pageLabels || {};
const losse = (taal) => ({
  context: lees(taal, 'context.json').thumbnail?.pageLabels,
  properties: lees(taal, 'properties.json').leftPanel?.pageLabels,
  statusbar: lees(taal, 'statusbar.json').tools?.pageLabelPick,
});

test('alle 40 talen hebben dezelfde paginalabel-sleutels als het Engels, geen lege', () => {
  const talen = readdirSync(LOCALES);
  assert.equal(talen.length, 40);
  const en = blok('en');
  assert.ok(Object.keys(en).length >= 12);
  for (const taal of talen) {
    const b = blok(taal);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries({ ...b, ...losse(taal) })) {
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} ${sleutel} is leeg`);
    }
    // De plaatshouders en interpolaties blijven staan.
    assert.match(b.intro, /\{OCR1\}.*\{OCR2\}/s, `${taal} intro`);
    assert.ok(b.intro.includes('{{select}}'), `${taal} intro {{select}}`);
    assert.ok(b.reading.includes('{{done}}') && b.reading.includes('{{total}}'), `${taal} reading`);
  }
});

test('geen taal neemt de Engelse tekst over', () => {
  const en = { ...blok('en'), ...losse('en') };
  const gekopieerd = [];
  for (const taal of readdirSync(LOCALES)) {
    if (taal === 'en') continue;
    const b = { ...blok(taal), ...losse(taal) };
    for (const [sleutel, tekst] of Object.entries(en)) {
      if (b[sleutel] === tekst) gekopieerd.push(`${taal} ${sleutel}: ${tekst}`);
    }
  }
  assert.deepEqual(gekopieerd, []);
});

test('elke paginalabel-sleutel die de code gebruikt bestaat', () => {
  const en = blok('en');
  const dialoog = readFileSync(join(HIER, '../solid/components/dialogs/PageLabelsDialog.jsx'), 'utf8');
  const gebruikt = [...dialoog.matchAll(/\btx\('([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(gebruikt.length >= 10);
  for (const sleutel of gebruikt) assert.ok(en[sleutel], `dialogs.pageLabels.${sleutel}`);

  const menu = readFileSync(join(HIER, '../solid/components/ContextMenu.jsx'), 'utf8');
  assert.ok(menu.includes("t('thumbnail.pageLabels')"));
  const paneel = readFileSync(join(HIER, '../solid/components/left-panel/panels/ThumbnailsPanel.jsx'), 'utf8');
  assert.ok(paneel.includes("t('leftPanel.pageLabels')"));
  const gereedschap = readFileSync(join(HIER, '../tools/tools/label-gebied-tool.js'), 'utf8');
  assert.match(gereedschap, /LABEL_GEBIED_TOOL = 'pageLabelPick'/);
});
