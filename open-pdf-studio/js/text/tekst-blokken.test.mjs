// Groeperen van tekstlaag-spans tot regels en blokken (tekst-blokken.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { groepeerTekstBlokken, blokRegelafstand } from './tekst-blokken.js';

const span = (text, pdfX, pdfY, angle = 0, extra = {}) => ({
  text, pdfX, pdfY, angle, fontSize: 10, pdfWidth: text.length * 5, fontKey: 'Arial||', ...extra,
});
const teksten = (items, blokken) => blokken.map(b => b.map(r => r.map(i => items[i].text).join('')));

test('horizontale alinea: één blok met drie regels', () => {
  const items = [span('regel een', 72, 700), span('regel twee', 72, 688), span('regel drie', 72, 676)];
  assert.deepEqual(teksten(items, groepeerTekstBlokken(items)), [['regel een', 'regel twee', 'regel drie']]);
});

// Titelblok op een /Rotate 90-blad: de labels staan rechtop (hoek 90) onder
// elkaar op het scherm. In PDF-ruimte hebben ze dezelfde pdfY en een andere
// pdfX. Op pdfY gegroepeerd werden ze één regel "KENMERK:FORMAAT:SCHAAL:".
test('rechtop gezette labels op een gedraaid blad zijn aparte regels', () => {
  const items = [span('KENMERK:', 760, 30, 90), span('FORMAAT:', 745, 30, 90), span('SCHAAL:', 730, 30, 90)];
  const blokken = groepeerTekstBlokken(items);
  for (const blok of blokken) for (const regel of blok) assert.equal(regel.length, 1);
  assert.deepEqual(teksten(items, blokken).flat().sort(), ['FORMAAT:', 'KENMERK:', 'SCHAAL:']);
});

test('een alinea op hoek 90 blijft één blok in leesvolgorde', () => {
  // Regels lopen omhoog (hoek 90); de volgende regel staat rechts (+x).
  const items = [span('eerste regel', 100, 200, 90), span('tweede regel', 112, 200, 90)];
  const blokken = groepeerTekstBlokken(items);
  assert.deepEqual(teksten(items, blokken), [['eerste regel', 'tweede regel']]);
  assert.equal(blokRegelafstand([items[0], items[1]], 90, 10), 12);
});

// Een schuin straatnaamlabel met horizontale perceelteksten op dezelfde pdfY:
// die kwamen in één regel en gingen bij het opslaan mee in de richting van het
// label (boekje met de straatnamen).
test('spans met een andere richting komen nooit in dezelfde regel', () => {
  const items = [
    span('Paganinistraat', 212.9, 203.4, 284.9),
    span('323-K-7675', 230, 203.6, 0),
    span('Opp = 180.0 M2', 262, 203.5, 0),
  ];
  const blokken = teksten(items, groepeerTekstBlokken(items));
  assert.ok(blokken.some(b => b.length === 1 && b[0] === 'Paganinistraat'), JSON.stringify(blokken));
  assert.ok(!blokken.flat().some(r => r.includes('Paganini') && r.includes('323')), JSON.stringify(blokken));
});

test('tabelrijen blijven per rij (strict), kop en tekst apart', () => {
  const items = [
    span('Naam', 72, 700), span('Waarde', 150, 700),
    span('Breedte', 72, 688), span('12', 150, 688),
    span('Kop', 72, 650, 0, { fontKey: 'Arial|true|' }), span('Broodtekst', 72, 638),
  ];
  const blokken = teksten(items, groepeerTekstBlokken(items));
  assert.deepEqual(blokken, [['NaamWaarde'], ['Breedte12'], ['Kop'], ['Broodtekst']]);
});
