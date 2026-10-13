import { For, onMount } from 'solid-js';
import { pageCount, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef } from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { useTranslation } from '../../../../i18n/useTranslation.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');

  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const numPages = pageCount();
    const currentOrder = Array.from({ length: numPages }, (_, i) => i + 1);
    const fromIdx = currentOrder.indexOf(fromPage);
    currentOrder.splice(fromIdx, 1);
    let toIdx = currentOrder.indexOf(toPage);
    if (!dropBefore) toIdx++;
    currentOrder.splice(toIdx, 0, fromPage);
    await reorderPages(currentOrder);
  };

  const handleKeyDown = async (e) => {
    if (e.ctrlKey && e.key === 'a') {
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
        <span class="thumbnails-header-title">
          {t('leftPanel.thumbnails')}
          {/* Name the pages from their title blocks (page label builder). */}
          <button
            class="thumbnails-header-btn"
            title={t('leftPanel.namePages', { defaultValue: 'Name pages from title block (OCR)' })}
            onClick={async () => {
              const { openDialog } = await import('../../../stores/dialogStore.js');
              openDialog('pageLabels');
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3.5h7.5L14 8l-4.5 4.5H2z"/><path d="M4.5 6.5h3M4.5 9.5h4"/></svg>
          </button>
        </span>
      </div>
      <div class="thumbnails-container" id="thumbnails-container" ref={setContainerRef} tabIndex={0} onKeyDown={handleKeyDown}>
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
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
