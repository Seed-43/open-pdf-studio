import { OPS } from 'pdfjs-dist';
import { state, getActiveDocument } from '../core/state.js';
import { pageTextSpans } from './mcp-page-text.js';
import { textItemColors } from './mcp-text-color.js';
import { embedMcpTextFont } from './mcp-text-font.js';
import {
  MAX_VERVANGINGEN, parseSpanId, vervangingVormFout, planVervanging, proefOpKopie,
} from './mcp-text-plan.js';

const failure = error => ({ ok: false, error });
const sourceCurrent = (doc, pdf, path) => state.documents.includes(doc) && doc.pdfDoc === pdf && doc.filePath === path;

export async function getPageTextForMcp({ page } = {}) {
  const doc = getActiveDocument();
  const pdf = doc?.pdfDoc, path = doc?.filePath;
  if (!pdf) return failure('no active PDF document');
  const pageNumber = page == null ? doc.currentPage : Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return failure('invalid page number');
  const sourcePage = await pdf.getPage(pageNumber);
  const text = await sourcePage.getTextContent();
  const operators = await sourcePage.getOperatorList();
  if (!sourceCurrent(doc, pdf, path) || getActiveDocument() !== doc) {
    return failure('active document changed during text extraction');
  }
  const viewport = sourcePage.getViewport({ scale: 1 });
  const colors = textItemColors(text.items, operators, OPS);
  return {
    ok: true, documentId: String(doc.id), filePath: path, page: pageNumber,
    pageWidth: viewport.width, pageHeight: viewport.height,
    spans: pageTextSpans(text.items, text.styles, viewport, String(doc.id), pageNumber, colors),
  };
}

// De proef op een kopie van de bron-PDF (mcp-text-plan.js).
async function proef(path, plannen) {
  const { getCachedPdfBytes } = await import('../pdf/loader.js');
  const sourceBytes = getCachedPdfBytes(path);
  if (!sourceBytes) return failure('source PDF bytes unavailable');
  await proefOpKopie(sourceBytes, plannen, { embedFont: embedMcpTextFont });
  return null;
}

// De goedgekeurde bewerkingen in het document zetten: één ongedaan-stap,
// het document gewijzigd, en de pagina opnieuw tekenen als die voor staat.
async function pasToe(doc, page, records) {
  const { execute, beginUndoTransaction, endUndoTransaction } = await import('../core/undo-manager.js');
  const { markDocumentModified } = await import('../ui/chrome/tabs.js');
  beginUndoTransaction();
  try {
    for (const record of records) {
      doc.textEdits.push(record);
      execute({ type: 'addTextEdit', textEdit: { ...record } });
    }
  } finally {
    endUndoTransaction();
  }
  markDocumentModified(doc);
  if (getActiveDocument() === doc && doc.currentPage === page) {
    try {
      const { renderPage } = await import('../pdf/renderer.js');
      if (getActiveDocument() === doc && doc.currentPage === page) await renderPage(page);
    }
    catch (error) { console.warn('[mcp-text] preview refresh failed:', error); }
  }
}

function verslag(plan) {
  const { span, record, textColor } = plan;
  return { spanId: span.id, editId: record.id, originalText: span.text, newText: record.newText,
    fontUsed: plan.fontUsed, fontFallback: plan.fontFallback, fontSize: record.fontSize,
    color: textColor, bbox: span.bbox,
    ...(plan.needsCover ? { rasterBackgroundOverlap: true,
      warning: 'An image overlaps this text. The vector glyphs will be removed without covering the image; text already baked into image pixels may remain visible.' } : {}) };
}

export async function replaceTextForMcp({ spanId, expectedText, newText, color } = {}) {
  const item = { spanId, expectedText, newText, color };
  const vorm = vervangingVormFout(item);
  if (vorm) return failure(vorm);
  const read = await getPageTextForMcp({ page: parseSpanId(spanId).page });
  if (!read.ok) return read;
  const doc = getActiveDocument();
  if (read.documentId !== parseSpanId(spanId).documentId) return failure('spanId belongs to a different document');
  if (!doc || String(doc.id) !== read.documentId) return failure('active document changed; call app_get_page_text again');
  const plan = planVervanging(read, item, doc.textEdits);
  if (plan.error) return failure(plan.error);
  if (plan.unchanged) return { ok: true, changed: false, spanId };
  const pdf = doc.pdfDoc, path = doc.filePath;

  const proefFout = await proef(path, [plan]);
  if (proefFout) return proefFout;
  if (plan.error) return failure(plan.error);
  if (!sourceCurrent(doc, pdf, path) || getActiveDocument() !== doc) {
    return failure('active document changed during text replacement');
  }
  await pasToe(doc, read.page, [plan.record]);
  return { ok: true, changed: true, saved: false, ...verslag(plan) };
}

/**
 * Meerdere regels van één pagina in één keer vervangen (#507), bijvoorbeeld
 * een vertaling. Alles of niets: faalt één vervanging, dan verandert er
 * niets en meldt het antwoord per regel wat er mis is. De proef op de kopie
 * gebeurt één keer voor alle regels samen, zoals de saver ze samen toepast,
 * en het geheel is één ongedaan-stap.
 */
export async function translatePageForMcp({ page, replacements } = {}) {
  if (!Array.isArray(replacements) || replacements.length === 0 || replacements.length > MAX_VERVANGINGEN) {
    return failure(`replacements must be a non-empty array of at most ${MAX_VERVANGINGEN} items`);
  }
  const results = replacements.map(item => ({ spanId: typeof item?.spanId === 'string' ? item.spanId : null }));
  replacements.forEach((item, i) => {
    const vorm = vervangingVormFout(item);
    if (vorm) results[i].error = vorm;
  });
  const geldig = replacements.map((item, i) => (results[i].error ? null : parseSpanId(item.spanId)));
  const pageNumber = page == null ? geldig.find(Boolean)?.page : Number(page);
  if (pageNumber == null) {
    return { ...failure('no valid replacement; nothing was changed'),
      results: results.map(r => ({ spanId: r.spanId, ok: false, error: r.error })) };
  }
  const read = await getPageTextForMcp({ page: pageNumber });
  if (!read.ok) return read;
  const doc = getActiveDocument();
  if (!doc || String(doc.id) !== read.documentId) return failure('active document changed; call app_get_page_text again');
  const pdf = doc.pdfDoc, path = doc.filePath;

  const plannen = [];
  const gezien = new Set();
  replacements.forEach((item, i) => {
    if (results[i].error) return;
    if (gezien.has(item.spanId)) { results[i].error = 'duplicate spanId in this request'; return; }
    gezien.add(item.spanId);
    const plan = planVervanging(read, item, doc.textEdits);
    if (plan.error) results[i].error = plan.error;
    else if (plan.unchanged) results[i].changed = false;
    else { plan.index = i; plannen.push(plan); }
  });
  if (plannen.length) {
    const proefFout = await proef(path, plannen);
    if (proefFout) return proefFout;
    for (const plan of plannen) {
      if (plan.error) results[plan.index].error = plan.error;
      else Object.assign(results[plan.index], { changed: true, ...verslag(plan) });
    }
  }
  const mislukt = results.filter(r => r.error).length;
  if (mislukt) {
    return { ...failure(`${mislukt} of ${replacements.length} replacements failed; nothing was changed`),
      page: pageNumber, results: results.map(r => (r.error ? { spanId: r.spanId, ok: false, error: r.error }
        : { spanId: r.spanId, ok: true })) };
  }
  if (plannen.length) {
    if (!sourceCurrent(doc, pdf, path) || getActiveDocument() !== doc) {
      return failure('active document changed during text replacement');
    }
    await pasToe(doc, pageNumber, plannen.map(plan => plan.record));
  }
  return { ok: true, saved: false, page: pageNumber, changed: plannen.length,
    unchanged: replacements.length - plannen.length, results: results.map(r => ({ ok: true, ...r })) };
}
