// Treffers per pagina in de zoekbalk (#686): bij meer treffers dan de lijst
// kan tonen schoven de regels over elkaar heen. De lijst is een flex-kolom
// met een maximale hoogte, en een regel met `overflow: hidden` heeft als
// flex-item een minimale hoogte van 0: in plaats van te scrollen kromp elke
// regel (in Chromium tot 4 px bij 40 pagina's). Een regel mag dus niet
// krimpen; de lijst groeit mee tot haar maximum en scrolt daarna.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(hier, '../../styles/find-bar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** De declaraties van alle regels met precies deze selector, samengevoegd. */
function declaraties(selector) {
  const uit = {};
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = sel.split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) uit[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return uit;
}

test('een treffersregel krimpt niet in de lijst, ook niet met overflow: hidden (#686)', () => {
  const regel = declaraties('.find-results-row');
  assert.equal(regel['flex-shrink'], '0', 'zonder flex-shrink: 0 schuiven de regels over elkaar');
});

test('de lijst scrolt zodra de treffers niet meer passen', () => {
  const lijst = declaraties('.find-results-list');
  assert.equal(lijst['overflow-y'], 'auto');
  assert.ok(lijst['max-height'], 'de lijst heeft een maximale hoogte');
});

test('de lijst groeit mee met het venster, niet vast op 150 px', () => {
  const lijst = declaraties('.find-results-list');
  assert.match(lijst['max-height'], /vh/, 'maximum volgt de vensterhoogte');
  assert.match(lijst['max-height'], /150px/, 'nooit lager dan de oude 150 px');
});
