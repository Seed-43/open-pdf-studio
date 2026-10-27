import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The dialog is a Solid component and does not run under plain node; these are
// guard rails on its source for the wiring that broke in #492. The drawing
// itself lives in annotations/signature-pad.js and is tested there.
const source = readFileSync(new URL('./SignatureDialog.jsx', import.meta.url), 'utf8');
const component = source.slice(source.indexOf('export default function SignatureDialog'));

test('every canvas the Draw tab builds is handed to the pad', () => {
  // The Draw tab sits in a <Show>, so its canvas is built anew each time the
  // tab is shown again. Binding the pad once in onMount left it on the first.
  assert.match(component, /<canvas\s+ref=\{\(el\) => pad\.attach\(el\)\}/);
});

test('the dialog keeps no 2D context of its own', () => {
  assert.doesNotMatch(component, /getContext\(/);
  assert.doesNotMatch(component, /let ctx\b/);
});

test('the pad draws with pointer events, so a finger or pen draws too (#671)', () => {
  // A finger drag sends pointer and touch events; the compatibility mouse
  // events only come for a tap, so mouse handlers never saw a stroke.
  assert.doesNotMatch(component, /onMouse(Down|Move|Up|Leave)=/);
  assert.match(component, /onPointerDown=\{startDraw\}\s+onPointerMove=\{continueDraw\}\s+onPointerUp=\{endDraw\}\s+onPointerCancel=\{endDraw\}/);
  // Without touch-action: none the browser takes the drag as a scroll gesture.
  assert.match(component, /style=\{\{ 'touch-action': 'none' \}\}/);
  // The stroke keeps going when the finger or mouse leaves the pad; only the
  // left mouse button draws.
  assert.match(component, /e\.currentTarget\.setPointerCapture\(e\.pointerId\)/);
  assert.match(component, /if \(e\.pointerType === 'mouse' && e\.button !== 0\) return;/);
});

test('the canvas size is fixed markup, so it is in place before the pad repaints', () => {
  // Solid runs the ref before attributes it sets from an expression; writing
  // width or height after attach() would wipe the repainted signature.
  assert.match(source, /const CANVAS_WIDTH = \d+;/);
  assert.match(source, /const CANVAS_HEIGHT = \d+;/);
  assert.match(component, /width=\{CANVAS_WIDTH\}\s+height=\{CANVAS_HEIGHT\}/);
});
