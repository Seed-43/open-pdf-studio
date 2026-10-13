// Page labels: named pages ("S-101 - Ground Floor") instead of 1, 2, 3.
//
// Labels live on the document as `doc.pageLabels` (array, index 0 = page 1,
// null = no labels) and are written to the standard PDF /PageLabels number
// tree on save, so Acrobat and Bluebeam show the same names. The name builder
// reads a sheet-number and a sheet-title region on every page: the PDF's own
// text first (fast, exact for CAD output), OCR only where a region is empty.
import { PDFName, PDFNumber, PDFHexString } from 'pdf-lib';
import { state, getActiveDocument } from '../core/state.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { resolvePointerCoords } from '../tools/tool-context.js';

// ── Reading / setting ────────────────────────────────────────────────────

/** Read /PageLabels from the PDF into doc.pageLabels. Plain 1..N numbering
 *  is stored as null so the UI keeps showing page numbers. */
export async function loadPageLabels(doc) {
  if (!doc?.pdfDoc) return;
  let labels = null;
  try {
    labels = await doc.pdfDoc.getPageLabels();
  } catch (_) { labels = null; }
  if (labels && labels.every((l, i) => l === String(i + 1))) labels = null;
  doc.pageLabels = labels;
  doc.pageLabelsDirty = false;
}

/** Label of a page, or its number when the page has none. */
export function pageLabelFor(doc, pageNum) {
  const l = doc?.pageLabels?.[pageNum - 1];
  return l ? l : String(pageNum);
}

/** True when the page shows a name rather than its number. */
export function hasPageLabel(doc, pageNum) {
  const l = doc?.pageLabels?.[pageNum - 1];
  return !!l && l !== String(pageNum);
}

/** Replace all labels (array, '' or null = plain number). */
export function setPageLabels(doc, labels) {
  if (!doc?.pdfDoc) return;
  const n = doc.pdfDoc.numPages;
  const out = Array.from({ length: n }, (_, i) => {
    const l = labels?.[i];
    return typeof l === 'string' && l.trim() ? l.trim() : String(i + 1);
  });
  doc.pageLabels = out.every((l, i) => l === String(i + 1)) ? null : out;
  doc.pageLabelsDirty = true;
  markDocumentModified(doc);
}

/** Rename a single page. */
export function setPageLabel(doc, pageNum, label) {
  if (!doc?.pdfDoc) return;
  const n = doc.pdfDoc.numPages;
  const cur = doc.pageLabels ? [...doc.pageLabels] : Array.from({ length: n }, (_, i) => String(i + 1));
  cur[pageNum - 1] = label;
  setPageLabels(doc, cur);
}

// ── Saving ───────────────────────────────────────────────────────────────

/** Write doc.pageLabels into the pdf-lib catalog as /PageLabels. Only runs
 *  when the labels were edited, so files whose labels use roman numerals or
 *  other styles are left exactly as they were. */
export function savePageLabelsToCatalog(pdfDocLib, doc) {
  if (!doc?.pageLabelsDirty) return;
  const context = pdfDocLib.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;
  const labels = doc.pageLabels;
  if (!labels) {
    catalog.delete(PDFName.of('PageLabels'));
    return;
  }
  const nums = [];
  labels.forEach((label, i) => {
    nums.push(PDFNumber.of(i));
    if (label === String(i + 1)) {
      // Plain decimal number continuing from this page index.
      nums.push(context.obj({ S: PDFName.of('D'), St: PDFNumber.of(i + 1) }));
    } else {
      nums.push(context.obj({ P: PDFHexString.fromText(label) }));
    }
  });
  catalog.set(PDFName.of('PageLabels'), context.obj({ Nums: context.obj(nums) }));
}

// ── Region text extraction ───────────────────────────────────────────────

/** Text inside `rect` ({x, y, w, h} in page points, top-left origin). Uses
 *  the PDF text layer; returns '' when the region has no real text. */
export async function regionTextFromPdf(pdfDoc, pageNum, rect) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const hits = [];
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    // The text run need not be horizontal in PDF space: CAD sheets are often
    // stored unrotated with /Rotate 90, so their title-block text runs up the
    // page. Build the box from the run's own direction (a,b) and up (c,d)
    // vectors, then take the bounds of its four corners in view space.
    const [a, b, c, d, e, f] = item.transform;
    const runLen = Math.hypot(a, b) || 1;
    const upLen = Math.hypot(c, d) || 1;
    const h = item.height || upLen;
    const ux = (a / runLen) * item.width, uy = (b / runLen) * item.width;
    const vx = (c / upLen) * h, vy = (d / upLen) * h;
    const corners = [[e, f], [e + ux, f + uy], [e + vx, f + vy], [e + ux + vx, f + uy + vy]]
      .map(([px, py]) => viewport.convertToViewportPoint(px, py));
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (centreInside(box, rect)) hits.push({ ...box, text: item.str });
  }
  return joinLines(hits);
}

/** Text inside `rect` via OCR of the whole page (results cached on the doc). */
export async function regionTextFromOcr(doc, pageNum, rect) {
  if (!doc?.filePath || !window.__TAURI__) return '';
  doc.ocrResults = doc.ocrResults || {};
  let words = doc.ocrResults[pageNum];
  if (!words) {
    words = await window.__TAURI__.core.invoke('ocr_pdf_page', {
      path: doc.filePath, pageIndex: pageNum - 1, lang: 'auto',
    });
    doc.ocrResults[pageNum] = words;
  }
  const hits = (words || [])
    .map(w => ({ x: w.left, y: w.top, w: w.width, h: w.height, text: w.text }))
    .filter(b => b.text && centreInside(b, rect));
  return joinLines(hits);
}

function centreInside(b, r) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

// Group boxes into lines (similar top), left to right, lines top to bottom.
function joinLines(boxes) {
  if (!boxes.length) return '';
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const b of boxes) {
    const line = lines.find(l => Math.abs(l.y - b.y) < Math.max(2, Math.min(l.h, b.h) * 0.5));
    if (line) line.items.push(b);
    else lines.push({ y: b.y, h: b.h, items: [b] });
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map(l => l.items.sort((a, b) => a.x - b.x).map(i => i.text.trim()).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text in one region on one page: PDF text first, OCR when that is empty
 *  and `useOcr` is set. Returns { text, source: 'text' | 'ocr' | '' }. */
export async function readRegion(doc, pageNum, rect, useOcr = true) {
  let text = '';
  try { text = await regionTextFromPdf(doc.pdfDoc, pageNum, rect); } catch (_) {}
  if (text) return { text, source: 'text' };
  if (useOcr) {
    try { text = await regionTextFromOcr(doc, pageNum, rect); } catch (e) { console.warn('[page-labels] OCR failed', e); }
    if (text) return { text, source: 'ocr' };
  }
  return { text: '', source: '' };
}

/** Build a label from a typed template where {OCR1}, {OCR2}... stand for
 *  the text read in region 1, 2... `texts` maps region number -> text. */
export function buildLabelFromTemplate(template, texts) {
  return (template || '')
    .replace(/\{OCR(\d+)\}/gi, (_, n) => texts?.[Number(n)] || '')
    .replace(/\{page\}/gi, texts?.page != null ? String(texts.page) : '')
    .replace(/\s+/g, ' ')
    // Drop separators left dangling by an empty region ("S-101 - " -> "S-101").
    .replace(/^[\s\-–:,|_]+|[\s\-–:,|_]+$/g, '')
    .trim();
}

/** Read every region on every page. `regions` = [{ n, rect }]. Returns
 *  [{ page, texts: { [n]: text, page }, ocr: bool }]. */
export async function readRegionsOnAllPages(doc, regions, { useOcr = true, onProgress, isCancelled } = {}) {
  const total = doc.pdfDoc.numPages;
  const rows = [];
  for (let p = 1; p <= total; p++) {
    if (isCancelled?.()) break;
    const texts = { page: p };
    let ocr = false;
    for (const reg of regions) {
      const r = await readRegion(doc, p, reg.rect, useOcr);
      if (r.source === 'ocr') ocr = true;
      texts[reg.n] = r.text;
    }
    rows.push({ page: p, texts, ocr });
    onProgress?.(p, total);
  }
  return rows;
}

// ── Region picking on the canvas ─────────────────────────────────────────

/** Let the user drag a rectangle on a page. Resolves { page, rect } in page
 *  points (top-left origin), or null on Escape. A hint bar shows `hint`. */
export function pickPageRegion(hint) {
  return new Promise((resolve) => {
    const bar = document.createElement('div');
    bar.className = 'page-label-pick-bar';
    bar.textContent = hint;
    document.body.appendChild(bar);
    const box = document.createElement('div');
    box.className = 'page-label-pick-box';

    let start = null, startClient = null;
    const onCanvas = (t) => t?.closest?.('#annotation-canvas, .annotation-canvas, .canvas-container-cont');

    const finish = (result) => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('keydown', key, true);
      bar.remove(); box.remove();
      document.body.classList.remove('page-label-picking');
      resolve(result);
    };
    const down = (e) => {
      if (e.button !== 0 || !onCanvas(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      start = resolvePointerCoords(e);
      startClient = { x: e.clientX, y: e.clientY };
      document.body.appendChild(box);
      Object.assign(box.style, { left: e.clientX + 'px', top: e.clientY + 'px', width: '0px', height: '0px' });
    };
    const move = (e) => {
      if (!start) return;
      e.preventDefault(); e.stopPropagation();
      Object.assign(box.style, {
        left: Math.min(e.clientX, startClient.x) + 'px',
        top: Math.min(e.clientY, startClient.y) + 'px',
        width: Math.abs(e.clientX - startClient.x) + 'px',
        height: Math.abs(e.clientY - startClient.y) + 'px',
      });
    };
    const up = (e) => {
      if (!start) return;
      e.preventDefault(); e.stopPropagation();
      // Resolve the end point against the START page so a drag that leaves
      // the page in continuous view still measures on that page.
      const end = resolvePointerCoords(Object.assign({}, e, { target: e.target, clientX: e.clientX, clientY: e.clientY }));
      const rect = {
        x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y),
      };
      if (rect.w < 2 || rect.h < 2) { start = null; box.remove(); return; }
      finish({ page: start.pageNum, rect });
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    };
    document.body.classList.add('page-label-picking');
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('keydown', key, true);
  });
}

export function activeDocForLabels() {
  return getActiveDocument() || state.documents[state.activeDocumentIndex] || null;
}
