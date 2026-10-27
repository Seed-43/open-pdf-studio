// Geen popups en geen navigatie als gast (#695): één helper opent iets buiten
// de app, en alleen die helper mag window.open aanroepen.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Een kale browseromgeving: window, document en een klikbare <a>.
const geopend = [];
const geklikt = [];
globalThis.window = { open: (...args) => { geopend.push(args); return null; } };
globalThis.document = {
  createElement: (tag) => {
    const el = { tag, style: {}, click() { geklikt.push({ href: this.href, download: this.download }); } };
    return el;
  },
  body: { appendChild() {}, removeChild() {} },
};

const { openExtern, biedDownloadAan, biedBijlageAan } = await import('./extern-openen.js');
// De echte Engelse teksten: zo valt een ontbrekende sleutel ook op.
const i18next = (await import('i18next')).default;
const engels = JSON.parse(fs.readFileSync(new URL('../i18n/locales/en/common.json', import.meta.url), 'utf8'));
await i18next.init({ lng: 'en', defaultNS: 'common', ns: ['common'], resources: { en: { common: engels } } });
const { getDialogs, closeDialog } = await import('../solid/stores/dialogStore.js');

function opnieuw() {
  geopend.length = 0;
  geklikt.length = 0;
  closeDialog('message');
  delete window.__OPDS_HOST__;
  delete window.__TAURI__;
}

const melding = () => getDialogs().find((d) => d.name === 'message');

test('losse webversie: een link opent een nieuw tabblad, zoals altijd', async () => {
  opnieuw();
  await openExtern('https://open-aec.com/');
  assert.deepEqual(geopend, [['https://open-aec.com/', '_blank']]);
  assert.equal(melding(), undefined);
});

test('als gast: een link opent niets, het adres staat in een melding', async () => {
  opnieuw();
  window.__OPDS_HOST__ = {};
  try {
    await openExtern('https://github.com/OpenAEC-Foundation/open-pdf-studio');
    assert.deepEqual(geopend, [], 'als gast geen window.open');
    const m = melding();
    assert.ok(m, 'er hoort een melding te staan');
    assert.equal(m.data.address, 'https://github.com/OpenAEC-Foundation/open-pdf-studio');
    assert.equal(m.data.title, engels.hostedLinkTitle);
    assert.equal(m.data.message, engels.hostedLinkMessage);
  } finally { opnieuw(); }
});

test('bureaublad: de shell-plug-in opent het adres, geen window.open', async () => {
  opnieuw();
  const shell = [];
  window.__TAURI__ = { shell: { open: async (url) => { shell.push(url); } } };
  try {
    await openExtern('mailto:iemand@example.org');
    assert.deepEqual(shell, ['mailto:iemand@example.org']);
    assert.deepEqual(geopend, []);
    assert.equal(melding(), undefined);
  } finally { opnieuw(); }
});

test('een download is een <a download>, er opent niets', () => {
  opnieuw();
  biedDownloadAan('bijlage.html', new Uint8Array([60, 104, 49, 62]));
  assert.equal(geklikt.length, 1);
  assert.equal(geklikt[0].download, 'bijlage.html');
  assert.match(geklikt[0].href, /^blob:/);
  assert.deepEqual(geopend, []);
});

test('als gast: een bijlage wordt een download, met een melding', async () => {
  opnieuw();
  window.__OPDS_HOST__ = {};
  try {
    const uitkomst = await biedBijlageAan('rapport.html', new Uint8Array([1, 2, 3]));
    assert.equal(uitkomst, 'download');
    assert.deepEqual(geopend, [], 'als gast geen window.open, ook geen blob');
    assert.equal(geklikt.length, 1);
    assert.equal(geklikt[0].download, 'rapport.html');
    assert.equal(melding()?.data.message,
      engels.hostedAttachmentMessage.replace('{{filename}}', 'rapport.html'));
  } finally { opnieuw(); }
});

test('losse webversie: een bijlage opent in een tabblad, zoals altijd', async (t) => {
  opnieuw();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const uitkomst = await biedBijlageAan('foto.png', new Uint8Array([1]));
  assert.equal(uitkomst, 'tabblad');
  assert.equal(geopend.length, 1);
  assert.match(geopend[0][0], /^blob:/);
  assert.equal(geopend[0][1], '_blank');
  assert.equal(geklikt.length, 0);
  t.mock.timers.runAll();
});

// ── Bronwachter ─────────────────────────────────────────────────────────────
// Buiten de helper roept niets in js/ window.open aan, en niets navigeert het
// (hoofd)venster weg. Een nieuwe plek die iets wil openen gebruikt openExtern
// of biedBijlageAan.

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..', '..');
const HELPER = 'js/core/extern-openen.js';

function bronbestanden(map) {
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...bronbestanden(p));
    else if (/\.(jsx?|mjs|cjs|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) uit.push(p);
  }
  return uit;
}
const bronnen = bronbestanden(path.join(app, 'js'))
  .map((p) => [path.relative(app, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')]);

// Code, zonder regels die alleen commentaar zijn.
function codeRegels(tekst) {
  return tekst.split(/\r?\n/)
    .map((regel, i) => [i + 1, regel])
    .filter(([, regel]) => !/^\s*(\/\/|\*|\/\*)/.test(regel));
}

const POPUP = /\b(window|globalThis|self|top|parent)\s*\.\s*open\s*\(|(^|[^.\w$])open\s*\(\s*['"`]https?:/;
const NAVIGATIE = [
  /\b(window|top|parent|self|document)\s*\.\s*location\s*(\.\s*href\s*)?=(?!=)/,
  /(^|[^.\w$])location\s*(\.\s*href\s*)?=(?!=)/,
  /\blocation\s*\.\s*(assign|replace)\s*\(/,
];

test('alleen de helper roept window.open aan', () => {
  const fout = [];
  for (const [rel, tekst] of bronnen) {
    if (rel === HELPER) continue;
    for (const [nr, regel] of codeRegels(tekst)) {
      if (POPUP.test(regel)) fout.push(`${rel}:${nr}: ${regel.trim()}`);
    }
  }
  assert.deepEqual(fout, [], 'gebruik openExtern() of biedBijlageAan() uit core/extern-openen.js');
  // De helper zelf heeft hem wél: anders bewaakt deze test niets.
  assert.ok(bronnen.some(([rel, t]) => rel === HELPER && /window\.open\(/.test(t)));
});

test('niets in js/ navigeert het venster weg', () => {
  const fout = [];
  for (const [rel, tekst] of bronnen) {
    for (const [nr, regel] of codeRegels(tekst)) {
      if (NAVIGATIE.some((re) => re.test(regel))) fout.push(`${rel}:${nr}: ${regel.trim()}`);
    }
  }
  assert.deepEqual(fout, []);
});

// target="_blank" opent net zo goed een popup. Alleen de release-notes maken
// zulke links (uit Markdown); hun dialoog vangt de klik als gast af.
test('een target=_blank-link staat alleen waar de klik als gast wordt afgevangen', () => {
  const TOEGESTAAN = {
    'js/help/release-notes.js': 'js/solid/components/dialogs/WhatsNewDialog.jsx',
  };
  const fout = [];
  for (const [rel, tekst] of bronnen) {
    if (rel === HELPER) continue;
    for (const [nr, regel] of codeRegels(tekst)) {
      if (/['"`]_blank['"`]/.test(regel) && !(rel in TOEGESTAAN)) fout.push(`${rel}:${nr}: ${regel.trim()}`);
    }
  }
  assert.deepEqual(fout, []);
  const teksten = new Map(bronnen);
  for (const vanger of Object.values(TOEGESTAAN)) {
    assert.match(teksten.get(vanger), /isGehost\(\)/, `${vanger} vangt de klik als gast niet af`);
    assert.match(teksten.get(vanger), /openExtern\(/, `${vanger} gebruikt openExtern niet`);
  }
});

test('elke aanroeper van een externe link gebruikt de helper', () => {
  for (const rel of [
    'js/solid/components/dialogs/AboutDialog.jsx',
    'js/pdf/link-layer.js',
    'js/ui/panels/links.js',
    'js/pdf/email-pdf.js',
    'js/help/previous-version.js',
    'js/solid/components/preferences/FileAssocTab.jsx',
  ]) {
    const tekst = new Map(bronnen).get(rel);
    assert.ok(tekst, `${rel} bestaat niet meer`);
    assert.match(tekst, /openExtern\(/, rel);
  }
  assert.match(new Map(bronnen).get('js/ui/panels/attachments.js'), /biedBijlageAan\(/);
});

// De oude, losse PDF.js-viewer uit public/ (viewer.html met een window.open)
// gaat niet mee in de gastbundel; wat de app gebruikt wel.
test('de gastbundel houdt van pdfjs/web alleen wat de app gebruikt', async () => {
  const { viewerResten, PDFJS_MAPPEN } = await import('../../scripts/pdfjs-assets.mjs');
  assert.deepEqual(PDFJS_MAPPEN, ['cmaps', 'standard_fonts', 'wasm']);
  assert.deepEqual(
    viewerResten(['cmaps', 'viewer.html', 'viewer.mjs', 'standard_fonts', 'images', 'wasm', 'locale']),
    ['viewer.html', 'viewer.mjs', 'images', 'locale']);
  // De basis-URL's van de app wijzen alleen naar die mappen.
  const basis = fs.readFileSync(path.join(app, 'js/core/basis-url.js'), 'utf8');
  for (const m of basis.matchAll(/pdfjs\/web\/([\w-]+)\//g)) {
    assert.ok(PDFJS_MAPPEN.includes(m[1]), `de app gebruikt pdfjs/web/${m[1]}/`);
  }
});
