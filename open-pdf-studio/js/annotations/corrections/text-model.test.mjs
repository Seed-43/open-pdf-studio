// Text model of the proofreading mode (#508, part 2): lines and character
// positions from pdf.js getTextContent items, cursor movement, ranges and
// hit testing, also on rotated pages and with rotated text.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTextModel, lineText, locate, indexOf, totalLength, charAt, moveCursor,
  rangeText, rangeRects, caretAt, caretSegment, hitTest,
} from './text-model.js';
import { upVector } from './geometry.js';

// pdf.js viewport transforms at scale 1 for a 612 x 792 page.
const V0 = [1, 0, 0, -1, 0, 792];
const V90 = [0, 1, 1, 0, 0, 0];

/** pdf.js text item: horizontal in user space, 5 pt per character at size 10. */
const item = (str, x, y, extra = {}) => ({
  str, dir: 'ltr', width: str.length * 5, height: 10, transform: [10, 0, 0, 10, x, y],
  fontName: 'f1', hasEOL: false, ...extra,
});

const twee = () => buildTextModel([
  item('Teh quick', 72, 700, { hasEOL: true }),
  item('brown fox', 72, 686),
], { transform: V0 });

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const punt = (p, x, y, msg) => { bijna(p.x, x, `${msg} x`); bijna(p.y, y, `${msg} y`); };

test('two items on two baselines become two lines with characters on the baseline', () => {
  const m = twee();
  assert.equal(m.lines.length, 2);
  assert.equal(lineText(m, 0), 'Teh quick');
  assert.equal(lineText(m, 1), 'brown fox');
  assert.equal(m.lines[0].textDir, 0);
  punt(m.lines[0].chars[0].a, 72, 92, 'first character start');
  punt(m.lines[0].chars[0].b, 77, 92, 'first character end');
  punt(m.lines[1].chars[8].b, 117, 106, 'last character end');
  bijna(m.lines[0].chars[0].h, 10, 'font size');
  // A line end and the next line start are separate positions.
  assert.equal(totalLength(m), 19);
  assert.deepEqual(locate(m, 9), { line: 0, offset: 9 });
  assert.deepEqual(locate(m, 10), { line: 1, offset: 0 });
  assert.equal(indexOf(m, 1, 3), 13);
  assert.equal(charAt(m, 9), '\n');
  assert.equal(charAt(m, 10), 'b');
});

test('items on one baseline join; a gap without a space gets a virtual space', () => {
  const metGat = buildTextModel([item('Hello', 72, 700), item('world', 100, 700)], { transform: V0 });
  assert.equal(metGat.lines.length, 1);
  assert.equal(lineText(metGat, 0), 'Hello world');
  const spatie = metGat.lines[0].chars[5];
  assert.equal(spatie.virtual, true);
  punt(spatie.a, 97, 92, 'virtual space from the end of the first item');
  punt(spatie.b, 100, 92, 'to the start of the second item');

  const kleinGat = buildTextModel([item('Hello', 72, 700), item('world', 97.5, 700)], { transform: V0 });
  assert.equal(lineText(kleinGat, 0), 'Helloworld', 'kerning gap is not a space');

  const eigenSpatie = buildTextModel([item('Hello ', 72, 700), item('world', 104, 700)], { transform: V0 });
  assert.equal(lineText(eigenSpatie, 0), 'Hello world', 'no extra space next to a real one');

  const superscript = buildTextModel([item('x', 72, 700), item('2', 77, 703, { height: 6, transform: [6, 0, 0, 6, 77, 703] })], { transform: V0 });
  assert.equal(superscript.lines.length, 1, 'a raised item stays on its line');
});

test('hasEOL, an empty EOL item and a jump back start a new line', () => {
  const m = buildTextModel([
    item('one', 72, 700), { str: '', dir: 'ltr', width: 0, height: 0, transform: [1, 0, 0, 1, 0, 0], hasEOL: true },
    item('two', 87, 700), item('three', 72, 700),
  ], { transform: V0 });
  assert.deepEqual(m.lines.map((_, i) => lineText(m, i)), ['one', 'two', 'three']);
});

test('character widths follow the measure function when given', () => {
  const m = buildTextModel([{ ...item('WiW', 0, 700), width: 50 }], {
    transform: V0, measure: (s) => [...s].reduce((n, c) => n + (c === 'W' ? 2 : 1), 0),
  });
  const c = m.lines[0].chars;
  bijna(c[0].b.x, 20, 'W'); bijna(c[1].b.x, 30, 'i'); bijna(c[2].b.x, 50, 'W');
});

test('page /Rotate 90: horizontal text runs down the shown page (textDir 90)', () => {
  const m = buildTextModel([item('Abc', 100, 200)], { transform: V90 });
  const l = m.lines[0];
  assert.equal(l.textDir, 90);
  punt(l.chars[0].a, 200, 100, 'start');
  punt(l.chars[2].b, 200, 115, 'end');
  punt(l.up, upVector(90).x, upVector(90).y, 'up');
  const { rects, textDir } = rangeRects(m, 0, 3);
  assert.equal(textDir, 90);
  assert.deepEqual(rects.map((r) => [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 1e6) / 1e6)), [[198, 100, 10, 15]]);
});

test('rotated text on an upright page: baseline going up is textDir 270', () => {
  const m = buildTextModel([{ ...item('Up', 300, 300), transform: [0, 10, -10, 0, 300, 300] }], { transform: V0 });
  const l = m.lines[0];
  assert.equal(l.textDir, 270);
  punt(l.chars[0].a, 300, 492, 'start');
  punt(l.chars[1].b, 300, 482, 'end');
  punt(l.up, -1, 0, 'up points left');
  const seg = caretSegment(m, 1);
  punt(seg.from, 302, 487, 'cursor bottom (descent side)');
  punt(seg.to, 292, 487, 'cursor top (ascent side)');
  // Down-going text on the same page is a separate line in direction 90.
  const twee = buildTextModel([
    { ...item('Up', 300, 300), transform: [0, 10, -10, 0, 300, 300] },
    { ...item('Dn', 300, 300), transform: [0, -10, 10, 0, 310, 300] },
  ], { transform: V0 });
  assert.equal(twee.lines.length, 2);
  assert.equal(twee.lines[1].textDir, 90);
});

test('left and right move one position and cross line ends; the edges are reported', () => {
  const m = twee();
  assert.deepEqual(moveCursor(m, 0, 'right'), { pos: 1, goal: null, edge: null });
  assert.equal(moveCursor(m, 9, 'right').pos, 10, 'line end -> next line start');
  assert.equal(moveCursor(m, 10, 'left').pos, 9);
  assert.deepEqual(moveCursor(m, 0, 'left'), { pos: 0, goal: null, edge: 'start' });
  assert.deepEqual(moveCursor(m, 19, 'right'), { pos: 19, goal: null, edge: 'end' });
});

test('home, end, document start and end', () => {
  const m = twee();
  assert.equal(moveCursor(m, 3, 'lineEnd').pos, 9);
  assert.equal(moveCursor(m, 12, 'lineStart').pos, 10);
  assert.equal(moveCursor(m, 12, 'docStart').pos, 0);
  assert.equal(moveCursor(m, 2, 'docEnd').pos, 19);
});

test('up and down keep the column, also over a shorter line', () => {
  const m = buildTextModel([
    item('abcdefghij', 72, 700, { hasEOL: true }),
    item('xyz', 82, 686, { hasEOL: true }),
    item('klmnopqrst', 72, 672),
  ], { transform: V0 });
  // Column of offset 2 (x = 82) is the start of 'xyz'.
  const neer = moveCursor(m, 2, 'down');
  assert.equal(neer.pos, indexOf(m, 1, 0));
  // From offset 8 (x = 112) the nearest on 'xyz' is its end; the goal stays x = 112.
  const a = moveCursor(m, 8, 'down');
  assert.equal(a.pos, indexOf(m, 1, 3));
  const b = moveCursor(m, a.pos, 'down', { goal: a.goal });
  assert.equal(b.pos, indexOf(m, 2, 8), 'back in the original column');
  assert.equal(moveCursor(m, 3, 'up').edge, 'start');
  assert.equal(moveCursor(m, indexOf(m, 2, 1), 'down').edge, 'end');
});

test('word movement skips words, punctuation runs and spaces like a text editor', () => {
  const m = twee();
  assert.equal(moveCursor(m, 0, 'wordRight').pos, 4);
  assert.equal(moveCursor(m, 4, 'wordRight').pos, 10, 'over the line end');
  assert.equal(moveCursor(m, 10, 'wordRight').pos, 16);
  assert.equal(moveCursor(m, 16, 'wordRight').pos, 19);
  assert.equal(moveCursor(m, 19, 'wordRight').edge, 'end');
  assert.equal(moveCursor(m, 19, 'wordLeft').pos, 16);
  assert.equal(moveCursor(m, 16, 'wordLeft').pos, 10);
  assert.equal(moveCursor(m, 10, 'wordLeft').pos, 4, 'back over the line end');
  assert.equal(moveCursor(m, 4, 'wordLeft').pos, 0);
  assert.equal(moveCursor(m, 0, 'wordLeft').edge, 'start');

  const p = buildTextModel([item("end, it's ok", 72, 700)], { transform: V0 });
  assert.equal(moveCursor(p, 0, 'wordRight').pos, 3, 'stops before the comma');
  assert.equal(moveCursor(p, 3, 'wordRight').pos, 5, 'comma and space');
  assert.equal(moveCursor(p, 5, 'wordRight').pos, 10, "it's is one word");
});

test('range text joins lines with one space; ranges give one rectangle per line', () => {
  const m = twee();
  assert.equal(rangeText(m, 2, 13), 'h quick bro');
  assert.equal(rangeText(m, 13, 2), 'h quick bro', 'order does not matter');
  const { rects, textDir } = rangeRects(m, 2, 13);
  assert.equal(textDir, 0);
  assert.deepEqual(rects.map((r) => [r.x, r.y, r.width, r.height]), [[82, 84, 35, 10], [72, 98, 15, 10]]);
  assert.deepEqual(rangeRects(m, 9, 10).rects, [], 'only the line break: nothing to mark');
  const ruimte = buildTextModel([item('ab ', 72, 700, { hasEOL: true }), item('cd', 72, 686)], { transform: V0 });
  assert.equal(rangeText(ruimte, 0, 6), 'ab cd', 'no double space at a line join');
});

test('caretAt gives the baseline point, font size and direction of the position', () => {
  const m = twee();
  const c = caretAt(m, 3);
  punt(c.P, 87, 92, 'between h and space');
  assert.equal(c.h, 10);
  assert.equal(c.textDir, 0);
  punt(caretAt(m, 9).P, 117, 92, 'line end');
  punt(caretAt(m, 10).P, 72, 106, 'next line start');
  const seg = caretSegment(m, 3);
  punt(seg.from, 87, 94, 'bottom');
  punt(seg.to, 87, 84, 'top');
});

test('hitTest picks the nearest line and the nearest character boundary', () => {
  const m = twee();
  assert.equal(hitTest(m, 83, 90), 2);
  assert.equal(hitTest(m, 86, 90), 3);
  assert.equal(hitTest(m, 200, 90), 9, 'right of the line: its end');
  assert.equal(hitTest(m, 79, 99), 11, 'second line');
  assert.equal(hitTest(m, 300, 300), 19, 'far below right: nearest is the last line end');
  assert.equal(hitTest(buildTextModel([], { transform: V0 }), 1, 1), 0, 'empty model');
});

test('an empty page gives an empty model that every function accepts', () => {
  const m = buildTextModel([{ str: '', hasEOL: true }], { transform: V0 });
  assert.equal(m.lines.length, 0);
  assert.equal(totalLength(m), 0);
  assert.equal(moveCursor(m, 0, 'right').edge, 'end');
  assert.equal(moveCursor(m, 0, 'down').edge, 'end');
  assert.equal(rangeText(m, 0, 0), '');
  assert.equal(caretAt(m, 0), null);
});
