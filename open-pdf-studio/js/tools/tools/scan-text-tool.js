// ============================================================================
// "Edit scanned text" tool.
//
// After Recognize Text (OCR) a scanned page carries an invisible text layer:
// one run per recognised word, sized and placed over the word in the picture.
// This tool makes those words editable. While it is active the recognised
// words of the page are outlined; click one and it is replaced by a borderless
// text box that
//   - sits exactly over the word and is filled with the paper colour sampled
//     around it, so the scanned picture of the old word is covered,
//   - holds the recognised text in a matching size and the sampled ink colour,
//   - opens straight into typing; afterwards it is an ordinary text box that can
//     be moved, restyled or deleted, and every step can be undone.
// The invisible OCR word underneath stays in the file (it is hidden by the box).
// ============================================================================

import { state, getActiveDocument, getPageRotation } from '../../core/state.js';
import { setTool } from '../manager.js';
import { getEffectiveScale } from '../tool-context.js';
import { showMessage } from '../../bridge.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { recordAdd } from '../../core/undo-manager.js';
import { createAnnotation } from '../../annotations/factory.js';
import { startTextEditing } from '../text-editing.js';
import { renderPageOffscreen } from '../../pdf/exporter.js';
import i18next from '../../i18n/config.js';
import {
  woordKader, ruimerKader, schatLettergrootte, bemonsterKleuren,
} from '../scan-text-geom.js';

// pageNum → [{ tekst, kader }] in app-ruimte
const _woorden = new Map();
let _hoverPage = -1;
let _hoverIndex = -1;
let _busy = false;
const SAMPLE_PX_PER_PT = 2;

function t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

function redrawNow() {
  const doc = getActiveDocument();
  const m = import('../../annotations/rendering.js');
  m.then((r) => (doc?.viewMode === 'continuous' ? r.redrawContinuous() : r.redrawAnnotations()));
}

// De herkende woorden van een pagina, met hun vak in app-ruimte.
async function laadWoorden(pageNum) {
  if (_woorden.has(pageNum)) return _woorden.get(pageNum);
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return [];
  const lijst = [];
  try {
    const page = await doc.pdfDoc.getPage(pageNum);
    const extra = getPageRotation(pageNum);
    const opts = { scale: 1 };
    if (extra) opts.rotation = (page.rotate + extra) % 360;
    const vt = page.getViewport(opts).transform;
    const inhoud = await page.getTextContent();
    for (const item of inhoud.items) {
      if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
      if (!(item.width > 0) || !(Math.abs(item.height) > 0) || !Array.isArray(item.transform)) continue;
      lijst.push({ tekst: item.str, kader: woordKader(item, vt) });
    }
  } catch (e) {
    console.warn('[scan-text] could not read the recognised words:', e);
  }
  _woorden.set(pageNum, lijst);
  return lijst;
}

function ensureLoaded(pageNum, redraw) {
  if (_woorden.has(pageNum)) return;
  laadWoorden(pageNum).then((lijst) => {
    if (state.currentTool !== 'scanText') return;
    if (lijst.length === 0) {
      showMessage(t('organize.scanTextNone',
        'No recognised text on this page. Run Recognize Text (OCR) first.'));
    }
    redraw && redraw();
  });
}

// Kleinste woordvak onder de cursor (bij overlap wint het kleinste).
function woordOnder(pageNum, x, y) {
  const lijst = _woorden.get(pageNum);
  if (!lijst) return -1;
  let beste = -1;
  let besteOppervlak = Infinity;
  lijst.forEach((w, i) => {
    const k = w.kader;
    if (x >= k.x && x <= k.x + k.width && y >= k.y && y <= k.y + k.height) {
      const o = k.width * k.height;
      if (o < besteOppervlak) { beste = i; besteOppervlak = o; }
    }
  });
  return beste;
}

// Entry point used by the ribbon button.
export function startScanTextTool() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  _woorden.clear();
  _hoverPage = -1; _hoverIndex = -1;
  setTool('scanText');
  ensureLoaded(doc.currentPage, redrawNow);
  updateStatusMessage(t(
    'organize.scanTextHint',
    'Click a recognised word to replace it. The old word in the scan is covered.',
  ), 7000);
}

async function vervangWoord(pageNum, woord) {
  const doc = getActiveDocument();
  if (!doc) return;
  _busy = true;
  try {
    // Achtergrond en inkt uit de pixels van de pagina (zonder markeringen erop).
    let kleuren = { achtergrond: '#ffffff', inkt: '#000000' };
    try {
      const canvas = await renderPageOffscreen(pageNum, SAMPLE_PX_PER_PT, { markeringen: false });
      const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const k = woord.kader;
      kleuren = bemonsterKleuren(px.data, px.width, px.height, {
        x: k.x * SAMPLE_PX_PER_PT, y: k.y * SAMPLE_PX_PER_PT,
        width: k.width * SAMPLE_PX_PER_PT, height: k.height * SAMPLE_PX_PER_PT,
      });
    } catch (e) {
      console.warn('[scan-text] colour sampling failed, using white/black:', e);
    }

    const kader = ruimerKader(woord.kader);
    const ann = createAnnotation({
      type: 'textbox',
      page: pageNum,
      x: kader.x, y: kader.y, width: kader.width, height: kader.height,
      text: woord.tekst,
      fillColor: kleuren.achtergrond,
      textColor: kleuren.inkt,
      strokeColor: 'none',
      color: '#000000',
      lineWidth: 0,
      borderStyle: 'solid',
      fontSize: schatLettergrootte(woord.kader.height),
      fontFamily: 'Arial',
      opacity: 1,
    });
    doc.annotations.push(ann);
    recordAdd(ann);
    doc.selectedAnnotations = [ann];
    setTool('select');
    redrawNow();
    startTextEditing(ann);
  } finally {
    _busy = false;
  }
}

export const scanTextTool = {
  name: 'scanText',
  cursor: 'crosshair',

  onPointerMove(ctx) {
    ensureLoaded(ctx.pageNum, ctx.redraw);
    const idx = woordOnder(ctx.pageNum, ctx.x, ctx.y);
    if (idx !== _hoverIndex || ctx.pageNum !== _hoverPage) {
      _hoverIndex = idx;
      _hoverPage = ctx.pageNum;
      if (ctx.canvas) ctx.canvas.style.cursor = idx >= 0 ? 'pointer' : 'crosshair';
      ctx.redraw();
    }
  },

  async onPointerDown(ctx) {
    if (_busy) return;
    ensureLoaded(ctx.pageNum, ctx.redraw);
    const idx = woordOnder(ctx.pageNum, ctx.x, ctx.y);
    if (idx < 0) return;
    await vervangWoord(ctx.pageNum, _woorden.get(ctx.pageNum)[idx]);
  },

  onDeactivate() {
    _woorden.clear();
    _hoverPage = -1;
    _hoverIndex = -1;
  },
};

// Draw pass — called from the annotation render loop while the canvas is in
// app-space: outlines the recognised words and highlights the hovered one.
export function drawScanTextOverlay(ctx, pageNum) {
  if (state.currentTool !== 'scanText') return;
  const lijst = _woorden.get(pageNum);
  if (!lijst || lijst.length === 0) return;
  const sc = getEffectiveScale() || 1;
  ctx.save();
  ctx.setLineDash([]);
  for (let i = 0; i < lijst.length; i++) {
    const k = lijst[i].kader;
    if (pageNum === _hoverPage && i === _hoverIndex) {
      ctx.fillStyle = 'rgba(0, 120, 215, 0.22)';
      ctx.fillRect(k.x, k.y, k.width, k.height);
      ctx.strokeStyle = '#0078d7';
      ctx.lineWidth = 1.5 / sc;
    } else {
      ctx.strokeStyle = 'rgba(0, 120, 215, 0.45)';
      ctx.lineWidth = 1 / sc;
    }
    ctx.strokeRect(k.x, k.y, k.width, k.height);
  }
  ctx.restore();
}
