import { getActiveDocument, getPageRotation } from '../core/state.js';
import { documentRevisie, beginUndoTransaction, endUndoTransaction, recordAdd, recordModify, recordDelete } from '../core/undo-manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';
import { applyAnnotationBatch } from '../plugins/annotation-batch.js';
import { isLayerLocked, layerForNewAnnotation } from '../annotations/annotatie-lagen.js';
import { countCategories } from '../solid/stores/countStore.js';
import { binaryImage, cropTemplate, matchSymbols, planSymbolCounts } from './symbol-matcher.js';

const queries = new Map();

export async function openSymbolSearch(documentId) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.id !== documentId) throw new Error('DOCUMENT_CHANGED');
  const pdf = doc.pdfDoc;
  let revision = documentRevisie(doc);
  const rotations = new Map();
  const check = () => {
    if (getActiveDocument() !== doc
      || doc.pdfDoc !== pdf
      || documentRevisie(doc) !== revision
      || [...rotations].some(([p, r]) => getPageRotation(p) !== r)) throw new Error('DOCUMENT_CHANGED');
  };
  async function geometry(pageNumber) {
    check();
    const page = await pdf.getPage(pageNumber);
    check();
    const extra = getPageRotation(pageNumber);
    rotations.set(pageNumber, extra);
    return {
      page,
      rotation: (page.rotate + extra) % 360,
      base: page.getViewport({ scale: 1, rotation: (page.rotate + extra) % 360 })
    };
  }
  async function render(pageNumber, canvas, scale, signal) {
    const g = await geometry(pageNumber);
    scale ??= Math.min(2, 1200 / Math.max(g.base.width, g.base.height));
    const viewport = g.page.getViewport({ scale, rotation: g.rotation });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = g.page.render({
      canvasContext: canvas.getContext('2d', { willReadFrequently: true }),
      viewport,
      annotationMode: 0,
      background: 'rgb(255,255,255)'
    });
    const abort = () => task.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) task.cancel();
      await task.promise;
      check();
      return { ...g, scale };
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    check,
    render,
    pageCount: pdf.numPages,
    async search({ templatePage, rect, pages, threshold = .75, rotations: angles = [0], scales = [1] }, options = {}) {
      if (!Number.isInteger(templatePage)
        || templatePage < 1
        || templatePage > pdf.numPages
        || !Array.isArray(pages)
        || !pages.length
        || pages.length > 20
        || pages.some(p => !Number.isInteger(p) || p < 1 || p > pdf.numPages)) throw new Error('INVALID_PAGES');
      check();
      let scale = 2;
      for (const p of new Set([templatePage, ...pages])) {
        const g = await geometry(p);
        scale = Math.min(scale, 1200 / Math.max(g.base.width, g.base.height));
      }
      const canvas = document.createElement('canvas');
      const matches = [];
      let truncated = false;
      try {
        await render(templatePage, canvas, scale, options.signal);
        const template = cropTemplate(binaryImage(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)), { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
        for (const [index, page] of [...new Set(pages)].entries()) {
          await render(page, canvas, scale, options.signal);
          const found = await matchSymbols(binaryImage(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)), template, {
            threshold,
            rotations: angles,
            scales,
            signal: options.signal,
            onProgress: f => options.onProgress?.({ page, fraction: (index + f) / pages.length })
          });
          check();
          truncated ||= found.truncated;
          for (const m of found.matches) {
            if (matches.length >= 1000) {
              truncated = true;
              break;
            }
            matches.push({
              id: crypto.randomUUID(),
              page,
              bounds: { x: m.x / scale, y: m.y / scale, width: m.width / scale, height: m.height / scale },
              score: m.score,
              rotation: m.rotation,
              scale: m.scale
            });
          }
        }
        const queryId = crypto.randomUUID(),
          result = {
            queryId,
            documentId,
            revision,
            matches,
            truncated,
            categories: countCategories().map(c => ({ ...c }))
          };
        queries.set(queryId, {
          result: structuredClone(result),
          check,
          doc,
          updateRevision: () => {
            revision = documentRevisie(doc);
          },
          expires: Date.now() + 20 * 60 * 1000
        });
        while (queries.size > 4) queries.delete(queries.keys().next().value);
        return result;
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  };
}

function query(queryId) {
  const q = queries.get(queryId);
  if (!q || q.expires < Date.now()) throw new Error('SEARCH_EXPIRED');
  q.check();
  return q;
}

export async function acceptSymbolMatches(queryId, ids, category) {
  const q = query(queryId);
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !q.result.matches.some(m => m.id === id))) throw new Error('INVALID_MATCHES');
  const { ensureAnnotationsForPage, isPdfAReadOnly } = await import('../pdf/loader.js');
  q.check();
  if (isPdfAReadOnly() || isLayerLocked(q.doc, { layer: layerForNewAnnotation(q.doc) })) throw new Error('READ_ONLY');
  const selected = q.result.matches.filter(m => ids.includes(m.id));
  for (const page of new Set(selected.map(m => m.page))) {
    await ensureAnnotationsForPage(page, q.doc);
    q.check();
  }
  const actualCategory = countCategories().find(c => c.id === category?.id);
  if (!actualCategory) throw new Error('CATEGORY_REQUIRED');
  const annotations = planSymbolCounts(selected, q.doc.annotations, actualCategory);
  const result = applyAnnotationBatch(q.doc, annotations.map(annotation => ({ op: 'create', annotation })), {
    createAnnotation,
    beginUndoTransaction,
    endUndoTransaction,
    recordAdd,
    recordModify,
    recordDelete,
    redraw: redrawAnnotations
  });
  q.updateRevision();
  return { ...result, skipped: selected.length - annotations.length };
}

export async function navigateSymbolMatch(queryId, id) {
  const q = query(queryId),
    m = q.result.matches.find(m => m.id === id);
  if (!m) throw new Error('INVALID_MATCHES');
  const [{ goToPage }, { scrollToAnnotation }] = await Promise.all([import('../pdf/renderer.js'), import('../ui/panels/annotations-list.js')]);
  q.check();
  await goToPage(m.page);
  q.check();
  await new Promise(r => setTimeout(r, 50));
  q.check();
  scrollToAnnotation({ type: 'box', page: m.page, ...m.bounds });
  return { page: m.page, bounds: m.bounds };
}

export async function symbolSearchRequest(request, options = {}) {
  if (request.action === 'search') {
    const session = await openSymbolSearch(request.documentId);
    return session.search(request, options);
  }
  const q = query(request.queryId);
  if (q.result.documentId !== request.documentId) throw new Error('DOCUMENT_CHANGED');
  if (request.action === 'accept') return acceptSymbolMatches(request.queryId, request.ids, request.category);
  if (request.action === 'navigate') return navigateSymbolMatch(request.queryId, request.id);
  throw new Error('INVALID_ACTION');
}
