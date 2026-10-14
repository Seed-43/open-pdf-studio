import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapTekst, plaatsTekstOpPagina } from './wrap-tekst.js';

const tien = (s) => s.length * 10; // elk teken 10 breed

test('korte tekst blijft ongewijzigd', () => {
  assert.equal(wrapTekst('hallo wereld', 200, tien), 'hallo wereld');
});

test('lange tekst breekt op spaties binnen de breedte', () => {
  const uit = wrapTekst('aaa bbb ccc ddd eee', 80, tien); // 8 tekens per regel
  assert.equal(uit, 'aaa bbb\nccc ddd\neee');
  for (const regel of uit.split('\n')) assert.ok(tien(regel) <= 80);
});

test('bestaande regeleinden en lege regels blijven staan', () => {
  assert.equal(wrapTekst('een\n\ntwee drie', 200, tien), 'een\n\ntwee drie');
  assert.equal(wrapTekst('aaa bbb ccc\nddd', 70, tien), 'aaa bbb\nccc\nddd');
});

test('een woord dat niet past wordt op tekens afgebroken', () => {
  const uit = wrapTekst('abcdefghij kl', 50, tien); // 5 tekens per regel
  assert.equal(uit, 'abcde\nfghij\nkl');
});

test('onbruikbare invoer geeft de tekst terug', () => {
  assert.equal(wrapTekst('abc def', 0, tien), 'abc def');
  assert.equal(wrapTekst('abc def', 50, null), 'abc def');
  assert.equal(wrapTekst(undefined, 50, tien), '');
});

// A4-breedte in punten, marge 36: de rechtermarge ligt op x = 559.
const A4_B = 595;

test('plaatsTekstOpPagina: korte tekst dicht bij de rechterrand blijft op het klikpunt', () => {
  const uit = plaatsTekstOpPagina({ tekst: 'OK', x: 500, paginaBreedte: A4_B, meet: tien });
  assert.deepEqual(uit, { x: 500, tekst: 'OK' });
  // Een regel per stuk telt, niet de hele tekst achter elkaar.
  const tweeRegels = plaatsTekstOpPagina({ tekst: 'abc\nde', x: 520, paginaBreedte: A4_B, meet: tien });
  assert.deepEqual(tweeRegels, { x: 520, tekst: 'abc\nde' });
});

test('plaatsTekstOpPagina: korte tekst over de marge schuift alleen zo ver als nodig', () => {
  const uit = plaatsTekstOpPagina({ tekst: 'OK', x: 580, paginaBreedte: A4_B, meet: tien });
  assert.equal(uit.tekst, 'OK');
  assert.equal(uit.x, A4_B - 36 - 20);
});

test('plaatsTekstOpPagina: lange tekst links op de pagina breekt op de rechtermarge', () => {
  const tekst = 'aaaa '.repeat(30).trim();
  const uit = plaatsTekstOpPagina({ tekst, x: 100, paginaBreedte: A4_B, meet: tien });
  assert.equal(uit.x, 100);
  for (const regel of uit.tekst.split('\n')) assert.ok(tien(regel) <= A4_B - 36 - 100);
  assert.ok(uit.tekst.includes('\n'));
});

test('plaatsTekstOpPagina: lange tekst dicht bij de rechterrand schuift naar links', () => {
  const tekst = 'aaaa '.repeat(30).trim();
  const uit = plaatsTekstOpPagina({ tekst, x: 500, paginaBreedte: A4_B, meet: tien });
  assert.equal(uit.x, A4_B - 36 - 150);
  for (const regel of uit.tekst.split('\n')) assert.ok(tien(regel) <= 150);
});

test('plaatsTekstOpPagina: zonder meter blijft alles staan', () => {
  assert.deepEqual(plaatsTekstOpPagina({ tekst: 'abc', x: 580, paginaBreedte: A4_B, meet: null }), { x: 580, tekst: 'abc' });
});
