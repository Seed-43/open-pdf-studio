/**
 * Scale Region tool — two-click placement.
 *
 * Click 1: top-left corner. Click 2: bottom-right corner. Between the two,
 * a live dashed-orange rectangle is drawn from P1 to the cursor. Esc or
 * right-click cancels.
 *
 * After the second click, opens the scale-region dialog so the user can pick
 * the scale ratio + units.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { createScaleRegion, invalidateScaleRegionCache } from '../../annotations/scale-region.js';
import { openDialog } from '../../bridge.js';
import { MIN_GEBIED_PX, schermPxNaarPt } from '../../annotations/minimummaat.js';
import { applyToolTransform } from '../tool-transform.js';
import { getEffectiveScale } from '../effective-scale.js';
import { previewCtx, redrawForViewMode } from '../preview-target.js';

const redraw = () => redrawForViewMode();

// Module-level placement state — survives across pointer events.
const _placement = { firstX: null, firstY: null };

function _reset() {
  _placement.firstX = _placement.firstY = null;
}

// Draw the orange dashed preview rectangle in app coordinates, on the canvas
// the user sees: `doelCtx` is the tool context's canvasCtx — in continuous
// view the page's own canvas, not the overlay that is off screen there (#616).
function _drawPreview(curX, curY, doelCtx = null) {
  if (_placement.firstX === null) return;
  const ctx = previewCtx(doelCtx);
  if (!ctx) return;
  redraw();
  // Screen pixels of the current view; an inactive viewport (continuous view)
  // keeps a stale zoom.
  const zoom = getEffectiveScale() || 1.5;
  ctx.save();
  // Zelfde transform als de annotatieweergave (ook met een gedraaide weergave, #200).
  applyToolTransform(ctx);
  const x1 = Math.min(_placement.firstX, curX);
  const y1 = Math.min(_placement.firstY, curY);
  const w = Math.abs(curX - _placement.firstX);
  const h = Math.abs(curY - _placement.firstY);
  ctx.strokeStyle = '#ff9800';
  ctx.fillStyle = 'rgba(255, 152, 0, 0.10)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.fillRect(x1, y1, w, h);
  ctx.strokeRect(x1, y1, w, h);
  ctx.restore();
}

export const scaleRegionTool = {
  name: 'scaleRegion',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    // Right-click cancels in-progress placement.
    if (e.button === 2) {
      if (_placement.firstX !== null) {
        _reset();
        ctx.redraw();
        e.preventDefault?.();
      }
      return;
    }
    if (e.button !== 0) return;

    if (_placement.firstX === null) {
      _placement.firstX = ctx.x;
      _placement.firstY = ctx.y;
      _drawPreview(ctx.x, ctx.y, ctx.canvasCtx);
      return;
    }

    // Second click — finalise.
    const x1 = Math.min(_placement.firstX, ctx.x);
    const y1 = Math.min(_placement.firstY, ctx.y);
    const w = Math.abs(ctx.x - _placement.firstX);
    const h = Math.abs(ctx.y - _placement.firstY);
    _reset();
    ctx.redraw();

    // Zelfde ondergrens als bij het slepen aan de grepen, in SCHERMPIXELS
    // (px / zoom): ingezoomd mag een schaalgebied kleiner zijn.
    const minPt = schermPxNaarPt(MIN_GEBIED_PX, ctx.scale);
    if (w < minPt || h < minPt) return;

    const doc = getActiveDocument();
    if (!doc) return;
    const pageNum = doc.currentPage || 1;

    const ann = createScaleRegion({
      page: pageNum,
      x: x1, y: y1, width: w, height: h,
      scaleString: '1:100',
      units: 'mm',
      label: '',
    });

    doc.annotations.push(ann);
    invalidateScaleRegionCache();
    redraw();

    openDialog('scale-region', { annotationId: ann.id, pageNum, isNew: true });

    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx) {
    if (_placement.firstX === null) return;
    _drawPreview(ctx.x, ctx.y, ctx.canvasCtx);
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — lopende
  // plaatsing weggooien. De keyboard-handler schakelt daarna naar de
  // selectietool.
  onEscape(ctx) {
    if (_placement.firstX === null) return false;
    _reset();
    ctx.redraw();
    return true;
  },

  onDeactivate() {
    _reset();
  },
};
