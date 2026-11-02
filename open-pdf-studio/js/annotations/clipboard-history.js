// Clipboard history: every markup copy of this session, shown in the
// Toolpalette (SymbolPalette.jsx). Clicking an entry makes it the current
// internal clipboard, so the next Ctrl+V (at the mouse, clipboard.js) pastes
// it. Session only: nothing is saved.
import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { annotationBounds } from './spatial-index.js';
import { drawAnnotation } from './rendering.js';

const MAX = 30;
const [items, setItems] = createSignal([]);
const [activeId, setActiveId] = createSignal(null);
let _volg = 0;

export { items as clipboardHistory, activeId as clipboardHistoryActive };

// Small picture of the copied markups (drawn, not a screen grab, so the
// selection handles don't show).
function miniatuur(annotaties) {
  try {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const a of annotaties) {
      const b = annotationBounds(a);
      if (!b) continue;
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
    }
    if (!Number.isFinite(x1)) return null;
    const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    const B = 112, H = 72, rand = 6;
    const k = Math.min((B - rand * 2) / w, (H - rand * 2) / h);
    const c = document.createElement('canvas');
    c.width = B * 2; c.height = H * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.translate(B / 2 - ((x1 + x2) / 2) * k, H / 2 - ((y1 + y2) / 2) * k);
    ctx.scale(k, k);
    for (const a of annotaties) {
      ctx.save();
      try { drawAnnotation(ctx, { ...a, _ignoreViewFilters: true }); } catch {}
      ctx.restore();
    }
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

function beschrijving(annotaties) {
  if (annotaties.length === 1) {
    const a = annotaties[0];
    const tekst = (a.text || a.contents || '').toString().trim();
    return tekst ? `${a.type}: ${tekst.slice(0, 24)}` : a.type;
  }
  return `${annotaties.length} markups`;
}

/** Called by copyAnnotation(s): add this copy to the history. */
export function addToClipboardHistory(annotaties) {
  const kopie = (annotaties || []).filter(Boolean).map(a => cloneAnnotation(a));
  if (!kopie.length) return;
  const id = `clip${++_volg}`;
  const item = { id, annotations: kopie, label: beschrijving(kopie), thumb: miniatuur(kopie), at: Date.now() };
  setItems(prev => [item, ...prev].slice(0, MAX));
  setActiveId(id);
}

/** Make an entry the current clipboard; the next Ctrl+V pastes it. */
export function useClipboardHistoryItem(id) {
  const item = items().find(i => i.id === id);
  if (!item) return;
  state.clipboardAnnotations = item.annotations.map(a => cloneAnnotation(a));
  state.clipboardAnnotation = state.clipboardAnnotations[0];
  // Fresher than the system clipboard, so Ctrl+V takes it (keyboard-handlers).
  state._internalCopyAt = Date.now();
  state._pasteSeq = 0;
  setActiveId(id);
}

export function removeClipboardHistoryItem(id) {
  setItems(prev => prev.filter(i => i.id !== id));
  if (activeId() === id) setActiveId(null);
}

export function clearClipboardHistory() {
  setItems([]);
  setActiveId(null);
}
