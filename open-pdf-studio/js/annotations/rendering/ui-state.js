import { state, getActiveDocument } from '../../core/state.js';
import {
  setContextualTabsVisible, syncFormatStore,
  ribbonActiveTab, setRibbonActiveTab,
} from '../../bridge.js';
import { getMeasureScale } from '../measurement.js';
import { checkSymbolInsertActive } from '../../symbols/symbol-insert-format-store.js';

// No-op: TitleBar.jsx now derives button states from reactive state
export function updateQuickAccessButtons() {}

// The contextual ribbon tabs ('format', 'arrange' and 'image') are shown only
// while something is selected. These are never counted as the "tab to return
// to" after deselecting.
const CONTEXTUAL_TABS = new Set(['format', 'arrange', 'image']);

// Remembered non-contextual tab to restore on deselection (e.g. 'home').
let _lastNormalTab = 'home';

// Signature of the previous selection, so tab auto-activation only fires on a
// real selection change — updateContextualTabs() runs on every redraw, and
// re-activating the tab each frame would trap the user on a contextual tab and
// fight any manual tab switch. null = "no selection".
let _prevSelSig = null;

// Vaste handtekening voor de invoegmodus van symbolen (#587): het Opmaak-
// tabblad gaat één keer open bij het begin van de sessie, niet bij elk
// geplaatst (en automatisch geselecteerd) symbool.
const SYMBOL_INSERT_SIG = 'symbol-insert';

function selectionSignature(sel) {
  if (!sel || sel.length === 0) return null;
  // id + type of every selected annotation, order-independent per redraw.
  return sel.map(a => `${a.id ?? ''}:${a.type ?? ''}`).join('|');
}

// Show/hide Format and Arrange contextual ribbon tabs
export function updateContextualTabs() {
  const _uiDoc = getActiveDocument();
  const _uiSel = _uiDoc ? _uiDoc.selectedAnnotations : [];
  const hasSelection = _uiSel.length > 0;
  // Tijdens het invoegen van symbolen toont het Opmaak-tabblad de opmaak voor
  // de volgende plaatsingen, ook zonder selectie (#587). syncFormatStore leest
  // dan de invoegsessie in plaats van de selectie.
  const symbolInsert = checkSymbolInsertActive();
  setContextualTabsVisible(hasSelection || symbolInsert);
  if (hasSelection || symbolInsert) {
    syncFormatStore(_uiSel);
  }
  // Contextual "Afbeelding" tab: visible only for a single image selection.
  syncImageEditTab(_uiSel);

  // Auto-activate the right contextual tab on a *real* selection change only.
  autoActivateContextualTab(_uiSel, symbolInsert);
}

// Automatically switch to the contextual tab that matches the current
// selection: 'image' for exactly one image annotation, 'format' for any other
// selection, and back to the last non-contextual tab when nothing is selected.
// Only acts when the selection actually changed since the last call so it never
// overrides a manual tab switch on subsequent redraws.
function autoActivateContextualTab(sel, symbolInsert = false) {
  const sig = symbolInsert ? SYMBOL_INSERT_SIG : selectionSignature(sel);
  if (sig === _prevSelSig) return; // no real selection change → leave tabs alone
  _prevSelSig = sig;

  const cur = ribbonActiveTab();

  if (sig === null) {
    // Deselected: if we're stranded on a contextual tab, return to the last
    // normal tab the user was on (falls back to 'home').
    if (CONTEXTUAL_TABS.has(cur)) {
      setRibbonActiveTab(_lastNormalTab || 'home');
    }
    return;
  }

  // A selection exists — remember the tab we came FROM if it was a normal one,
  // so deselecting later can restore it.
  if (!CONTEXTUAL_TABS.has(cur)) {
    _lastNormalTab = cur;
  }

  const isSingleImage = !symbolInsert && sel.length === 1 && sel[0].type === 'image';
  setRibbonActiveTab(isSingleImage ? 'image' : 'format');
}

// Cache the imageEditStore module after first load so the per-redraw sync
// doesn't pay a dynamic-import round-trip every frame.
let _imageEditMod = null;
function syncImageEditTab(sel) {
  if (_imageEditMod) {
    _imageEditMod.syncImageEditStore(sel);
    return;
  }
  import('../../solid/stores/imageEditStore.js')
    .then(m => { _imageEditMod = m; m.syncImageEditStore(sel); })
    .catch(() => { /* store not ready yet */ });
}

// Compute grid spacing in app-pixel space, honoring measure-scale so the
// preference value is interpreted in user units (default mm).
// Returns { spacingPx, originX, originY } or null if grid should be hidden.
export function getGridGeometry(viewportScale) {
  const userSpacing = state.preferences.gridSize || 10;
  let pxPerUnit = 1;
  try {
    const ms = getMeasureScale();
    if (ms && ms.pixelsPerUnit > 0) pxPerUnit = ms.pixelsPerUnit;
  } catch (_) { /* measurement module not ready */ }
  const spacingPx = userSpacing * pxPerUnit;
  // Hide when zoomed-out spacing < 4 screen px (avoids gpu meltdown)
  const screenSpacing = spacingPx * (viewportScale || 1);
  if (screenSpacing < 4) return null;
  return { spacingPx, screenSpacing };
}

// Draw dot-grid overlay (replaces line-grid). Coordinates here are in
// app-pixel space because the caller has already scaled the context.
export function drawGrid(ctx, width, height, viewportScale) {
  const geom = getGridGeometry(viewportScale);
  if (!geom) return;
  const { spacingPx, screenSpacing } = geom;

  ctx.save();
  ctx.fillStyle = '#cccccc';
  // 1 px screen dot — convert to app-units via 1/viewportScale
  const dotR = 0.5 / (viewportScale || 1);

  // Use a single Path2D-style batch (begin/arc/fill) for performance.
  ctx.beginPath();
  for (let x = 0; x <= width + spacingPx; x += spacingPx) {
    for (let y = 0; y <= height + spacingPx; y += spacingPx) {
      // Snap to integer screen pixel for crisp dots
      ctx.moveTo(x + dotR, y);
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // Optional minor dots at fine zoom (every spacing/5)
  if (screenSpacing > 60) {
    ctx.fillStyle = 'rgba(204, 204, 204, 0.5)';
    const fine = spacingPx / 5;
    ctx.beginPath();
    for (let x = 0; x <= width + spacingPx; x += fine) {
      for (let y = 0; y <= height + spacingPx; y += fine) {
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  ctx.restore();
}

// Snap a coordinate to the grid (single axis). Honors measure-scale so a
// gridSize of 10 (mm) produces grid-aligned points in app-pixel space.
export function snapToGrid(value) {
  if (!state.preferences.enableGridSnap) return value;
  const userSpacing = state.preferences.gridSize || 10;
  let pxPerUnit = 1;
  try {
    const ms = getMeasureScale();
    if (ms && ms.pixelsPerUnit > 0) pxPerUnit = ms.pixelsPerUnit;
  } catch (_) { /* not ready */ }
  const step = userSpacing * pxPerUnit;
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

// Snap a 2-D point to the nearest grid intersection. Returns
// {x, y, snapped:true, type:'grid'} when grid-snap pref enabled, else null.
export function snapPointToGrid(x, y) {
  if (!state.preferences.enableGridSnap) return null;
  const sx = snapToGrid(x);
  const sy = snapToGrid(y);
  if (sx === x && sy === y) return { x, y, snapped: true, type: 'grid' };
  return { x: sx, y: sy, snapped: true, type: 'grid' };
}
