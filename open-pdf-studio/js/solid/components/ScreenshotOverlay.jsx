import { Show, createEffect, onCleanup } from 'solid-js';
import { active, selectionRect, setSelectionRect, onComplete, onCancel, endScreenshot } from '../stores/screenshotStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// Area selection for Home → Screenshot (tools/screenshot.js mounts it over the
// document view). Drag a rectangle; Esc or the right mouse button cancels.
export default function ScreenshotOverlay() {
  const { t } = useTranslation('dialogs');
  let overlayRef;
  let isDragging = false;
  let startX = 0, startY = 0;

  const annuleer = () => {
    isDragging = false;
    const cancelFn = onCancel();
    endScreenshot();
    if (cancelFn) cancelFn();
  };

  const handleMouseDown = (e) => {
    if (e.button === 2) { e.preventDefault(); annuleer(); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    const rect = overlayRef.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    setSelectionRect({ left: startX, top: startY, width: 0, height: 0 });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !overlayRef) return;
    const rect = overlayRef.getBoundingClientRect();
    const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setSelectionRect({
      left: Math.min(startX, curX),
      top: Math.min(startY, curY),
      width: Math.abs(curX - startX),
      height: Math.abs(curY - startY)
    });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    const sel = selectionRect();
    if (sel && sel.width > 5 && sel.height > 5) {
      const completeFn = onComplete();
      endScreenshot();
      if (completeFn) completeFn(sel);
      return;
    }
    // A click without a drag: start again rather than capturing a dot.
    setSelectionRect(null);
  };

  // Esc anywhere cancels, also when focus stayed on the ribbon button.
  const handleKeyDown = (e) => {
    if (e.key !== 'Escape' || !active()) return;
    e.preventDefault();
    e.stopPropagation();
    annuleer();
  };

  createEffect(() => {
    if (active() && overlayRef) overlayRef.focus();
  });
  document.addEventListener('keydown', handleKeyDown, true);
  // Releasing the button outside the overlay still ends the drag.
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('mousemove', handleMouseMove);
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('mousemove', handleMouseMove);
  });

  return (
    <Show when={active()}>
      <div
        ref={overlayRef}
        class="screenshot-overlay"
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '100%',
          'z-index': '500',
          'pointer-events': 'auto',
          cursor: 'crosshair',
          'user-select': 'none'
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex="-1"
      >
        <Show when={!selectionRect()}>
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: '6px 14px',
            'font-size': '12px',
            'font-family': 'var(--ui-font)',
            'z-index': '501',
            'pointer-events': 'none',
            'white-space': 'nowrap'
          }}>
            {t('screenshot.selectHint')}
          </div>
        </Show>
        <Show when={selectionRect()}>
          {(rect) => (
            <div style={{
              position: 'absolute',
              left: rect().left + 'px',
              top: rect().top + 'px',
              width: rect().width + 'px',
              height: rect().height + 'px',
              border: '1px dashed #0078d7',
              background: 'rgba(0, 120, 215, 0.1)',
              'pointer-events': 'none'
            }} />
          )}
        </Show>
      </div>
    </Show>
  );
}
