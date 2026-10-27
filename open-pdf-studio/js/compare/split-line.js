// Pure helpers for the compare view modes, in particular the split line
// (wipe) mode: both pages stacked, OLD left of a draggable vertical line and
// NEW right of it. Kept free of DOM and solid-js so they can be unit-tested.

export const COMPARE_MODES = Object.freeze(['overlay', 'side', 'split']);

// Unknown or empty mode values fall back to the overlay, the historic default.
export function normalizeCompareMode(mode) {
  return COMPARE_MODES.includes(mode) ? mode : 'overlay';
}

// Overlay and split line share one scroll body and one page wrapper (the NEW
// page with the highlight canvas on top); only side-by-side uses two panes.
export function isSinglePaneMode(mode) {
  return normalizeCompareMode(mode) !== 'side';
}

// Position of the split line as a fraction (0..1) of the page wrapper width.
// `left` and `width` come from the wrapper's bounding rect, which already
// includes any CSS zoom preview, so the fraction is right at any zoom.
// Returns null when the wrapper has no usable size (nothing to update).
export function splitFraction(clientX, left, width) {
  if (!(width > 0) || !Number.isFinite(clientX) || !Number.isFinite(left)) return null;
  const f = (clientX - left) / width;
  return Math.max(0, Math.min(1, f));
}

const num = (v) => (Number.isFinite(v) ? v : 0);

// CSS transform for the OLD page canvas in split mode, to be used with
// `transform-origin: 0 0`. It mirrors the canvas operations of the change
// detection exactly: translate by (dx, dy) bitmap px, then rotate about the
// centre of the NEW page (baseW x baseH bitmap px). Using the NEW page centre
// keeps the visual alignment equal to the detection even when both pages
// differ in size.
export function splitOldTransform(offset, baseW, baseH) {
  const o = offset || {};
  const dx = num(o.dx);
  const dy = num(o.dy);
  const rot = num(o.rotation);
  const move = `translate(${dx}px, ${dy}px)`;
  if (!rot) return move;
  const cx = num(baseW) / 2;
  const cy = num(baseH) / 2;
  return `${move} translate(${cx}px, ${cy}px) rotate(${rot}deg) translate(${-cx}px, ${-cy}px)`;
}

// Length that keeps its on-screen size while the page wrapper is CSS-scaled
// by the zoom preview (handle, line and labels in split mode).
export function screenPx(n, cssScale) {
  const s = cssScale > 0 && Number.isFinite(cssScale) ? cssScale : 1;
  return `${n / s}px`;
}
