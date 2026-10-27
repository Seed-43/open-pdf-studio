// De teksten van de versielijst en van kapotte bytes van de site (#707) staan
// in alle 40 talen, met de juiste invulplekken, en de code gebruikt ze.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HIER, '../i18n/locales');
const TALEN = readdirSync(LOCALES);
const lees = (taal, ns) => JSON.parse(readFileSync(join(LOCALES, taal, `${ns}.json`), 'utf8'));

const PANEEL = ['versions', 'versionNumber', 'currentVersion', 'noVersions', 'versionsError', 'olderVersionsHint'];
const INVUL = { versionNumber: '{{version}}' };
const LANG = ['versionsError', 'olderVersionsHint'];

test('alle 40 talen hebben de teksten, met de invulplekken', () => {
  assert.equal(TALEN.length, 40);
  const en = lees('en', 'appMenu').openPanel;
  for (const taal of TALEN) {
    const p = lees(taal, 'appMenu').openPanel;
    for (const k of PANEEL) {
      assert.ok(typeof p[k] === 'string' && p[k].trim(), `${taal}: openPanel.${k} ontbreekt`);
      if (INVUL[k]) assert.ok(p[k].includes(INVUL[k]), `${taal}: openPanel.${k} zonder ${INVUL[k]}`);
      // Korte woorden kunnen gelijk zijn aan het Engels ("Versions", "Version 2"); zinnen niet.
      if (taal !== 'en' && LANG.includes(k)) assert.notEqual(p[k], en[k], `${taal}: openPanel.${k} niet vertaald`);
    }
    const ongeldig = lees(taal, 'common').hostInvalidPdf;
    assert.ok(typeof ongeldig === 'string' && ongeldig.includes('{{name}}'), `${taal}: hostInvalidPdf`);
    if (taal !== 'en') assert.notEqual(ongeldig, lees('en', 'common').hostInvalidPdf, `${taal}: hostInvalidPdf niet vertaald`);
  }
});

// Oudere versies openen (#712).
const VERSIE = {
  hostVersionReadOnly: ['{{version}}', '{{total}}'],
  hostVersionReadOnlyShort: ['{{version}}'],
  hostVersionSaveBlocked: [],
  hostVersionReadOnlyRefused: [],
  hostVersionInvalid: [],
};

test('oudere versies (#712): alle 40 talen, met de invulplekken, en de code gebruikt ze', () => {
  const en = lees('en', 'common');
  for (const taal of TALEN) {
    const c = lees(taal, 'common');
    for (const [k, invul] of Object.entries(VERSIE)) {
      assert.ok(typeof c[k] === 'string' && c[k].trim(), `${taal}: ${k} ontbreekt`);
      for (const plek of invul) assert.ok(c[k].includes(plek), `${taal}: ${k} zonder ${plek}`);
      if (taal !== 'en' && !invul.length) assert.notEqual(c[k], en[k], `${taal}: ${k} niet vertaald`);
    }
    assert.doesNotMatch(lees(taal, 'appMenu').openPanel.olderVersionsHint, /^Only the current version/, `${taal}: oude uitleg`);
  }
  const code = ['host-versies.js', '../core/host-brug.js', 'saver.js']
    .map((f) => readFileSync(join(HIER, f), 'utf8')).join('\n');
  for (const k of Object.keys(VERSIE)) assert.ok(code.includes(`'${k}'`), `de code gebruikt ${k} niet`);
});

test('de code gebruikt de sleutels', () => {
  const paneel = readFileSync(join(HIER, '../solid/components/app-menu/OpenPanel.jsx'), 'utf8');
  for (const k of PANEEL) assert.ok(paneel.includes(`'openPanel.${k}'`), `OpenPanel gebruikt openPanel.${k} niet`);
  const document = readFileSync(join(HIER, 'host-document.js'), 'utf8');
  assert.ok(document.includes("'hostInvalidPdf'"));
});
