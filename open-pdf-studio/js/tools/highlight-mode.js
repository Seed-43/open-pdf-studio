// Highlight has two modes, shared by the ribbon and the tool palette:
// 'area' draws a box (the highlight tool), 'text' highlights the text you
// drag across (the Select tool, which selects page text, with
// state.textHighlightMode on).
// The last mode is remembered between sessions.
import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { setTool } from './manager.js';

const OPSLAG = 'ops.highlightMode';
let _start = 'area';
try { if (localStorage.getItem(OPSLAG) === 'text') _start = 'text'; } catch {}
const [highlightMode, setHighlightModeSignal] = createSignal(_start);

export { highlightMode };

/** True while either highlight mode is the active tool. */
export function highlightActive() {
  return state.currentTool === 'highlight'
    || (state.currentTool === 'select' && !!state.textHighlightMode);
}

/** Pick a mode and turn its tool on. */
export function kiesMarkering(mode) {
  const m = mode === 'text' ? 'text' : 'area';
  setHighlightModeSignal(m);
  try { localStorage.setItem(OPSLAG, m); } catch {}
  if (m === 'text') { setTool('select'); state.textHighlightMode = true; }
  else setTool('highlight');
}

/** Highlight button: turns the last mode on, or switches mode when already on. */
export function markeringKnop() {
  if (highlightActive()) kiesMarkering(highlightMode() === 'text' ? 'area' : 'text');
  else kiesMarkering(highlightMode());
}
