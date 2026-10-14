// Bijdragescope per extensie (#550, #551): alles wat een extensie registreert,
// wordt bijgehouden en bij deactiveren of herladen gegarandeerd opgeruimd.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maakBijdrageScope, eigenaarVan, ExtensionContributionError, _wisEigenaars,
} from './extension-contributions.js';

test('opruimen gaat in omgekeerde volgorde en roept elke functie één keer aan', () => {
  _wisEigenaars();
  const scope = maakBijdrageScope('nl.a');
  const volgorde = [];
  scope.voegToe('ribbonTab', 'nl.a.main', () => volgorde.push('tab'));
  scope.voegToe('command', 'ext:nl.a:x', () => volgorde.push('x'));
  scope.voegToe('command', 'ext:nl.a:y', () => volgorde.push('y'));
  assert.deepEqual(scope.lijst(), [
    { soort: 'ribbonTab', sleutel: 'nl.a.main' },
    { soort: 'command', sleutel: 'ext:nl.a:x' },
    { soort: 'command', sleutel: 'ext:nl.a:y' },
  ]);
  const waarschuwingen = scope.ruimOp();
  assert.deepEqual(volgorde, ['y', 'x', 'tab']);
  assert.deepEqual(waarschuwingen, []);
  assert.deepEqual(scope.lijst(), []);
});

test('een opruimfunctie die gooit, stopt de rest niet en wordt een waarschuwing', () => {
  _wisEigenaars();
  const scope = maakBijdrageScope('nl.a');
  const gedaan = [];
  scope.voegToe('ribbonTab', 'nl.a.main', () => gedaan.push('tab'));
  scope.voegToe('command', 'ext:nl.a:x', () => { throw new Error('kapot'); });
  scope.voegToe('command', 'ext:nl.a:y', () => gedaan.push('y'));
  const waarschuwingen = scope.ruimOp();
  assert.deepEqual(gedaan, ['y', 'tab']);
  assert.equal(waarschuwingen.length, 1);
  assert.equal(waarschuwingen[0].code, 'CLEANUP_FAILED');
  assert.equal(waarschuwingen[0].soort, 'command');
  assert.equal(waarschuwingen[0].sleutel, 'ext:nl.a:x');
  assert.match(waarschuwingen[0].message, /kapot/);
  assert.equal(eigenaarVan('command', 'ext:nl.a:x'), null, 'eigenaarschap toch vrijgegeven');
});

test('dubbel opruimen doet niets; daarna weigert voegToe met EXTENSION_INACTIVE', () => {
  _wisEigenaars();
  const scope = maakBijdrageScope('nl.a');
  let keer = 0;
  scope.voegToe('command', 'ext:nl.a:x', () => keer++);
  scope.ruimOp();
  assert.deepEqual(scope.ruimOp(), []);
  assert.equal(keer, 1);
  assert.equal(scope.actief(), false);
  assert.throws(() => scope.voegToe('command', 'ext:nl.a:z', () => {}), (e) =>
    e instanceof ExtensionContributionError && e.code === 'EXTENSION_INACTIVE');
  assert.equal(eigenaarVan('command', 'ext:nl.a:z'), null, 'een late registratie laat niets achter');
});

test('CONTRIBUTION_CONFLICT tussen twee extensies, en binnen dezelfde extensie', () => {
  _wisEigenaars();
  const a = maakBijdrageScope('nl.a');
  const b = maakBijdrageScope('nl.b');
  a.voegToe('ribbonTab', 'gedeeld', () => {});
  assert.equal(eigenaarVan('ribbonTab', 'gedeeld'), 'nl.a');
  assert.throws(() => b.voegToe('ribbonTab', 'gedeeld', () => {}), (e) => e.code === 'CONTRIBUTION_CONFLICT');
  assert.throws(() => a.voegToe('ribbonTab', 'gedeeld', () => {}), (e) => e.code === 'CONTRIBUTION_CONFLICT');
  // B kan de bijdrage van A ook niet verwijderen.
  assert.equal(b.verwijder('ribbonTab', 'gedeeld'), false);
  assert.equal(eigenaarVan('ribbonTab', 'gedeeld'), 'nl.a');
});

test('unload van A laat de bijdrage van B staan', () => {
  _wisEigenaars();
  const a = maakBijdrageScope('nl.a');
  const b = maakBijdrageScope('nl.b');
  const weg = [];
  a.voegToe('command', 'ext:nl.a:x', () => weg.push('a'));
  b.voegToe('command', 'ext:nl.b:x', () => weg.push('b'));
  a.ruimOp();
  assert.deepEqual(weg, ['a']);
  assert.equal(eigenaarVan('command', 'ext:nl.b:x'), 'nl.b');
  assert.deepEqual(b.lijst(), [{ soort: 'command', sleutel: 'ext:nl.b:x' }]);
});

test('verwijder ruimt één bijdrage op en geeft de sleutel vrij', () => {
  _wisEigenaars();
  const a = maakBijdrageScope('nl.a');
  let weg = 0;
  a.voegToe('command', 'ext:nl.a:x', () => weg++);
  assert.equal(a.verwijder('command', 'ext:nl.a:x'), true);
  assert.equal(weg, 1);
  assert.equal(a.verwijder('command', 'ext:nl.a:x'), false, 'tweede keer niets');
  assert.equal(eigenaarVan('command', 'ext:nl.a:x'), null);
  // Opnieuw registreren mag na verwijderen.
  a.voegToe('command', 'ext:nl.a:x', () => weg++);
  a.ruimOp();
  assert.equal(weg, 2);
});

test('ongeldige aanroepen worden geweigerd', () => {
  _wisEigenaars();
  const a = maakBijdrageScope('nl.a');
  assert.throws(() => a.voegToe('', 'x', () => {}), TypeError);
  assert.throws(() => a.voegToe('command', '', () => {}), TypeError);
  assert.throws(() => a.voegToe('command', 'x', null), TypeError);
  assert.throws(() => maakBijdrageScope(''), TypeError);
});
