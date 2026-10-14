// ============================================================================
// "Edit embedded image" tool (issues #184 and follow-up).
//
// Works on a raster image that is baked into the PDF page content (an image
// XObject drawn with `/Name Do`) — distinct from image *annotations* (stamps),
// which the contextual "Afbeelding" tab already handles (#212).
//
// While active, every editable image on the current page is outlined; the one
// under the cursor is highlighted.
//   - Click an image to select it.
//   - Drag the selected image to move it; drag a handle to resize it (corners
//     keep the proportions, hold Shift to stretch freely).
//   - Double-click the selected image to replace it with another picture; the
//     new picture is fitted inside the old frame.
//   - Delete removes it, Escape clears the selection.
// Every change rewrites the page content, is saved into the PDF and can be
// undone. The tool id stays 'removeImage' (ribbon, key handling, rendering).
// ============================================================================

import { state, getActiveDocument } from '../../core/state.js';
import { setTool } from '../manager.js';
import { getEffectiveScale } from '../tool-context.js';
import { showMessage } from '../../bridge.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { openFileDialog, readBinaryFile } from '../../core/platform.js';
import i18next from '../../i18n/config.js';
import {
  detectEmbeddedImages, getCachedEmbeddedImages, hitTestEmbeddedImage,
  removeEmbeddedImage, moveEmbeddedImage, replaceEmbeddedImage, clearEmbeddedImageCache,
} from '../embedded-image-detector.js';
import { sleepKader, HANDVATTEN } from '../embedded-image-drag.js';

let _hoverPage = -1;
let _hoverIndex = -1;
let _selPage = -1;
let _selIndex = -1;
let _drag = null; // { mode, page, index, start:{x,y}, orig, cur, moved }
let _lastClick = { t: 0, page: -1, index: -1 };
let _busy = false;

const DOUBLE_CLICK_MS = 450;
const MIN_SLEEP_PX = 3;
// Resize cursor per handle (edges straight, corners diagonal).
const GREEP_CURSOR = {
  tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize',
  t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
};

function t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

function redrawNow() {
  const redraw = getActiveDocument()?.viewMode === 'continuous'
    ? () => import('../../annotations/rendering.js').then(m => m.redrawContinuous())
    : () => import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
  redraw();
}

// Ensure the current page's images are detected; redraw once ready.
function ensureDetected(pageNum, redraw) {
  if (getCachedEmbeddedImages(pageNum)) return;
  detectEmbeddedImages(pageNum).then((list) => {
    if (state.currentTool !== 'removeImage') return;
    if (list.length === 0) {
      showMessage(t('drawing.noEmbeddedImages', 'No embedded images found on this page.'));
    }
    redraw && redraw();
  }).catch(() => {});
}

function gekozen() {
  const list = getCachedEmbeddedImages(_selPage);
  return list && list[_selIndex] ? list[_selIndex] : null;
}

// Entry point used by the ribbon button: activate + kick off detection.
export function startRemoveImageTool() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  clearEmbeddedImageCache();
  _hoverPage = -1; _hoverIndex = -1;
  _selPage = -1; _selIndex = -1;
  _drag = null;
  setTool('removeImage');
  ensureDetected(doc.currentPage, redrawNow);
  updateStatusMessage(t(
    'drawing.editImageHint',
    'Click an image to select it. Drag to move, drag a handle to resize, double-click to replace, Delete to remove.',
  ), 8000);
}

export function heeftGekozenAfbeelding() {
  return _selIndex >= 0 && state.currentTool === 'removeImage';
}

export function wisAfbeeldingSelectie() {
  _selPage = -1; _selIndex = -1; _drag = null;
  redrawNow();
}

async function bevestigVerwijderen() {
  const msg = t('drawing.removeImageConfirm',
    'Remove this image from the page? This edits the PDF content and can be undone.');
  try {
    if (window.__TAURI__?.dialog?.ask) {
      return await window.__TAURI__.dialog.ask(msg, {
        title: t('drawing.removeImage', 'Edit image'), kind: 'warning',
      });
    }
    return confirm(msg);
  } catch { return false; }
}

// Delete key: remove the selected image after confirmation.
export async function deleteSelectedEmbeddedImage() {
  if (_busy || _selIndex < 0) return;
  if (!(await bevestigVerwijderen())) return;
  _busy = true;
  try {
    const ok = await removeEmbeddedImage(_selPage, _selIndex);
    _selPage = -1; _selIndex = -1; _hoverIndex = -1;
    if (!ok) showMessage(t('drawing.removeImageFailed', 'Could not remove this image.'));
  } finally {
    _busy = false;
  }
  redrawNow();
}

// Een gekozen bestand naar PNG- of JPEG-bytes (pdf-lib kan alleen die twee insluiten).
async function leesAfbeelding(pad) {
  const bytes = await readBinaryFile(pad);
  const ext = String(pad).split('.').pop().toLowerCase();
  if (ext === 'png') return { bytes, soort: 'png' };
  if (ext === 'jpg' || ext === 'jpeg') return { bytes, soort: 'jpeg' };
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('image conversion failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), soort: 'png' };
}

// Replace the selected image by a picture the user picks.
export async function replaceSelectedEmbeddedImage() {
  if (_busy || _selIndex < 0) return;
  const pad = await openFileDialog(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
  if (!pad || typeof pad !== 'string') return;
  _busy = true;
  try {
    const { bytes, soort } = await leesAfbeelding(pad);
    const ok = await replaceEmbeddedImage(_selPage, _selIndex, bytes, soort);
    if (!ok) showMessage(t('drawing.replaceImageFailed', 'Could not replace this image.'));
  } catch (e) {
    console.error('[embedded-image] replace failed:', e);
    showMessage(t('drawing.replaceImageFailed', 'Could not replace this image.'));
  } finally {
    _busy = false;
  }
  const sel = { page: _selPage, index: _selIndex };
  await detectEmbeddedImages(sel.page).catch(() => {});
  redrawNow();
}

// Welke handvat (of 'move') ligt onder de cursor van de gekozen afbeelding?
function greepOnder(x, y) {
  const sel = gekozen();
  if (!sel) return null;
  const sc = getEffectiveScale() || 1;
  const b = sel.bbox;
  if (sel.schaalbaar) {
    for (const h of HANDVATTEN) {
      const hx = b.x + b.width * h.fx;
      const hy = b.y + b.height * h.fy;
      if (Math.abs(x - hx) <= 8 / sc && Math.abs(y - hy) <= 8 / sc) return h.naam;
    }
  }
  if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return 'move';
  return null;
}

export const removeImageTool = {
  name: 'removeImage',
  cursor: 'crosshair',

  onPointerMove(ctx, e) {
    ensureDetected(ctx.pageNum, ctx.redraw);
    if (_drag) {
      const sc = getEffectiveScale() || 1;
      const dx = ctx.x - _drag.start.x;
      const dy = ctx.y - _drag.start.y;
      if (!_drag.moved && Math.hypot(dx, dy) * sc < MIN_SLEEP_PX) return;
      _drag.moved = true;
      _drag.cur = sleepKader(_drag.orig, _drag.mode, dx, dy, { vrij: !!(e && e.shiftKey), min: 8 / sc });
      ctx.redraw();
      return;
    }
    const idx = hitTestEmbeddedImage(ctx.pageNum, ctx.x, ctx.y);
    const greep = ctx.pageNum === _selPage ? greepOnder(ctx.x, ctx.y) : null;
    if (idx !== _hoverIndex || ctx.pageNum !== _hoverPage) {
      _hoverIndex = idx;
      _hoverPage = ctx.pageNum;
      ctx.redraw();
    }
    if (ctx.canvas) {
      ctx.canvas.style.cursor = greep && greep !== 'move' ? GREEP_CURSOR[greep]
        : (greep === 'move' || idx >= 0) ? 'move' : 'crosshair';
    }
  },

  async onPointerDown(ctx, e) {
    if (_busy) return;
    // The dispatcher repeats a real double-click as a synthetic pointer-down
    // (detail 2). The second press already handled it; without this guard it
    // would start a drag that no pointer-up ever ends.
    if (e && e.detail === 2) return;
    ensureDetected(ctx.pageNum, ctx.redraw);
    const nu = Date.now();
    const greep = ctx.pageNum === _selPage ? greepOnder(ctx.x, ctx.y) : null;
    const idx = hitTestEmbeddedImage(ctx.pageNum, ctx.x, ctx.y);

    // Dubbelklik op de gekozen afbeelding: vervangen.
    if (idx >= 0 && idx === _selIndex && ctx.pageNum === _selPage
        && _lastClick.page === ctx.pageNum && _lastClick.index === idx
        && nu - _lastClick.t < DOUBLE_CLICK_MS) {
      _lastClick = { t: 0, page: -1, index: -1 };
      _drag = null;
      await replaceSelectedEmbeddedImage();
      return;
    }
    _lastClick = { t: nu, page: ctx.pageNum, index: idx };

    if (greep) {
      const sel = gekozen();
      _drag = {
        mode: greep, page: _selPage, index: _selIndex,
        start: { x: ctx.x, y: ctx.y }, orig: { ...sel.bbox }, cur: { ...sel.bbox }, moved: false,
      };
      return;
    }
    if (idx >= 0) {
      _selPage = ctx.pageNum; _selIndex = idx;
      const sel = gekozen();
      _drag = {
        mode: 'move', page: _selPage, index: _selIndex,
        start: { x: ctx.x, y: ctx.y }, orig: { ...sel.bbox }, cur: { ...sel.bbox }, moved: false,
      };
    } else {
      _selPage = -1; _selIndex = -1; _drag = null;
    }
    ctx.redraw();
  },

  async onPointerUp(ctx) {
    const d = _drag;
    _drag = null;
    if (!d) return false;
    if (!d.moved) { ctx.redraw(); return true; }
    _busy = true;
    try {
      const ok = await moveEmbeddedImage(d.page, d.index, d.cur);
      if (!ok) showMessage(t('drawing.moveImageFailed', 'Could not move this image.'));
    } finally {
      _busy = false;
    }
    // De cache is na de wijziging leeg: opnieuw detecteren, selectie blijft.
    await detectEmbeddedImages(d.page).catch(() => {});
    redrawNow();
    return true;
  },

  onDeactivate() {
    _hoverPage = -1;
    _hoverIndex = -1;
    _selPage = -1;
    _selIndex = -1;
    _drag = null;
    clearEmbeddedImageCache();
  },
};

// Draw pass — invoked from redrawAnnotations()/renderAnnotationsForPage() while
// the canvas is already in app-space. Outlines editable images on `pageNum`,
// highlights the hovered one and shows handles on the selected one.
export function drawEmbeddedImageOverlay(ctx, pageNum) {
  if (state.currentTool !== 'removeImage') return;
  const list = getCachedEmbeddedImages(pageNum);
  if (!list || list.length === 0) return;

  const sc = getEffectiveScale() || 1;
  ctx.save();
  for (let i = 0; i < list.length; i++) {
    const b = list[i].bbox;
    const gekozenNu = (pageNum === _selPage && i === _selIndex);
    const hovered = (pageNum === _hoverPage && i === _hoverIndex);
    if (gekozenNu) {
      ctx.fillStyle = 'rgba(0, 120, 215, 0.10)';
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeStyle = '#0078d7';
      ctx.lineWidth = 2 / sc;
      ctx.setLineDash([]);
    } else if (hovered) {
      ctx.fillStyle = 'rgba(0, 120, 215, 0.12)';
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeStyle = '#0078d7';
      ctx.lineWidth = 2 / sc;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(0, 120, 215, 0.9)'; // Windows accent blue
      ctx.lineWidth = 1.5 / sc;
      ctx.setLineDash([6 / sc, 4 / sc]);
    }
    ctx.strokeRect(b.x, b.y, b.width, b.height);

    if (gekozenNu) {
      if (list[i].schaalbaar) {
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0078d7';
        ctx.lineWidth = 1 / sc;
        const hs = 6 / sc;
        for (const h of HANDVATTEN) {
          const hx = b.x + b.width * h.fx - hs / 2;
          const hy = b.y + b.height * h.fy - hs / 2;
          ctx.fillRect(hx, hy, hs, hs);
          ctx.strokeRect(hx, hy, hs, hs);
        }
      }
      // Voorbeeld van de nieuwe plaats tijdens het slepen.
      if (_drag && _drag.moved && _drag.page === pageNum && _drag.index === i) {
        const c = _drag.cur;
        ctx.fillStyle = 'rgba(0, 120, 215, 0.18)';
        ctx.fillRect(c.x, c.y, c.width, c.height);
        ctx.strokeStyle = '#0078d7';
        ctx.lineWidth = 1.5 / sc;
        ctx.setLineDash([5 / sc, 3 / sc]);
        ctx.strokeRect(c.x, c.y, c.width, c.height);
      }
    }
  }
  ctx.restore();
}
