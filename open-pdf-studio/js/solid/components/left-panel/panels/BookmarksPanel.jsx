import { For, Show, createSignal, createMemo, createEffect, on } from 'solid-js';
import { activeTab, collapsed } from '../../../stores/leftPanelStore.js';
import { tree, countText, emptyMessage, selectedId, toolbarDisabled } from '../../../stores/panels/bookmarksStore.js';
import { activePage } from '../../../stores/panels/thumbnailStore.js';
import { showBookmarkMenu } from '../../../stores/contextMenuStore.js';
import { getActiveDocument } from '../../../../core/state.js';
import { huidigeBladwijzer, volgendeTreffer, scrollVoorItem } from '../../../../ui/panels/bladwijzer-zoeken.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

// Treffer van het zoekveld (#578): krijgt een streep links en wordt in beeld
// geschoven. De lijst zelf wordt niet gefilterd.
const [gevondenId, setGevondenId] = createSignal(null);

function BookmarkNode(props) {
  const indent = () => props.depth * 16;

  return (
    <div>
      <div
        class={`bookmark-item${selectedId() === props.node.id ? ' selected' : ''}${props.huidig() === props.node.id ? ' current' : ''}${gevondenId() === props.node.id ? ' found' : ''}`}
        data-bm-id={props.node.id}
        style={{ 'padding-left': `${indent()}px` }}
        onClick={() => {
          import('../../../../ui/panels/bookmarks.js').then(m => m.selectBookmark(props.node.id));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          import('../../../../ui/panels/bookmarks.js').then(m => {
            m.selectBookmark(props.node.id);
          });
          showBookmarkMenu(e.clientX, e.clientY);
        }}
      >
        <span
          class={`bookmark-arrow${props.node.hasChildren ? ' has-children' : ' empty'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (props.node.hasChildren) {
              import('../../../../ui/panels/bookmarks.js').then(m => m.toggleBookmarkExpand(props.node.id));
            }
          }}
        >
          {props.node.hasChildren ? (props.node.expanded ? '\u25BC' : '\u25B6') : ''}
        </span>
        <span class="bookmark-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
        </span>
        <span
          class={`bookmark-title${props.node.bold ? ' bold' : ''}${props.node.italic ? ' italic' : ''}`}
          style={props.node.color ? { color: props.node.color } : {}}
        >
          {props.node.title}
        </span>
      </div>
      <Show when={props.node.hasChildren && props.node.expanded}>
        <div class="bookmark-children">
          <For each={props.node.children}>
            {(child) => <BookmarkNode node={child} depth={props.depth + 1} huidig={props.huidig} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function BookmarksPanel() {
  const { t } = useTranslation('properties');
  const disabled = () => toolbarDisabled();
  let lijstRef;
  let zoekRef;
  const [geenTreffer, setGeenTreffer] = createSignal(false);

  // De bladwijzer van de pagina in beeld: zachte achtergrond, hoe er ook
  // genavigeerd wordt (zelfde activePage als de actieve miniatuur).
  const huidig = createMemo(() => huidigeBladwijzer(tree(), activePage()));
  const paneelOpen = () => activeTab() === 'bookmarks' && !collapsed();

  // Schuif een bladwijzer in beeld binnen de lijst (niet de panelen eromheen).
  function scrollNaar(id, modus) {
    if (!id || !lijstRef) return;
    const el = lijstRef.querySelector(`[data-bm-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const top = scrollVoorItem(lijstRef.getBoundingClientRect(), el.getBoundingClientRect(), lijstRef.scrollTop, modus);
    if (top != null) lijstRef.scrollTop = top;
  }

  // Volgt de pagina: staat de huidige bladwijzer buiten beeld, dan schuift
  // hij erin. Een frame later, zodat een net ververste boom er al staat.
  createEffect(on([huidig, paneelOpen], ([id, open]) => {
    if (id && open) requestAnimationFrame(() => scrollNaar(id, 'nearest'));
  }));

  function wisZoeken() {
    if (zoekRef) zoekRef.value = '';
    setGevondenId(null);
    setGeenTreffer(false);
  }

  // Ander document in beeld: de ids beginnen per document opnieuw (bm_1 ...),
  // dus een oude treffer zou een willekeurige bladwijzer markeren.
  let laatsteDocId;
  createEffect(on(tree, () => {
    const docId = getActiveDocument()?.id ?? null;
    if (docId === laatsteDocId) return;
    laatsteDocId = docId;
    wisZoeken();
    if (paneelOpen()) requestAnimationFrame(() => scrollNaar(huidig(), 'nearest'));
  }));

  function zoek(tekst, naId) {
    const id = volgendeTreffer(tree(), tekst, naId);
    setGevondenId(id);
    setGeenTreffer(String(tekst).trim() !== '' && !id);
    return id;
  }

  // Klap de ouders van de treffer open en zet hem midden in de lijst.
  async function toon(id) {
    if (!id) return;
    const m = await import('../../../../ui/panels/bookmarks.js');
    m.revealBookmark(id);
    requestAnimationFrame(() => scrollNaar(id, 'center'));
  }

  function onZoekInvoer() {
    toon(zoek(zoekRef.value, null));
  }

  async function onZoekToets(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      wisZoeken();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    let id = gevondenId();
    // De eerste Enter opent de treffer; elke volgende gaat naar de volgende.
    if (!id || selectedId() === id) {
      id = zoek(zoekRef.value, id);
      if (!id) return;
      await toon(id);
    }
    const m = await import('../../../../ui/panels/bookmarks.js');
    m.selectBookmark(id);
    zoekRef?.focus();
  }

  return (
    <div class={`left-panel-content${activeTab() === 'bookmarks' ? ' active' : ''}`} id="bookmarks-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.bookmarks')}</span>
        <input
          ref={zoekRef}
          class="bookmarks-search"
          classList={{ 'no-match': geenTreffer() }}
          type="text"
          spellcheck={false}
          autocomplete="off"
          disabled={!!emptyMessage()}
          placeholder={t('leftPanel.findBookmark')}
          title={t('leftPanel.findBookmarkTip')}
          aria-label={t('leftPanel.findBookmark')}
          onInput={onZoekInvoer}
          onKeyDown={onZoekToets}
        />
      </div>
      <div class="bookmarks-toolbar">
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.addBookmark')}
          disabled={disabled().add}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.addChildBookmark')}
          disabled={disabled().addChild}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.addChildBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="14" y1="7" x2="14" y2="17"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="5" y1="5" x2="5" y2="19"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.editBookmark')}
          disabled={disabled().edit}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.editBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button
          class="bookmarks-toolbar-btn"
          title={t('leftPanel.deleteBookmark')}
          disabled={disabled().delete}
          onClick={() => import('../../../../ui/panels/bookmarks.js').then(m => m.deleteBookmark())}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div
        class="bookmarks-container"
        ref={lijstRef}
        onContextMenu={(e) => {
          e.preventDefault();
          showBookmarkMenu(e.clientX, e.clientY);
        }}
      >
        <Show when={emptyMessage()}>
          <div class="bookmarks-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={tree()}>
            {(node) => <BookmarkNode node={node} depth={0} huidig={huidig} />}
          </For>
        </Show>
      </div>
      <div class="bookmarks-count">{countText()}</div>
    </div>
  );
}
