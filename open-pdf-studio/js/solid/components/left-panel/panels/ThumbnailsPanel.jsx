import { For, createEffect, createSignal, on } from 'solid-js';
import { pageCount, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef, activePage } from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { identityOrder, gapForDrop, moveGroupToGap } from '../../../../pdf/page-order.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { volgendeTreffer, scrollVoorItem } from '../../../../ui/panels/bladwijzer-zoeken.js';
import { labelVan } from '../../../../pdf/pagina-labels.js';
import { state } from '../../../../core/state.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');

  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  // Zoekveld, zoals bij de bladwijzers (#578): typen springt naar de eerste
  // pagina waarvan het label (de bladnaam, #580) begint met of bevat wat je
  // typt; Enter opent die pagina, nog eens Enter gaat naar de volgende treffer.
  // De miniaturen worden niet gefilterd.
  let containerRef;
  let zoekRef;
  const [gevonden, setGevonden] = createSignal(null);
  const [geenTreffer, setGeenTreffer] = createSignal(false);

  // De pagina's als "bladwijzers" voor de zoekfuncties: { id, title }.
  const paginaKnopen = () => {
    const labels = state.documents[state.activeDocumentIndex]?.pageLabels;
    return pages().map(n => ({ id: n, title: labelVan(labels, n), page: n }));
  };

  function scrollNaar(pageNum) {
    const el = containerRef?.querySelector(`.thumbnail-item[data-page="${pageNum}"]`);
    if (!el) return;
    const top = scrollVoorItem(containerRef.getBoundingClientRect(), el.getBoundingClientRect(), containerRef.scrollTop, 'center');
    if (top != null) containerRef.scrollTop = top;
  }

  function zoek(tekst, naPagina) {
    const pagina = volgendeTreffer(paginaKnopen(), tekst, naPagina);
    setGevonden(pagina);
    setGeenTreffer(String(tekst).trim() !== '' && !pagina);
    if (pagina) requestAnimationFrame(() => scrollNaar(pagina));
    return pagina;
  }

  function wisZoeken() {
    if (zoekRef) zoekRef.value = '';
    setGevonden(null);
    setGeenTreffer(false);
  }

  // Ander document of andere pagina-indeling: een oude treffer klopt niet meer.
  createEffect(on(() => state.activeDocumentIndex, wisZoeken, { defer: true }));

  function onZoekToets(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      wisZoeken();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    let pagina = gevonden();
    // De eerste Enter opent de treffer; elke volgende gaat naar de volgende.
    if (!pagina || activePage() === pagina) pagina = zoek(zoekRef.value, pagina);
    if (pagina) handleNavigate(pagina);
  }

  // Dragging a selected page takes the whole selection along (#763).
  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const order = identityOrder(pageCount());
    const selected = getSelectedPagesArray();
    const group = selected.includes(fromPage) ? selected : [fromPage];
    const gap = gapForDrop(order, toPage, dropBefore ? 'before' : 'after');
    if (gap < 0) return;
    await reorderPages(moveGroupToGap(order, group, gap));
  };

  const handleKeyDown = async (e) => {
    // Ook met Caps Lock aan (e.key is dan 'A', #577).
    if (e.ctrlKey && !e.shiftKey && (e.key || '').toLowerCase() === 'a') {
      e.preventDefault();
      selectAllPages();
    } else if (e.key === 'Escape') {
      clearPageSelection();
    } else if (e.key === 'Delete') {
      const selected = getSelectedPagesArray();
      if (selected.length > 0 && selected.length < pageCount()) {
        const rangeStr = formatPageRangeString(selected);
        const { openDialog } = await import('../../../stores/dialogStore.js');
        openDialog('delete-pages', {
          totalPages: pageCount(),
          currentPage: selected[0],
          pageRange: rangeStr
        });
      }
    }
  };

  return (
    <div class={`left-panel-content${activeTab() === 'thumbnails' ? ' active' : ''}`} id="thumbnails-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.thumbnails')}</span>
        <input
          ref={zoekRef}
          class="bookmarks-search thumbnails-search"
          classList={{ 'no-match': geenTreffer() }}
          type="text"
          spellcheck={false}
          autocomplete="off"
          disabled={!pageCount()}
          placeholder={t('leftPanel.findPage')}
          title={t('leftPanel.findPageTip')}
          aria-label={t('leftPanel.findPage')}
          onInput={() => zoek(zoekRef.value, null)}
          onKeyDown={onZoekToets}
        />
        {/* Paginalabels: de naambouwer leest de bladnamen uit de onderhoek (#580). */}
        <button
          class="thumbnails-header-btn"
          title={t('leftPanel.pageLabels')}
          disabled={!pageCount()}
          onClick={async () => {
            const { openDialog } = await import('../../../stores/dialogStore.js');
            openDialog('page-labels');
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 3.5h8l4.5 4.5-4.5 4.5h-8z"/><path d="M4 6.5h4M4 9.5h5"/></svg>
        </button>
      </div>
      <div class="thumbnails-container" id="thumbnails-container" ref={(el) => { containerRef = el; setContainerRef(el); }} tabIndex={0} onKeyDown={handleKeyDown}>
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
              found={gevonden() === pageNum}
              onNavigate={handleNavigate}
              onReorder={handleReorder}
            />
          )}
        </For>
        {/* Trailing "+" tile: append a new page (A4/A3/… chooser) to the PDF. */}
        <div
          class="thumbnail-item thumbnail-add-page"
          title={t('leftPanel.addPage') || 'Pagina toevoegen'}
          onClick={async () => {
            // Jump to the last page first so the insert dialog's "after
            // current page" default appends at the END of the document.
            const m = await import('../../../../pdf/renderer.js');
            await m.goToPage(pageCount());
            const { showInsertPageDialog } = await import('../../../../ui/chrome/dialogs.js');
            showInsertPageDialog();
          }}
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'min-height': '80px',
            border: '1px dashed var(--theme-border, #999)',
            color: 'var(--theme-text, #666)',
            'font-size': '28px',
            cursor: 'pointer',
            'user-select': 'none',
          }}
        >+</div>
      </div>
    </div>
  );
}
