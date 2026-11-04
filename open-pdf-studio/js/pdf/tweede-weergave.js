// The same document in a second tab, read-only (#919): for going through a
// drawing set, a plan in one tab and the section it calls out in another,
// without losing your place in either. Only the original tab edits and saves;
// the second tab is a view (page, zoom and scroll of its own) and reads as
// read-only everywhere (wachtwoord-pdf.js isAlleenLezen).

import { state, createDocument } from '../core/state.js';

/** Can the tab at `index` be opened again as a read-only second tab? */
export function kanTweedeWeergave(doc) {
  return !!doc?.pdfDoc && !!doc.filePath && !doc.isUntitled && !doc.tweedeWeergave;
}

/**
 * Open the document of tab `index` once more, read-only, in a new tab right
 * after it, on the same page.
 * @returns {Promise<object|null>} the new document, or null
 */
export async function openTweedeWeergave(index) {
  const bron = state.documents[index];
  if (!kanTweedeWeergave(bron)) return null;
  const { switchToTab, updateTabBar } = await import('../ui/chrome/tabs.js');
  const { loadPDF, getCachedPdfBytes } = await import('./loader.js');

  const nieuw = createDocument(bron.filePath);
  nieuw.fileName = bron.fileName;
  nieuw.tweedeWeergave = true;
  nieuw.viewMode = bron.viewMode;
  nieuw.currentPage = bron.currentPage || 1;
  nieuw.scale = bron.scale;
  nieuw.viewRotation = bron.viewRotation || 0;
  const nieuwIndex = index + 1;
  state.documents.splice(nieuwIndex, 0, nieuw);
  if (state.activeDocumentIndex >= nieuwIndex) state.activeDocumentIndex++;
  // The store hands out its own wrapper: look the document up through it.
  const doc = state.documents[nieuwIndex];
  updateTabBar();

  // Load first, from the bytes the first tab works on (page edits included),
  // so switching never reads older bytes from disk into the shared cache.
  const bytes = getCachedPdfBytes(bron.filePath);
  const pagina = doc.currentPage;
  await loadPDF(bron.filePath, state.documents.indexOf(doc), bytes ? bytes.slice() : null);
  if (!state.documents.includes(doc)) return null;
  await switchToTab(state.documents.indexOf(doc));
  if (pagina > 1 && state.documents.includes(doc)) {
    try {
      const { goToPage } = await import('./renderer.js');
      if (state.documents[state.activeDocumentIndex] === doc) await goToPage(pagina);
    } catch (e) {
      console.warn('[tweede-weergave] page not restored:', e?.message || e);
    }
  }
  return doc;
}
