import { state, getActiveDocument } from '../core/state.js';
import { showTextSelectionContextMenu } from '../ui/chrome/context-menus.js';
import { applyBandRestriction, clearBandRestriction } from './selection-guard.js';
import { weergaveRectNaarPagina } from '../pdf/weergave-ruimte.js';
import { selectionTextDir } from './leesrichting.js';

/**
 * Text Selection Module
 * Handles text selection state and operations
 */

// Spans die tijdens een actieve sleep tijdelijk op user-select:none staan
// (kolom-begrenzing tegen spurious selecties bij tabellen/meerkoloms).
let _guardRestricted = [];
// De .endOfContent-div van de tekstlaag waarin de huidige sleep begon.
let _activeEndOfContent = null;
// True from a left-button mousedown in a text layer until the next mouseup.
let _selectionDragActive = false;
// Screen point of the last left-button mousedown (text highlight drag line).
let _dragStart = null;

// Does the line (screen px) pass within `marge` px of the rectangle?
// Sampled every 2 px, which is plenty for text boxes on screen.
function lijnRaaktRect(l, r, marge) {
  const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
  const stappen = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
  for (let i = 0; i <= stappen; i++) {
    const x = l.x1 + (dx * i) / stappen, y = l.y1 + (dy * i) / stappen;
    if (x >= r.left - marge && x <= r.right + marge && y >= r.top - marge && y <= r.bottom + marge) return true;
  }
  return false;
}

/**
 * The parts of `range` that the drag line crosses, as ranges, one per run of
 * consecutive text-layer spans (so text elsewhere on the sheet is left out).
 * Returns null when the range covers a single span or nothing needs dropping,
 * so the caller can use the selection as it is; [] when no span is crossed.
 */
function gekruisteDelen(range, lijn) {
  const laag = findParentTextLayer(range.commonAncestorContainer)
    || findParentTextLayer(range.startContainer);
  if (!laag) return null;
  const spans = [...laag.querySelectorAll('span')].filter(s =>
    !s.querySelector('span') && s.textContent && range.intersectsNode(s));
  if (spans.length <= 1) return null;
  const geraakt = spans.map(s => {
    const r = s.getBoundingClientRect();
    return lijnRaaktRect(lijn, r, Math.max(4, Math.min(r.width, r.height) * 0.5));
  });
  if (geraakt.every(Boolean)) return null;
  const delen = [];
  let i = 0;
  while (i < spans.length) {
    if (!geraakt[i]) { i++; continue; }
    let j = i;
    while (j + 1 < spans.length && geraakt[j + 1]) j++;
    const deel = document.createRange();
    const eerste = spans[i], laatste = spans[j];
    if (eerste.contains(range.startContainer)) deel.setStart(range.startContainer, range.startOffset);
    else deel.setStartBefore(eerste);
    if (laatste.contains(range.endContainer)) deel.setEnd(range.endContainer, range.endOffset);
    else deel.setEndAfter(laatste);
    if (!deel.collapsed && deel.toString().trim()) delen.push(deel);
    i = j + 1;
  }
  return delen;
}

/**
 * Initializes text selection event listeners
 */
export function initTextSelection() {
  // Listen for selection changes
  document.addEventListener('selectionchange', handleSelectionChange);

  // Listen for right-click on text layers
  document.addEventListener('contextmenu', handleTextContextMenu);

  // Clear selection when clicking outside text layer
  document.addEventListener('mousedown', handleMouseDown);

  // Text highlight: double-click highlights a whole label. The second click
  // (detail 2), in the capture phase, so no other handler can swallow it.
  document.addEventListener('click', handleDoubleClick, true);

  // Einde van een sleep: hef de kolom-begrenzing en endOfContent weer op.
  // Document-breed zodat het ook vuurt als de muis buiten de tekstlaag loslaat.
  document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Handles selection change events
 */
function handleSelectionChange() {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    // No selection or selection collapsed
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Check if selection is within a text layer
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  if (!anchorNode || !focusNode) return;

  const textLayer = findParentTextLayer(anchorNode);
  if (!textLayer) {
    state.textSelection.hasSelection = false;
    state.textSelection.selectedText = '';
    state.textSelection.pageNum = null;
    return;
  }

  // Update selection state
  state.textSelection.hasSelection = true;
  state.textSelection.selectedText = selection.toString();
  state.textSelection.pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
}

/**
 * Handles right-click context menu for text selection
 */
function handleTextContextMenu(e) {
  // Check if right-click is on a text layer with selection
  const textLayer = findParentTextLayer(e.target);
  if (!textLayer) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

  // Check if the click is within the selection
  if (isClickInSelection(e, selection)) {
    e.preventDefault();
    e.stopPropagation();
    showTextSelectionContextMenu(e);
  }
}

/**
 * Handles mousedown to track selection context
 */
function handleMouseDown(e) {
  // Don't clear selection if clicking on context menu
  if (e.target.closest('.context-menu')) return;

  // Text highlight keeps only the text the drag line crosses; remember where
  // it started (the canvas may take this mousedown before the text layer).
  if (e.button === 0) _dragStart = { x: e.clientX, y: e.clientY };

  // Don't clear selection if clicking within text layer
  const textLayer = findParentTextLayer(e.target);
  if (textLayer) {
    // Alleen de linkermuisknop start een tekstselectie-sleep.
    if (e.button === 0) { _selectionDragActive = true; beginSelectionDrag(textLayer, e); }
    return;
  }

  // Check if we're clicking on an annotation canvas in select tool mode
  if (state.currentTool === 'select') {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      // Clear selection when clicking outside text layer
      selection.removeAllRanges();
    }
  }
}

/**
 * Handles mouseup: end a selection drag and lift the temporary column guard.
 */
function handleMouseUp(e) {
  const wasDragging = _selectionDragActive;
  _selectionDragActive = false;
  const lijn = _dragStart && e ? { x1: _dragStart.x, y1: _dragStart.y, x2: e.clientX, y2: e.clientY } : null;
  _dragStart = null;
  endSelectionDrag();
  // Text highlight (Select tool + state.textHighlightMode): the page text
  // selected by this drag becomes a highlight as soon as the mouse is
  // released; the mode stays on for the next one. Checked on the selection
  // itself, not only on where the drag started, because the select tool's
  // canvas can take the mousedown and pass the drag on to the text layer.
  // A double-click's own mouseup is left to handleDoubleClick, which
  // highlights the whole label instead of the word the browser picked.
  // A plain click (no drag) highlights nothing either.
  const geklikt = lijn && Math.hypot(lijn.x2 - lijn.x1, lijn.y2 - lijn.y1) < 3;
  if (state.textHighlightMode && state.currentTool === 'select' && !(e && e.detail >= 2) && !geklikt) {
    setTimeout(async () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      if (!wasDragging && !findParentTextLayer(sel.anchorNode)) return;
      // On drawings the text layer is in file order, not reading order, so a
      // native selection can pull in labels from elsewhere on the sheet.
      // Highlight only the runs of text the drag line actually crosses.
      const delen = lijn ? gekruisteDelen(sel.getRangeAt(0), lijn) : null;
      await markeerBereiken(delen ? delen : [sel.getRangeAt(0)]);
    }, 0);
  }
}

// Text highlight: double-click a label to highlight all of it (the whole
// text-layer span under the pointer, not just the word).
function handleDoubleClick(e) {
  if (e.detail !== 2 || !state.textHighlightMode || state.currentTool !== 'select' || e.button !== 0) return;
  // Found by position, not hit-testing: the markup canvas or a text layer
  // with pointer-events off can be what the double-click lands on.
  const span = spanOpPunt(e.clientX, e.clientY);
  if (!span) return;
  e.preventDefault();
  // Drawings often store a label one word per span ("ISSUED", "FOR",
  // "APPROVAL"): take in the neighbouring spans on the same line.
  const regel = regelVan(span);
  const bereik = document.createRange();
  bereik.setStartBefore(regel[0]);
  bereik.setEndAfter(regel[regel.length - 1]);
  markeerBereiken([bereik]);
}

// The spans that read as one label with `span`: neighbours in the text layer
// (file order) at the same angle, on the same line, with at most about one
// letter height between them.
function regelVan(span) {
  const laag = span.closest('.textLayer');
  if (!laag) return [span];
  // Word spans only; the blank spans between words come along in the range.
  const woorden = [...laag.querySelectorAll('span')].filter(s => !s.querySelector('span') && s.textContent.trim());
  const i = woorden.indexOf(span);
  if (i < 0) return [span];
  // Geometry in the text layer's own space (before the page's view rotation):
  // origin, reading direction from --rotate, length and letter height.
  const maat = (s) => {
    const t = ((parseFloat(s.style.getPropertyValue('--rotate')) || 0) * Math.PI) / 180;
    const m = getComputedStyle(s).transform;
    const v = m && m !== 'none' ? m.match(/-?[\d.e]+/g).map(Number) : [1, 0, 0, 1];
    return { x: s.offsetLeft, y: s.offsetTop, t, len: s.offsetWidth * Math.hypot(v[0], v[1]), h: s.offsetHeight * Math.hypot(v[2], v[3]) };
  };
  const hoort = (sa, sb) => {
    const a = maat(sa), b = maat(sb);
    if (Math.abs(a.t - b.t) > 0.01) return false;
    const h = Math.max(1, Math.min(a.h, b.h));
    if (Math.abs(a.h - b.h) > h * 0.5) return false;
    const ux = Math.cos(a.t), uy = Math.sin(a.t);
    const dx = b.x - a.x, dy = b.y - a.y;
    // Same line: little offset across the reading direction.
    if (Math.abs(-dx * uy + dy * ux) > h * 0.5) return false;
    // Close along it: at most about a letter between the two words.
    const s = dx * ux + dy * uy;
    const gat = s >= 0 ? s - a.len : -s - b.len;
    return gat >= -h * 0.5 && gat <= h * 1.2;
  };
  let a = i, b = i;
  while (a > 0 && hoort(woorden[a], woorden[a - 1])) a--;
  while (b < woorden.length - 1 && hoort(woorden[b], woorden[b + 1])) b++;
  return woorden.slice(a, b + 1);
}

// The word span at a screen point: the one whose box holds the point, the
// nearest centre winning when boxes of rotated labels overlap.
function spanOpPunt(x, y) {
  let beste = null, bd = Infinity;
  for (const s of document.querySelectorAll('.textLayer span')) {
    if (s.querySelector('span') || !s.textContent.trim()) continue;
    const r = s.getBoundingClientRect();
    if (x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2) continue;
    const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
    if (d < bd) { bd = d; beste = s; }
  }
  return beste;
}

// Turn each range into a text highlight, then leave nothing selected so the
// mode stays ready for the next one (a selected markup would also switch
// the ribbon to its Format tab after every line).
async function markeerBereiken(bereiken) {
  const sel = window.getSelection();
  if (!sel) return;
  if (!bereiken.length) { clearTextSelection(); return; }
  const { createTextMarkupAnnotation } = await import('./text-markup.js');
  for (const bereik of bereiken) {
    sel.removeAllRanges();
    sel.addRange(bereik);
    createTextMarkupAnnotation('textHighlight', '#FFFF00', 0.3);
  }
  clearTextSelection();
  const { clearSelection } = await import('../core/stores/selection-helpers.js');
  clearSelection();
  const r = await import('../annotations/rendering.js');
  if (getActiveDocument()?.viewMode === 'continuous') r.redrawContinuous(); else r.redrawAnnotations();
}

/**
 * Start van een tekstselectie-sleep binnen een tekstlaag.
 * 1) Begrenst — indien de startregel een tabelrij is — de selectie tot de
 *    kolom van het startpunt (voorkomt spurious selecties in andere kolommen).
 * 2) Activeert de endOfContent-div op de start-Y zodat een omgekeerde sleep
 *    (onder -> boven) de selectie niet naar verre tekst laat uitschieten.
 * @param {HTMLElement} textLayer
 * @param {MouseEvent} e
 */
function beginSelectionDrag(textLayer, e) {
  // Ruim een eventuele vorige (niet netjes afgesloten) sleep op.
  endSelectionDrag();

  try {
    _guardRestricted = applyBandRestriction(textLayer, e.clientX, e.clientY);
  } catch {
    _guardRestricted = [];
  }

  // endOfContent-truc (zoals PDF.js viewer): plaats het niet-selecteerbare
  // "einde" op de start-Y en activeer het, zodat de selectie-ankering bij een
  // omgekeerde sleep niet buiten de begonnen tekst springt.
  const end = textLayer.querySelector('.endOfContent');
  if (end) {
    const r = hoogteFractieInLaag(textLayer, e.clientX, e.clientY);
    end.style.top = `${(r * 100).toFixed(2)}%`;
    end.classList.add('active');
    _activeEndOfContent = end;
  }
}

/**
 * Hoe ver (0..1) ligt een schermpunt van de bovenkant van de tekstlaag, in de
 * EIGEN stand van de laag? De laag ligt in het ongedraaide paginakader en
 * wordt met een CSS-transform gedraaid en geschaald (paginarotatie en de
 * weergaverotatie, #200); op het scherm is "boven" dan niet altijd boven.
 * Terugrekenen via de inverse van die transform; zonder transform is dit
 * gewoon (clientY − top) / hoogte.
 */
function hoogteFractieInLaag(textLayer, clientX, clientY) {
  const klem = (v) => Math.max(0, Math.min(1, v));
  const hoogte = textLayer.offsetHeight;
  const ouder = textLayer.offsetParent || textLayer.parentElement;
  const transform = getComputedStyle(textLayer).transform;
  if (hoogte > 0 && ouder && transform && transform !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    try {
      const pr = ouder.getBoundingClientRect();
      const lokaal = new DOMMatrixReadOnly(transform).inverse().transformPoint(
        new DOMPoint(clientX - pr.left - textLayer.offsetLeft, clientY - pr.top - textLayer.offsetTop));
      if (Number.isFinite(lokaal.y)) return klem(lokaal.y / hoogte);
    } catch { /* terugval hieronder */ }
  }
  const rect = textLayer.getBoundingClientRect();
  return rect.height > 0 ? klem((clientY - rect.top) / rect.height) : 0;
}

/**
 * Einde van een tekstselectie-sleep: herstel user-select en endOfContent.
 */
function endSelectionDrag() {
  if (_guardRestricted.length) {
    clearBandRestriction(_guardRestricted);
    _guardRestricted = [];
  }
  if (_activeEndOfContent) {
    _activeEndOfContent.classList.remove('active');
    _activeEndOfContent.style.top = '';
    _activeEndOfContent = null;
  }
}

/**
 * Finds the parent text layer element
 * @param {Node} node - DOM node to search from
 * @returns {HTMLElement|null} The text layer element or null
 */
function findParentTextLayer(node) {
  if (!node) return null;

  // Handle text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  // Traverse up to find text layer
  while (node && node !== document.body) {
    if (node.classList && node.classList.contains('textLayer')) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

/**
 * Checks if a click event is within the current selection
 * @param {MouseEvent} e - The mouse event
 * @param {Selection} selection - The current selection
 * @returns {boolean} True if click is in selection
 */
function isClickInSelection(e, selection) {
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();

  for (const rect of rects) {
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Gets the currently selected text
 * @returns {string} The selected text
 */
export function getSelectedText() {
  return state.textSelection.selectedText || '';
}

/**
 * Gets the DOM rectangles for the current selection
 * @returns {DOMRect[]} Array of DOMRect objects
 */
export function getSelectionRects() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  return Array.from(range.getClientRects());
}

/**
 * Gets selection rectangles converted to PDF coordinates
 * @returns {Array<{x: number, y: number, width: number, height: number, page: number}>}
 */
export function getSelectionRectsForAnnotation() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const result = [];

  // Find the text layer to get page info and coordinate conversion
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return [];

  const pageNum = parseInt(textLayer.dataset.page) || (getActiveDocument()?.currentPage || 1);
  const textLayerRect = textLayer.getBoundingClientRect();

  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  for (const rect of rects) {
    // Convert DOM coordinates to PDF coordinates (relative to text layer, unscaled).
    // De tekstlaag omsluit de pagina zoals hij op het scherm staat; is de
    // weergave gedraaid (#200), dan de rechthoek terugdraaien naar de pagina.
    const inWeergave = {
      x: (rect.left - textLayerRect.left) / scale,
      y: (rect.top - textLayerRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
    const { x, y, width, height } = weergaveRectNaarPagina(pageNum, inWeergave, doc);

    result.push({ x, y, width, height, page: pageNum });
  }

  return result;
}

/**
 * Leesrichting (0/90/180/270) van de geselecteerde tekst in de paginaruimte,
 * of null als die onbekend is (#527). De rotatie is de eigen /Rotate plus de
 * paginarotatie in de app, zoals paginaMaat (weergave-ruimte.js) die telt; de
 * weergaverotatie (#200) hoort er niet bij, want annotaties staan in de
 * paginaruimte.
 * @returns {number|null}
 */
export function getSelectionTextDir() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const textLayer = findParentTextLayer(selection.anchorNode);
  if (!textLayer) return null;
  const doc = getActiveDocument();
  const pageNum = parseInt(textLayer.dataset.page) || (doc?.currentPage || 1);
  const pageRot = (Number(doc?.pageDims?.[pageNum]?.rotation) || 0) + (Number(doc?.pageRotations?.[pageNum]) || 0);
  return selectionTextDir(selection, pageRot);
}

/**
 * Clears the current text selection
 */
export function clearTextSelection() {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }

  state.textSelection.hasSelection = false;
  state.textSelection.selectedText = '';
  state.textSelection.pageNum = null;
}

/**
 * Converts selection rects to quadPoints format for text markup annotations
 * quadPoints is an array of [x1,y1,x2,y2,x3,y3,x4,y4] representing quad corners
 * @returns {Array<number[]>} Array of quad point arrays
 */
export function getSelectionQuadPoints() {
  const rects = getSelectionRectsForAnnotation();
  return rects.map(rect => {
    // QuadPoints: top-left, top-right, bottom-left, bottom-right
    return [
      rect.x, rect.y,                           // top-left
      rect.x + rect.width, rect.y,              // top-right
      rect.x, rect.y + rect.height,             // bottom-left
      rect.x + rect.width, rect.y + rect.height // bottom-right
    ];
  });
}
