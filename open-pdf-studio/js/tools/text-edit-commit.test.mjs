// Wat het bevestigen van een PDF-tekstbewerking doet (text-edit-tool.js):
// - alleen echte opmaak telt als opmaakwijziging, niet de getypte tekst;
// - alle tekst wissen en bevestigen verwijdert de oude tekst.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { opmaakGewijzigd, tekstGewist } from '../text/text-edit-appearance.js';

const bron = fs.readFileSync(new URL('./text-edit-tool.js', import.meta.url), 'utf8');

test('andere tekst met dezelfde opmaak is geen opmaakwijziging', () => {
  assert.equal(opmaakGewijzigd(
    [{ text: 'een blok vormen. Wanneer een woord aanzienlijk veel langer wordt', bold: false }],
    [{ text: 'een blok vormen. Wanneer een woord langer wordt', bold: false }],
  ), false);
  assert.equal(opmaakGewijzigd([{ text: 'Brede', bold: true }], [{ text: 'Ruime', bold: true }]), false);
});

test('een vet gemaakt woord of een andere kleur is wel een opmaakwijziging', () => {
  const begin = [{ text: 'Alfa beta gamma' }];
  assert.equal(opmaakGewijzigd([{ text: 'Alfa ' }, { text: 'beta', bold: true }, { text: ' gamma' }], begin), true);
  assert.equal(opmaakGewijzigd([{ text: 'Alfa beta gamma', color: '#ff0000' }], begin), true);
  assert.equal(opmaakGewijzigd([{ text: 'Alfa beta gamma', italic: true }], begin), true);
});

test('de commit vergelijkt de opmaak zonder de tekst (C2-reflow en C3 werken weer)', () => {
  const finish = bron.slice(bron.indexOf('function finishPdfTextEditing()'), bron.indexOf('function cancelPdfTextEditing()'));
  assert.match(finish, /opmaakGewijzigd\(runs, initialRuns\[i\]\)/);
  assert.doesNotMatch(finish, /r\.text === nb\[k\]\.text/);
});

test('alle tekst wissen van bestaande tekst is verwijderen', () => {
  assert.equal(tekstGewist('', 'Deze regel wordt verwijderd'), true);
  assert.equal(tekstGewist(' \n', 'a\nb'), true);
  assert.equal(tekstGewist('nieuw', 'oud'), false);
  assert.equal(tekstGewist('', ''), false); // nieuw toegevoegd blok: geen oude tekst
});

test('bevestigen met een lege editor verwijdert de oude tekst, in beide sessies', () => {
  const finish = bron.slice(bron.indexOf('function finishPdfTextEditing()'), bron.indexOf('function cancelPdfTextEditing()'));
  const i = finish.indexOf('if (tekstGewist(newText, originalText))');
  assert.ok(i > 0, 'finishPdfTextEditing kijkt niet of de tekst gewist is');
  assert.match(finish.slice(i, i + 200), /coverExistingText\(activeEditor\)/);
  const record = bron.slice(bron.indexOf('export function startTextEditEditing('), bron.indexOf('function applyColorToEditorSelection('));
  assert.match(record, /tekstGewist\(newText, textEdit\.originalText\)[\s\S]{0,200}textEdit\.newText = ''/);
});

test('het verwijder-record van bestaande tekst draagt de tekstrichting', () => {
  const cover = bron.slice(bron.indexOf('function coverExistingText('));
  assert.match(cover, /textAngle: block\.lineData\[0\]\.angle \|\| 0/);
});
