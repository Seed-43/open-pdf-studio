// De mobiele weergave (#593): elk gereedschap en elke knop in de lade doet
// iets, en elk label bestaat in alle talen.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

import { MOBIELE_GEREEDSCHAPPEN } from './mobiele-gereedschappen.js';

const bron = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const LOCALES = new URL('../i18n/locales/', import.meta.url);
const talen = readdirSync(LOCALES);
const json = (taal, ns) => JSON.parse(readFileSync(new URL(`${taal}/${ns}.json`, LOCALES), 'utf8'));
const waarde = (obj, sleutel) => sleutel.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

test('elk mobiel gereedschap staat in het gereedschapsregister', () => {
  const register = bron('../tools/tools/index.js');
  assert.ok(MOBIELE_GEREEDSCHAPPEN.length > 0);
  for (const { tool } of MOBIELE_GEREEDSCHAPPEN) {
    assert.match(register, new RegExp(`registerTool\\('${tool}',`), `${tool} is geen geregistreerd gereedschap`);
  }
});

test('geen dubbele gereedschappen in het menu', () => {
  const namen = MOBIELE_GEREEDSCHAPPEN.map((g) => g.tool);
  assert.equal(new Set(namen).size, namen.length);
});

test('elk label is vertaald in alle 40 talen', () => {
  assert.equal(talen.length, 40);
  for (const taal of talen) {
    const ribbon = json(taal, 'ribbon');
    for (const { label } of MOBIELE_GEREEDSCHAPPEN) {
      const tekst = waarde(ribbon, label);
      assert.equal(typeof tekst, 'string', `${taal}: ribbon.${label} ontbreekt`);
      assert.ok(tekst.trim().length > 0, `${taal}: ribbon.${label} is leeg`);
    }
    for (const sleutel of ['help.about']) {
      assert.ok(waarde(ribbon, sleutel), `${taal}: ribbon.${sleutel} ontbreekt`);
    }
    const common = json(taal, 'common');
    for (const sleutel of ['sendFeedback', 'preferences', 'open', 'save', 'saveAs']) {
      assert.ok(common[sleutel], `${taal}: common.${sleutel} ontbreekt`);
    }
  }
});

test('MobileApp verstuurt geen events waar niemand naar luistert', () => {
  const mobiel = bron('../solid/MobileApp.jsx');
  // 'set-tool', 'save-document', 'print-document', 'show-about': nooit
  // opgevangen, dus elke knop erachter deed niets.
  assert.doesNotMatch(mobiel, /dispatchEvent\(/);
  assert.match(mobiel, /setTool\(tool\)/);
  assert.match(mobiel, /savePDF\(\)/);
  assert.match(mobiel, /savePDFAs\(\)/);
});

test('feedback en "over" zijn op mobiel bereikbaar (#593)', () => {
  const mobiel = bron('../solid/MobileApp.jsx');
  assert.match(mobiel, /openDialog\('feedback'\)/);
  assert.match(mobiel, /openDialog\('about'\)/);
  // Zonder DialogHost opent openDialog() niets.
  assert.match(mobiel, /<DialogHost \/>/);
  // Dezelfde gastregel als de titelbalk van het bureaublad (#548).
  assert.match(mobiel, /knopUit\('send-feedback', \{ inTauri: isTauri\(\) \}\)/);
  const host = bron('../solid/components/DialogHost.jsx');
  assert.match(host, /'feedback': FeedbackDialog,/);
  assert.match(host, /'about': AboutDialog,/);
});

test('de mobiele werkbalk krimpt mee in plaats van buiten beeld te vallen', () => {
  const css = bron('../../styles/mobile.css');
  const regel = (selector) => {
    const i = css.indexOf(`${selector} {`);
    assert.notEqual(i, -1, selector);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(regel('.mobile-toolbar-btn'), /flex: 1 1 0;/);
  assert.match(regel('.mobile-toolbar-btn'), /min-width: 32px;/);
  assert.doesNotMatch(regel('.mobile-toolbar-btn'), /min-width: 44px;/);
  assert.match(regel('.mobile-toolbar-content'), /min-width: 0;/);
});
