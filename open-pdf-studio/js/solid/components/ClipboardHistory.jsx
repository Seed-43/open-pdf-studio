// Clipboard history UI (store: annotations/clipboard-history.js): the grid
// of this session's copies, used in the Toolpalette section and in the
// window the tool palette's Clipboard button opens. Click a copy, then
// Ctrl+V on the sheet pastes it at the mouse.
import { Show, For, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  clipboardHistory, clipboardHistoryActive, useClipboardHistoryItem,
  removeClipboardHistoryItem, clearClipboardHistory,
} from '../../annotations/clipboard-history.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export const clipboardIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="2.5" width="10" height="12" rx="1"/><path d="M6 2.5h4v2H6z"/><path d="M5.5 8h5M5.5 10.5h5"/></svg>`;
const closeSvg = `<svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/></svg>`;

export function ClipboardGrid(props) {
  const { t } = useTranslation('ribbon');
  return (
    <Show when={clipboardHistory().length > 0} fallback={<div class="sp-empty sp-clip-empty">{t('clipboardPalette.empty')}</div>}>
      <div class="sp-clip-grid">
        <For each={clipboardHistory()}>
          {(item) => (
            <div
              class={`sp-clip-item${clipboardHistoryActive() === item.id ? ' active' : ''}`}
              title={`${item.label}\n${t('clipboardPalette.tip')}`}
              onClick={() => { useClipboardHistoryItem(item.id); props?.onPick?.(item); }}
            >
              <Show when={item.thumb} fallback={<div class="sp-clip-thumb sp-clip-nothumb">{item.label}</div>}>
                <img class="sp-clip-thumb" src={item.thumb} alt="" draggable={false} />
              </Show>
              <span class="sp-clip-label">{item.label}</span>
              <button class="sp-clip-remove" title={t('clipboardPalette.remove')}
                onClick={(e) => { e.stopPropagation(); removeClipboardHistoryItem(item.id); }} innerHTML={closeSvg} />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

// ── Window next to the tool palette ──────────────────────────────────────
// Picking a copy closes it, ready for Ctrl+V; also closed with its × or the button.
const [venster, setVenster] = createSignal(null); // { left, top } or null
export const clipboardWindowOpen = () => !!venster();

const BREEDTE = 250;
export function toggleClipboardWindow(knop) {
  if (venster()) { setVenster(null); return; }
  const r = knop?.getBoundingClientRect?.();
  if (!r) { setVenster({ left: 80, top: 120 }); return; }
  const rechts = r.left < window.innerWidth / 2;
  const left = rechts ? r.right + 6 : r.left - 6 - BREEDTE;
  const top = Math.max(8, Math.min(r.top - 40, window.innerHeight - 380));
  setVenster({ left: Math.max(4, left), top });
}

export function ClipboardWindow() {
  const { t } = useTranslation('ribbon');
  onMount(() => {
    const esc = (e) => { if (e.key === 'Escape' && venster() && e.target?.closest?.('.clip-window')) setVenster(null); };
    document.addEventListener('keydown', esc);
    onCleanup(() => document.removeEventListener('keydown', esc));
  });
  return (
    <Show when={venster()}>
      {(pos) => (
        <Portal>
          <div class="clip-window" style={{ left: `${pos().left}px`, top: `${pos().top}px`, width: `${BREEDTE}px` }}>
            <div class="clip-window-header" title={t('clipboardPalette.tip')}>
              <span class="sp-cat-icon" innerHTML={clipboardIcon} />
              <span class="clip-window-title">{t('clipboardPalette.title')}</span>
              <span class="sp-cat-count">{clipboardHistory().length}</span>
              <Show when={clipboardHistory().length > 0}>
                <button class="clip-window-btn" title={t('clipboardPalette.clear')} onClick={clearClipboardHistory}>
                  {t('clipboardPalette.clearShort')}
                </button>
              </Show>
              <button class="clip-window-btn" title={t('view.closePalette')} onClick={() => setVenster(null)} innerHTML={closeSvg} />
            </div>
            <div class="clip-window-hint">{t('clipboardPalette.tip')}</div>
            <ClipboardGrid onPick={() => setVenster(null)} />
          </div>
        </Portal>
      )}
    </Show>
  );
}
