// Overlay of the proofreading mode (#508, part 2): the text cursor and the
// selection. The mode sets what to show; the annotation render loop draws it
// in page space for every page (single page and continuous), like the
// scan-text overlay. No blinking: the cursor is a steady line.
//
// Only the canvas context is touched: testable in node.

const SELECTIE_KLEUR = 'rgba(0, 120, 215, 0.28)';
const CURSOR_KLEUR = '#0066FF';

let huidig = null;

/**
 * What to draw. `caret`: {from, to} in page space (caretSegment), `rects`:
 * the selection, one rectangle per line.
 * @param {{ docId: string, page: number, caret: {from:{x,y},to:{x,y}}|null, rects?: Array<{x,y,width,height}> } | null} overlay
 */
export function setProofreadingOverlay(overlay) {
  huidig = overlay ? { ...overlay, rects: overlay.rects || [] } : null;
}

export function clearProofreadingOverlay() {
  huidig = null;
}

export function getProofreadingOverlay() {
  return huidig;
}

/**
 * Draws the cursor and selection on page `pageNum` of document `docId`.
 * @param {CanvasRenderingContext2D} ctx  in page space
 * @param {number} scale  CSS px per point, for a line of constant screen width
 */
export function drawProofreadingOverlay(ctx, pageNum, docId, scale = 1) {
  const o = huidig;
  if (!o || !ctx || o.page !== pageNum || (docId != null && o.docId !== docId)) return false;
  const sc = Number(scale) > 0 ? Number(scale) : 1;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash?.([]);
  if (o.rects.length > 0) {
    ctx.fillStyle = SELECTIE_KLEUR;
    for (const r of o.rects) ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  if (o.caret) {
    ctx.strokeStyle = CURSOR_KLEUR;
    ctx.lineWidth = 2 / sc;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(o.caret.from.x, o.caret.from.y);
    ctx.lineTo(o.caret.to.x, o.caret.to.y);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}
