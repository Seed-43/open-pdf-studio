import { Show, createSignal } from 'solid-js';
import {
  activePage, thumbnailData, draggedPage, setDraggedPage, dropTarget, setDropTarget, placeholderSize,
  selectedPages, selectPage, togglePageSelection, selectPageRange, isPageSelected
} from '../../stores/panels/thumbnailStore.js';
import { showThumbnailMenu } from '../../stores/contextMenuStore.js';
import { state } from '../../../core/state.js';
import { pageLabelFor, hasPageLabel, setPageLabel } from '../../../pdf/page-labels.js';

export default function ThumbnailItem(props) {
  const isActive = () => activePage() === props.pageNum;
  const imageData = () => thumbnailData[String(props.pageNum)];
  const isDragging = () => draggedPage() === props.pageNum;
  const drop = () => dropTarget();
  const isDropBefore = () => drop()?.page === props.pageNum && drop()?.position === 'before';
  const isDropAfter = () => drop()?.page === props.pageNum && drop()?.position === 'after';
  const isSelected = () => { selectedPages(); return isPageSelected(props.pageNum); };

  const size = () => placeholderSize();

  // Page label (sheet name). Reads the active document through the mutable
  // state so a rename or a name-builder run re-renders the label.
  const doc = () => state.documents[state.activeDocumentIndex];
  const label = () => { doc()?.pageLabels; return pageLabelFor(doc(), props.pageNum); };
  const named = () => { doc()?.pageLabels; return hasPageLabel(doc(), props.pageNum); };
  const [renaming, setRenaming] = createSignal(false);
  const commitRename = (value) => {
    setRenaming(false);
    const d = doc();
    if (!d) return;
    const v = (value || '').trim();
    if (v === label()) return;
    setPageLabel(d, props.pageNum, v);
  };

  const handleClick = (e) => {
    if (e.ctrlKey && e.shiftKey) {
      selectPageRange(props.pageNum, true);
    } else if (e.shiftKey) {
      selectPageRange(props.pageNum, false);
    } else if (e.ctrlKey) {
      togglePageSelection(props.pageNum);
    } else {
      selectPage(props.pageNum);
      props.onNavigate(props.pageNum);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked page is not in selection, select it alone
    if (!isPageSelected(props.pageNum)) {
      selectPage(props.pageNum);
    }
    showThumbnailMenu(e.clientX, e.clientY, props.pageNum);
  };

  return (
    <div
      class="thumbnail-item"
      classList={{
        active: isActive(),
        selected: isSelected(),
        dragging: isDragging(),
        'drop-before': isDropBefore(),
        'drop-after': isDropAfter()
      }}
      data-page={props.pageNum}
      draggable={true}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => {
        setDraggedPage(props.pageNum);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.pageNum));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedPage() === props.pageNum) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropTarget({ page: props.pageNum, position: e.clientY < midY ? 'before' : 'after' });
      }}
      onDragLeave={() => {
        if (dropTarget()?.page === props.pageNum) setDropTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(null);
        if (draggedPage() !== null && draggedPage() !== props.pageNum) {
          const rect = e.currentTarget.getBoundingClientRect();
          const dropBefore = e.clientY < (rect.top + rect.height / 2);
          props.onReorder(draggedPage(), props.pageNum, dropBefore);
        }
        setDraggedPage(null);
      }}
      onDragEnd={() => {
        setDraggedPage(null);
        setDropTarget(null);
      }}
    >
      <Show when={imageData()} fallback={
        <div class="thumbnail-canvas thumbnail-loading" style={{ 'aspect-ratio': `${size().width} / ${size().height}` }}>
          <div class="thumbnail-spinner" />
        </div>
      }>
        <img class="thumbnail-canvas" src={imageData().dataURL} />
      </Show>
      <Show when={renaming()} fallback={
        <div
          class="thumbnail-label"
          classList={{ named: named() }}
          title={named() ? `${props.pageNum}: ${label()}` : String(props.pageNum)}
          onDblClick={(e) => { e.stopPropagation(); setRenaming(true); }}
        >
          <span class="thumbnail-label-text">{label()}</span>
        </div>
      }>
        <input
          class="thumbnail-label-input"
          value={named() ? label() : ''}
          placeholder={String(props.pageNum)}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename(e.currentTarget.value);
            else if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={(e) => { if (renaming()) commitRename(e.currentTarget.value); }}
        />
      </Show>
    </div>
  );
}
