// OCR engines from extensions. An extension registers an engine
// (api.registerOcrEngine); the user picks it as the preferred OCR engine
// (preferences.ocrEngine). Every OCR job in the app then goes through it:
// the searchable text layer (ocr.js), page labels (pagina-labels-app.js) and
// form recognition. Without a preferred extension engine, or when it fails,
// the built-in Tesseract (ocr_pdf_page) runs as before.
//
// Words, in and out, are in the space of the built-in engine: top-left
// origin, PDF points at scale 1, the page with its /Rotate but without the
// rotation the user gave the page in the app.

import { state, getActiveDocument } from '../core/state.js';
import { renderPageTileForDocument } from '../plugins/page-access.js';

export const INGEBOUWD = 'builtin';

const engines = new Map(); // id -> { id, label, pluginId, languages, region, recognize }
const luisteraars = new Set();

const meld = () => { for (const f of luisteraars) { try { f(); } catch {} } };

/** Called when the list of engines changes (for settings UI). */
export function onOcrEnginesChanged(f) {
  luisteraars.add(f);
  return () => luisteraars.delete(f);
}

/**
 * Register an engine. `descriptor`: { id, label, languages?: string[],
 * region?: boolean, recognize(request) => Promise<words[]> }.
 * @returns {string} the full engine id (`<pluginId>:<id>`)
 */
export function registreerOcrEngine(pluginId, descriptor) {
  const { id, label, recognize } = descriptor || {};
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new TypeError('OCR engine id: letters, digits, . _ - (max 64)');
  if (typeof label !== 'string' || !label.trim()) throw new TypeError('OCR engine label is required');
  if (typeof recognize !== 'function') throw new TypeError('OCR engine recognize(request) is required');
  const sleutel = `${pluginId}:${id}`;
  if (engines.has(sleutel)) throw new Error(`OCR engine ${sleutel} is already registered`);
  engines.set(sleutel, {
    id: sleutel, label: label.trim().slice(0, 80), pluginId,
    languages: Array.isArray(descriptor.languages) ? descriptor.languages.filter(l => typeof l === 'string') : [],
    region: descriptor.region === true,
    recognize,
  });
  meld();
  return sleutel;
}

export function verwijderOcrEngine(sleutel) {
  const weg = engines.delete(sleutel);
  if (weg) meld();
  return weg;
}

/** [{ id, label, languages, region }], the built-in engine first. */
export function lijstOcrEngines() {
  return [
    { id: INGEBOUWD, label: 'Tesseract (built-in)', languages: ['auto', 'eng', 'chi_tra', 'chi_tra+eng'], region: false },
    ...[...engines.values()].map(({ id, label, languages, region }) => ({ id, label, languages, region })),
  ];
}

/** The engine that will run: the preferred one if it is registered. */
export function actieveOcrEngine() {
  const voorkeur = state.preferences?.ocrEngine;
  return (voorkeur && engines.get(voorkeur)) || null;
}

function geldigeWoorden(woorden) {
  if (!Array.isArray(woorden)) throw new TypeError('OCR engine returned no word list');
  return woorden
    .filter(w => w && typeof w.text === 'string' && w.text.trim()
      && [w.left, w.top, w.width, w.height].every(Number.isFinite) && w.width >= 0 && w.height >= 0)
    .map(w => ({
      text: w.text, left: w.left, top: w.top, width: w.width, height: w.height,
      confidence: Number.isFinite(w.confidence) ? Math.max(0, Math.min(100, w.confidence)) : 0,
    }));
}

/**
 * Recognize the words on one page (or in `region` on it) with the preferred
 * engine, falling back to the built-in one.
 * @param {object} doc
 * @param {number} pageNum 1-based
 * @param {{ lang?: string, region?: {x,y,width,height}, signal?: AbortSignal }} [opties]
 *   region is in built-in word space; engines that do not handle regions get
 *   the whole page.
 * @returns {Promise<Array<{text,left,top,width,height,confidence}>>}
 */
export async function herkenPagina(doc, pageNum, { lang = 'auto', region = null, signal } = {}) {
  const engine = actieveOcrEngine();
  // Extension engines render through the active document (as the plugin API
  // does); an inactive document goes to the built-in engine.
  if (engine && doc === getActiveDocument() && doc?.pdfDoc) {
    try {
      const page = await doc.pdfDoc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1 });
      const woorden = await engine.recognize({
        documentId: doc.id,
        pageNum,
        lang,
        region: engine.region ? region : null,
        page: { width: vp.width, height: vp.height },
        signal,
        // A raster tile of the page in word space (no app rotation): see
        // docs/plugin-page-analysis-api.md for the limits.
        renderTile: (rect, options = {}) => renderPageTileForDocument(doc, pageNum, rect, {
          ...options, signal: options.signal || signal, rotation: 0,
          isCurrent: candidate => getActiveDocument() === candidate,
        }),
      });
      return geldigeWoorden(woorden);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn(`[ocr] ${engine.label} failed, using the built-in engine:`, e?.message || e);
    }
  }
  if (!doc?.filePath) return [];
  const woorden = await window.__TAURI__.core.invoke('ocr_pdf_page', {
    path: doc.filePath, pageIndex: pageNum - 1, lang,
  });
  return Array.isArray(woorden) ? woorden : [];
}
