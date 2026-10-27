// Lijnkoppen van pijlen naar /LE en terug. Een stijl die /LE niet kent
// ('stealth') gaat als de dichtstbijzijnde /LE-naam het bestand in, plus de
// exacte stijl in /OPS_LineHeads, zodat de kop na heropenen dezelfde is.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  kopNaarLE, koppenUitBestand, koppenSleutel,
  lintZetLijnkoppen, koppenVan, calloutKoppenNaarBestand, calloutKoppenUitBestand,
} from './lijnkoppen.js';

test('elke kop van het lint heeft een /LE-naam', () => {
  assert.equal(kopNaarLE('open'), 'OpenArrow');
  assert.equal(kopNaarLE('closed'), 'ClosedArrow');
  assert.equal(kopNaarLE('stealth'), 'OpenArrow');
  assert.equal(kopNaarLE('openReversed'), 'ROpenArrow');
  assert.equal(kopNaarLE('none'), 'None');
  assert.equal(kopNaarLE(undefined), 'None');
});

test('alleen een kop die /LE niet exact kent, krijgt de eigen sleutel', () => {
  assert.equal(koppenSleutel('none', 'open'), null);
  assert.equal(koppenSleutel('none', 'stealth'), 'none,stealth');
});

test('de eigen sleutel gaat voor /LE', () => {
  assert.deepEqual(koppenUitBestand(['None', 'OpenArrow'], 'none,stealth'), { startHead: 'none', endHead: 'stealth' });
  assert.deepEqual(koppenUitBestand(['ClosedArrow', 'Circle'], null), { startHead: 'closed', endHead: 'circle' });
  assert.deepEqual(koppenUitBestand([], undefined), { startHead: 'none', endHead: 'none' });
});

test('een onbekende waarde in de eigen sleutel valt terug op /LE', () => {
  assert.deepEqual(koppenUitBestand(['None', 'OpenArrow'], 'none,raket'), { startHead: 'none', endHead: 'open' });
});

test('een /LE die een ander programma wijzigde, gaat voor een oude sleutel', () => {
  assert.deepEqual(koppenUitBestand(['None', 'ClosedArrow'], 'none,stealth'), { startHead: 'none', endHead: 'closed' });
  assert.deepEqual(koppenUitBestand(['Circle', 'OpenArrow'], 'none,stealth'), { startHead: 'circle', endHead: 'stealth' });
  assert.deepEqual(koppenUitBestand(['None', 'None'], 'stealth,stealth'), { startHead: 'none', endHead: 'none' });
});

// ── Lint en paneel: welke typen hun koppen daar instellen (#612) ──────────

test('het lint zet de koppen van een pijl, een gebogen pijl en een callout', () => {
  for (const type of ['arrow', 'splineArrow', 'callout']) assert.equal(lintZetLijnkoppen(type), true, type);
  // Een lijn tekent geen koppen; maatlijnen hebben hun eigen koppen.
  for (const type of ['line', 'textbox', 'box', 'cloud', 'measureDistance', 'measurePerimeter', undefined]) {
    assert.equal(lintZetLijnkoppen(type), false, String(type));
  }
});

test('zonder eigen koppen: wat het scherm tekent', () => {
  assert.deepEqual(koppenVan({ type: 'callout' }), { startHead: 'none', endHead: 'closed', headSize: 7 });
  assert.deepEqual(koppenVan({ type: 'arrow' }), { startHead: 'none', endHead: 'open', headSize: 8 });
  assert.deepEqual(koppenVan({ type: 'splineArrow' }), { startHead: 'none', endHead: 'open', headSize: 8 });
  assert.deepEqual(koppenVan({ type: 'callout', startHead: 'circle', endHead: 'diamond', headSize: 26 }),
    { startHead: 'circle', endHead: 'diamond', headSize: 26 });
  assert.equal(koppenVan({ type: 'callout', endHead: 'none' }).endHead, 'none');
});

// ── Callout: /LE is bij een FreeText één naam, voor de punt (ISO 32000) ────

test('callout: /LE is de naam van de punt, de eigen sleutel draagt beide koppen', () => {
  assert.deepEqual(calloutKoppenNaarBestand('none', 'diamond'), { le: 'Diamond', sleutel: 'none,diamond' });
  assert.deepEqual(calloutKoppenNaarBestand('circle', 'stealth'), { le: 'OpenArrow', sleutel: 'circle,stealth' });
  assert.deepEqual(calloutKoppenNaarBestand('square', 'none'), { le: 'None', sleutel: 'square,none' });
});

test('callout: elke kop van het lint komt via /LE en de eigen sleutel terug', () => {
  const lint = ['none', 'open', 'closed', 'stealth', 'diamond', 'circle', 'square', 'slash'];
  for (const start of lint) {
    for (const eind of lint) {
      const { le, sleutel } = calloutKoppenNaarBestand(start, eind);
      assert.deepEqual(calloutKoppenUitBestand(le, sleutel), { startHead: start, endHead: eind }, `${start},${eind}`);
    }
  }
});

test('callout van een ander programma: /LE als losse naam of als rij', () => {
  assert.deepEqual(calloutKoppenUitBestand('OpenArrow', undefined), { startHead: 'none', endHead: 'open' });
  assert.deepEqual(calloutKoppenUitBestand(['ClosedArrow'], undefined), { startHead: 'none', endHead: 'closed' });
  // De eerste naam hoort bij het eerste punt van /CL: de punt.
  assert.deepEqual(calloutKoppenUitBestand(['Circle', 'None'], undefined), { startHead: 'none', endHead: 'circle' });
  // Zonder /LE: geen kop (de standaardwaarde van de specificatie).
  assert.deepEqual(calloutKoppenUitBestand(undefined, undefined), { startHead: 'none', endHead: 'none' });
});

test('callout: een /LE die een ander programma wijzigde, gaat voor de eigen sleutel', () => {
  assert.deepEqual(calloutKoppenUitBestand('Square', 'circle,stealth'), { startHead: 'circle', endHead: 'square' });
  assert.deepEqual(calloutKoppenUitBestand('OpenArrow', 'raket,stealth'), { startHead: 'none', endHead: 'stealth' });
});

test('callout die de app vóór #612 opsloeg: de dichte kop die het scherm toonde', () => {
  // Toen schreef de app altijd /LE /OpenArrow en geen /OPS_LineHeads.
  assert.deepEqual(calloutKoppenUitBestand('OpenArrow', undefined, { eigenBestand: true }), { startHead: 'none', endHead: 'closed' });
  // Heeft een ander programma /LE daarna gewijzigd, dan telt die.
  assert.deepEqual(calloutKoppenUitBestand('Diamond', undefined, { eigenBestand: true }), { startHead: 'none', endHead: 'diamond' });
});
