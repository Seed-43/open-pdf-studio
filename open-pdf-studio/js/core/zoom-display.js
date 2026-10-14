// The zoom shown to the user is relative to a screen resolution (dpi), a
// page-display setting: at 100% a PDF point (1/72 in) is drawn dpi/72 CSS
// pixels wide. 110 gives a comfortable reading size on a 2560x1440 screen;
// 96 is the usual browser value. Internally doc.scale / viewport.zoom stay
// in "CSS pixels per PDF point".
//
// A screen calibration (#520, schermkalibratie.js) takes precedence: on a
// calibrated screen 100% is the real paper size, so the measured CSS pixels
// per inch of that screen replace the dpi preference. The app injects that
// rule as a live source (setZoomDpiSource, see preferences.js); this module
// itself stays free of app imports so it runs in the node tests.
export const DEFAULT_ZOOM_DPI = 110;
export const MIN_ZOOM_DPI = 50;
export const MAX_ZOOM_DPI = 300;

let _dpi = DEFAULT_ZOOM_DPI;
// () => dpi behind 100% right now (calibration of this screen, else the
// preference), or null when not set: then setZoomDpi's value applies.
let _dpiSource = null;

export function normalizeZoomDpi(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_DPI;
  return Math.min(MAX_ZOOM_DPI, Math.max(MIN_ZOOM_DPI, n));
}

export function setZoomDpi(value) {
  _dpi = normalizeZoomDpi(value);
}

export function getZoomDpi() {
  return _dpi;
}

export function setZoomDpiSource(source) {
  _dpiSource = typeof source === 'function' ? source : null;
}

/** The dpi that defines 100% now: the injected source, else setZoomDpi's value. */
export function effectiveZoomDpi() {
  const dpi = _dpiSource ? Number(_dpiSource()) : NaN;
  return Number.isFinite(dpi) && dpi > 0 ? dpi : _dpi;
}

/**
 * CSS pixels per PDF point at 100%. Without an explicit dpi the effective one
 * (a calibration is used as measured, not clamped to the preference range).
 */
export function cssPxPerPtAt100(dpi) {
  return (dpi === undefined ? effectiveZoomDpi() : normalizeZoomDpi(dpi)) / 72;
}

export function scaleToPercent(scale, dpi) {
  return Math.round((scale / cssPxPerPtAt100(dpi)) * 100);
}

export function percentToScale(percent, dpi) {
  return (percent / 100) * cssPxPerPtAt100(dpi);
}

// Round zoom levels for the zoom buttons and keys, like other PDF viewers.
export const ZOOM_PERCENT_STEPS = [
  10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 6400,
];

/** Next step above (direction > 0) or below the given percentage; clamped at the ends. */
export function nextZoomPercent(percent, direction) {
  const eps = 0.5;
  if (direction > 0) {
    for (const step of ZOOM_PERCENT_STEPS) if (step > percent + eps) return step;
    return ZOOM_PERCENT_STEPS[ZOOM_PERCENT_STEPS.length - 1];
  }
  for (let i = ZOOM_PERCENT_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_PERCENT_STEPS[i] < percent - eps) return ZOOM_PERCENT_STEPS[i];
  }
  return ZOOM_PERCENT_STEPS[0];
}

/** Next round-percentage zoom as an internal scale (CSS px per PDF point). */
export function nextScaleStep(scale, direction, dpi) {
  const percent = (scale / cssPxPerPtAt100(dpi)) * 100;
  return percentToScale(nextZoomPercent(percent, direction), dpi);
}
