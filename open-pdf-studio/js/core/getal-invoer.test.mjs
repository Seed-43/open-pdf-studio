// Getalinvoer: komma en punt zijn allebei een decimaalteken.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normaliseerGetalTekst, leesGetal, leesGetalOfNull, leesGetalBegin, leesGeheelGetal,
  leesVerhouding, leesFactor, leesGetalMetEenheid, decimaalTekenVoor, toonGetal,
} from './getal-invoer.js';

test('één scheidingsteken is altijd het decimaalteken', () => {
  assert.equal(leesGetal('0,1'), 0.1);
  assert.equal(leesGetal('0.1'), 0.1);
  assert.equal(leesGetal('1,5'), 1.5);
  assert.equal(leesGetal('1.5'), 1.5);
  assert.equal(leesGetal('1,234'), 1.234);
  assert.equal(leesGetal('1.234'), 1.234);
  assert.equal(leesGetal('12'), 12);
});

test('spaties eromheen en een voorteken', () => {
  assert.equal(leesGetal('  0,1  '), 0.1);
  assert.equal(leesGetal('-2,5'), -2.5);
  assert.equal(leesGetal('+2.5'), 2.5);
  assert.equal(leesGetal('\t-0.25\n'), -0.25);
  assert.equal(leesGetal('−3,5'), -3.5, 'typografisch minteken');
});

test('duizendtallen alleen waar het ondubbelzinnig is', () => {
  assert.equal(leesGetal('1.234,5'), 1234.5);
  assert.equal(leesGetal('1,234.5'), 1234.5);
  assert.equal(leesGetal('12.345.678,9'), 12345678.9);
  assert.equal(leesGetal('1,234,567.25'), 1234567.25);
  assert.equal(leesGetal('1.234.567'), 1234567);
  assert.equal(leesGetal('1,234,567'), 1234567);
  assert.ok(Number.isNaN(leesGetal('1.2,3')), 'groep van één cijfer');
  assert.ok(Number.isNaN(leesGetal('1,23.4')), 'groep van twee cijfers');
  assert.ok(Number.isNaN(leesGetal('1.234,5,6')), 'twee decimaaltekens');
  assert.ok(Number.isNaN(leesGetal('1,2,3')), 'geen geldige groepen');
  assert.ok(Number.isNaN(leesGetal('12.34.56')));
  assert.ok(Number.isNaN(leesGetal('1,234.5.6')));
  assert.ok(Number.isNaN(leesGetal('1.234,5.6')), 'groepteken na het decimaalteken');
});

test('een los decimaalteken aan begin of eind', () => {
  assert.equal(leesGetal(',5'), 0.5);
  assert.equal(leesGetal('.5'), 0.5);
  assert.equal(leesGetal('5,'), 5);
  assert.equal(leesGetal('5.'), 5);
  assert.equal(leesGetal('-,5'), -0.5);
});

test('ongeldige invoer geeft NaN of null', () => {
  for (const onzin of ['', '   ', '-', '+', ',', '.', 'abc', '1a', '1 000', '--1', '1-', '0,1x', 'NaN', 'Infinity', null, undefined, {}, [], true]) {
    assert.ok(Number.isNaN(leesGetal(onzin)), `leesGetal(${JSON.stringify(onzin)})`);
    assert.equal(leesGetalOfNull(onzin), null);
    assert.equal(normaliseerGetalTekst(onzin), '');
  }
  assert.ok(Number.isNaN(leesGetal(NaN)));
  assert.ok(Number.isNaN(leesGetal(Infinity)));
});

test('getallen gaan ongewijzigd door, exponenten worden gelezen', () => {
  assert.equal(leesGetal(0.1), 0.1);
  assert.equal(leesGetal(-7), -7);
  assert.equal(leesGetal('1e3'), 1000);
  assert.equal(leesGetal('2,5e-3'), 0.0025);
  assert.equal(leesGetal('1e-7'), 1e-7);
});

test('Arabisch-Indische cijfers en het Arabische decimaalteken', () => {
  assert.equal(leesGetal('٠٫٥'), 0.5);
  assert.equal(leesGetal('۱۲'), 12);
  assert.equal(leesGetal('١٬٢٣٤٫٥'), 1234.5);
});

test('canonieke tekst zoals de value van een getalveld', () => {
  assert.equal(normaliseerGetalTekst('0,1'), '0.1');
  assert.equal(normaliseerGetalTekst('1.234,50'), '1234.50');
  assert.equal(normaliseerGetalTekst('-,5'), '-0.5');
  assert.equal(normaliseerGetalTekst('+3'), '3');
  assert.equal(normaliseerGetalTekst(2.5), '2.5');
  assert.equal(normaliseerGetalTekst('5,'), '5');
});

test('leesGetalBegin vervangt parseFloat met beide decimaaltekens', () => {
  assert.equal(leesGetalBegin('2pt'), 2);
  assert.equal(leesGetalBegin('1,5 mm'), 1.5);
  assert.equal(leesGetalBegin('0.5x'), 0.5);
  assert.equal(leesGetalBegin('100%'), 100);
  assert.equal(leesGetalBegin('  -0,25'), -0.25);
  assert.equal(leesGetalBegin('1.2.3'), 1.2, 'zoals parseFloat');
  assert.equal(leesGetalBegin('1e3px'), 1000);
  assert.equal(leesGetalBegin(4), 4);
  assert.equal(leesGetalBegin('Infinity'), Infinity, 'zoals parseFloat');
  assert.equal(leesGetalBegin('-Infinity'), -Infinity);
  assert.ok(Number.isNaN(leesGetalBegin('pt2')));
  assert.ok(Number.isNaN(leesGetalBegin('')));
  assert.ok(Number.isNaN(leesGetalBegin(null)));
  // Gelijk aan parseFloat voor alles met een punt.
  for (const s of ['3', '3.75', '-12.5abc', '.5', '42 ', ' 7.0']) {
    assert.equal(leesGetalBegin(s), parseFloat(s), s);
  }
});

test('leesGeheelGetal vervangt parseInt', () => {
  assert.equal(leesGeheelGetal('12,7'), 12);
  assert.equal(leesGeheelGetal('12.7'), 12);
  assert.equal(leesGeheelGetal('3 stuks'), 3);
  assert.equal(leesGeheelGetal('-4,9'), -4);
  assert.ok(Number.isNaN(leesGeheelGetal('')));
  for (const s of ['12', '7px', '-3', '0']) assert.equal(leesGeheelGetal(s), parseInt(s, 10), s);
});

test('verhoudingen als 1:100', () => {
  assert.deepEqual(leesVerhouding('1:100'), { teller: 1, noemer: 100 });
  assert.deepEqual(leesVerhouding(' 1 : 53,42 '), { teller: 1, noemer: 53.42 });
  assert.deepEqual(leesVerhouding('1:53.42'), { teller: 1, noemer: 53.42 });
  assert.deepEqual(leesVerhouding('2,5:1'), { teller: 2.5, noemer: 1 });
  assert.equal(leesVerhouding('1:'), null);
  assert.equal(leesVerhouding('100'), null);
  assert.equal(leesVerhouding('1:2:3'), null);
  assert.equal(leesVerhouding(100), null);
});

test('factoren als 1x, 0,5x en 50%', () => {
  assert.equal(leesFactor('1x'), 1);
  assert.equal(leesFactor('0,5x'), 0.5);
  assert.equal(leesFactor('0.5x'), 0.5);
  assert.equal(leesFactor('1,5 ×'), 1.5);
  assert.equal(leesFactor('2X'), 2);
  assert.equal(leesFactor('50%'), 0.5);
  assert.equal(leesFactor('0,1'), 0.1);
  assert.equal(leesFactor(3), 3);
  assert.ok(Number.isNaN(leesFactor('x')));
  assert.ok(Number.isNaN(leesFactor('2y')));
  assert.ok(Number.isNaN(leesFactor('')));
});

test('getal met eenheid', () => {
  assert.deepEqual(leesGetalMetEenheid('2,5 m'), { waarde: 2.5, eenheid: 'm' });
  assert.deepEqual(leesGetalMetEenheid('100mm'), { waarde: 100, eenheid: 'mm' });
  assert.deepEqual(leesGetalMetEenheid('0.1'), { waarde: 0.1, eenheid: '' });
  assert.deepEqual(leesGetalMetEenheid("3'"), { waarde: 3, eenheid: "'" });
  assert.equal(leesGetalMetEenheid('mm'), null);
  assert.equal(leesGetalMetEenheid(''), null);
});

test('tonen met het decimaalteken van de taal', () => {
  assert.equal(decimaalTekenVoor('nl'), ',');
  assert.equal(decimaalTekenVoor('de'), ',');
  assert.equal(decimaalTekenVoor('en'), '.');
  assert.equal(decimaalTekenVoor('xx-onzin-taal-!!'), '.');
  assert.equal(toonGetal(0.1, 'nl'), '0,1');
  assert.equal(toonGetal(0.1, 'en'), '0.1');
  assert.equal(toonGetal('0.10', 'nl'), '0,10');
  assert.equal(toonGetal(12, 'nl'), '12');
  assert.equal(toonGetal(1234.5, 'nl'), '1234,5', 'geen duizendtalscheiding');
  assert.equal(toonGetal('Mixed', 'nl'), 'Mixed');
  assert.equal(toonGetal(null, 'nl'), '');
  assert.equal(toonGetal(NaN, 'nl'), '');
  // Wat getoond wordt, leest weer als hetzelfde getal.
  for (const n of [0.1, -2.5, 1234.5, 1e-7, 100]) {
    for (const taal of ['nl', 'en', 'de', 'fr']) assert.equal(leesGetal(toonGetal(n, taal)), n);
  }
});
