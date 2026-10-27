import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { startCompare } from '../../../compare/compare-store.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function CompareDialog() {
  const { t } = useTranslation('ribbon');
  const { t: tCommon } = useTranslation('common');

  const docs = () => (state.documents || []).filter(d => d && d.filePath);

  const [oldIdx, setOldIdx] = createSignal(0);
  const [newIdx, setNewIdx] = createSignal(Math.min(1, Math.max(0, docs().length - 1)));
  const [mode, setMode] = createSignal('side');
  const [oldPage, setOldPage] = createSignal(1);
  const [newPage, setNewPage] = createSignal(1);

  const close = () => closeDialog('compare');

  const handleOk = () => {
    const list = docs();
    const oldDoc = list[oldIdx()];
    const newDoc = list[newIdx()];
    if (!oldDoc || !newDoc) {
      close();
      return;
    }
    startCompare({
      oldFilePath: oldDoc.filePath,
      newFilePath: newDoc.filePath,
      mode: mode(),
      oldPage: oldPage(),
      newPage: newPage(),
    });
    close();
  };

  const canStart = () => {
    const list = docs();
    return list.length >= 2 && oldIdx() !== newIdx();
  };

  // Get max pages for selected doc, fallback to 1
  const oldMaxPages = () => {
    const d = docs()[oldIdx()];
    return d?.pdfDoc?.numPages || 1;
  };
  const newMaxPages = () => {
    const d = docs()[newIdx()];
    return d?.pdfDoc?.numPages || 1;
  };

  const footer = (
    <div class="cmp-dialog-footer">
      <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel') || 'Annuleren'}</button>
      <button class="pref-btn pref-btn-primary" disabled={!canStart()} onClick={handleOk}>
        {t('compare.start') || 'Start vergelijken'}
      </button>
    </div>
  );

  const docName = (d) => {
    if (!d) return '';
    return d.fileName || (d.filePath || '').split(/[\\/]/).pop() || d.filePath;
  };

  return (
    <Dialog
      title={t('compare.title') || "PDF's vergelijken"}
      onClose={close}
      footer={footer}
    >
      <Show
        when={docs().length >= 2}
        fallback={
          <div class="cmp-dialog-empty">
            <div class="cmp-dialog-empty-icon">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#888" stroke-width="1.5">
                <rect x="3" y="3" width="8" height="18"/>
                <rect x="13" y="3" width="8" height="18"/>
                <path d="M11 12h2"/>
              </svg>
            </div>
            <div class="cmp-dialog-empty-msg">
              {t('compare.needTwoDocs') || 'Open minstens twee PDF-bestanden in tabs om te vergelijken.'}
            </div>
          </div>
        }
      >
        <div class="cmp-dialog">

          {/* Document selectors — side by side */}
          <div class="cmp-doc-row">
            <div class="cmp-doc-col">
              <div class="cmp-doc-label cmp-old">
                <span class="cmp-color-dot" style="background:#dc2626"></span>
                {t('compare.oldDoc') || 'Oud'}
              </div>
              <select
                class="cmp-doc-select"
                value={oldIdx()}
                onChange={(e) => setOldIdx(parseInt(e.target.value))}
              >
                <For each={docs()}>
                  {(d, i) => <option value={i()}>{docName(d)}</option>}
                </For>
              </select>
              <div class="cmp-page-row">
                <span class="cmp-page-label">{t('compare.page') || 'Pagina'}</span>
                <input
                  type="text" inputmode="decimal" data-getal
                  min="1"
                  max={oldMaxPages()}
                  class="cmp-page-input"
                  value={oldPage()}
                  onInput={(e) => setOldPage(Math.max(1, Math.min(oldMaxPages(), parseInt(e.target.value) || 1)))}
                />
                <span class="cmp-page-of">/ {oldMaxPages()}</span>
              </div>
            </div>

            <button
              type="button"
              class="cmp-vs cmp-swap-btn"
              title={t('compare.swap') || 'Wissel oud en nieuw'}
              onClick={() => {
                const a = oldIdx(), b = newIdx();
                const ap = oldPage(), bp = newPage();
                setOldIdx(b); setNewIdx(a);
                setOldPage(bp); setNewPage(ap);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 7h12M19 7l-3-3M19 7l-3 3"/>
                <path d="M17 17H5M5 17l3-3M5 17l3 3"/>
              </svg>
            </button>

            <div class="cmp-doc-col">
              <div class="cmp-doc-label cmp-new">
                <span class="cmp-color-dot" style="background:#16a34a"></span>
                {t('compare.newDoc') || 'Nieuw'}
              </div>
              <select
                class="cmp-doc-select"
                value={newIdx()}
                onChange={(e) => setNewIdx(parseInt(e.target.value))}
              >
                <For each={docs()}>
                  {(d, i) => <option value={i()}>{docName(d)}</option>}
                </For>
              </select>
              <div class="cmp-page-row">
                <span class="cmp-page-label">{t('compare.page') || 'Pagina'}</span>
                <input
                  type="text" inputmode="decimal" data-getal
                  min="1"
                  max={newMaxPages()}
                  class="cmp-page-input"
                  value={newPage()}
                  onInput={(e) => setNewPage(Math.max(1, Math.min(newMaxPages(), parseInt(e.target.value) || 1)))}
                />
                <span class="cmp-page-of">/ {newMaxPages()}</span>
              </div>
            </div>
          </div>

          {/* Mode selector — large radio cards */}
          <div class="cmp-mode-row">
            <label class={`cmp-mode-card ${mode() === 'overlay' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="overlay"
                checked={mode() === 'overlay'}
                onChange={() => setMode('overlay')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke-width="2">
                  <rect x="4" y="4" width="20" height="22" stroke="#dc2626"/>
                  <rect x="8" y="6" width="20" height="22" stroke="#16a34a"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.overlay') || 'Overlay'}</div>
              <div class="cmp-mode-desc">{t('compare.overlayDesc') || 'Beide PDFs over elkaar heen'}</div>
            </label>

            <label class={`cmp-mode-card ${mode() === 'side' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="side"
                checked={mode() === 'side'}
                onChange={() => setMode('side')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#555" stroke-width="2">
                  <rect x="3" y="6" width="12" height="20"/>
                  <rect x="17" y="6" width="12" height="20"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.sideBySide') || 'Naast elkaar'}</div>
              <div class="cmp-mode-desc">{t('compare.sideDesc') || "Twee PDFs naast elkaar, gesynchroniseerd"}</div>
            </label>

            <label class={`cmp-mode-card ${mode() === 'split' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="split"
                checked={mode() === 'split'}
                onChange={() => setMode('split')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke-width="2">
                  <rect x="4" y="5" width="24" height="22" stroke="#555"/>
                  <line x1="16" y1="2" x2="16" y2="30" stroke="#0078d4"/>
                  <circle cx="16" cy="16" r="3.5" fill="#0078d4" stroke="#0078d4"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.split') || 'Scheidingslijn'}</div>
              <div class="cmp-mode-desc">{t('compare.splitDesc') || 'Sleep een lijn om oud en nieuw te tonen'}</div>
            </label>
          </div>

          {/* Legend */}
          <Show when={mode() === 'overlay'}>
            <div class="cmp-legend">
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#dc2626"></span>{t('compare.legendOld') || 'Alleen in oud'}</span>
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#16a34a"></span>{t('compare.legendNew') || 'Alleen in nieuw'}</span>
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#222"></span>{t('compare.legendBoth') || 'Ongewijzigd'}</span>
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
  );
}
