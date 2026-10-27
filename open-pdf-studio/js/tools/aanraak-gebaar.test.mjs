// Vingerinvoer op de pagina (#671): met selecteren en de hand scrol je met de
// vinger, elk ander gereedschap tekent of plaatst. En een afgebroken aanwijzer
// (pointercancel) rondt het gebaar af op de laatste echte beweging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { aanraakActie, eindEventBijAfbreken } from './aanraak-gebaar.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8').split('\r\n').join('\n');

test('selecteren en de hand laten de vinger scrollen, tekenen en plaatsen niet', () => {
  for (const tool of ['select', 'hand', 'selectComments']) assert.equal(aanraakActie(tool), 'auto', tool);
  for (const tool of ['draw', 'box', 'polyline', 'measureDistance', 'stamp', 'eraser']) assert.equal(aanraakActie(tool), 'none', tool);
});

test('afgebroken aanwijzer: afronden met de laatste beweging van dezelfde aanwijzer', () => {
  const beweging = { pointerId: 7, clientX: 120, clientY: 80 };
  const afgebroken = { pointerId: 7, clientX: 0, clientY: 0 };
  assert.equal(eindEventBijAfbreken(afgebroken, beweging), beweging);
  // Een andere aanwijzer, of nog geen beweging: dan het afbreek-event zelf.
  assert.equal(eindEventBijAfbreken(afgebroken, { pointerId: 8, clientX: 1, clientY: 1 }), afgebroken);
  assert.equal(eindEventBijAfbreken(afgebroken, null), afgebroken);
});

test('de pagina krijgt touch-action none terwijl een teken- of plaatsgereedschap actief is', () => {
  assert.match(bron('../ui/cursor.js'), /document\.body\.dataset\.aanraak = aanraakActie\(state\.currentTool\) === 'none' \? 'tekenen' : 'bladeren';/);
  const css = bron('../../styles/layout.css');
  assert.match(css, /body\[data-aanraak="tekenen"\] #annotation-canvas,\nbody\[data-aanraak="tekenen"\] \.canvas-container-cont \{\n {2}touch-action: none;\n\}/);
});

test('pointercancel rondt het gebaar af, in enkele pagina en in doorlopende weergave', () => {
  assert.match(bron('../ui/setup.js'), /annotationCanvas\.addEventListener\('pointercancel', handlePointerCancel\);/);
  assert.match(bron('../pdf/renderer.js'), /cc\.addEventListener\('pointercancel', wrap\(handlePointerCancel\)\);/);
  const dispatcher = bron('./tool-dispatcher.js');
  assert.match(dispatcher, /export function handlePointerCancel\(e\) \{\n {2}handlePointerUp\(eindEventBijAfbreken\(e, _laatsteBeweging\)\);/);
});
