// The active folder watch, for the status bar. Kept outside any dialog so
// the indicator (and its stop button) stays visible after the dialog closes.
let current = null;
const listeners = new Set();

export function watchState() {
  return current;
}

export function setWatchState(value) {
  current = value ? { input: value.input, output: value.output, error: value.error ?? null } : null;
  for (const listener of listeners) {
    try { listener(current); } catch { /* one listener must not stop the others */ }
  }
}

export function onWatchState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
