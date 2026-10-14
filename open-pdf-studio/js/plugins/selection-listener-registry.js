/**
 * Selection Listener Registry
 *
 * Plugins can register a listener that fires when an annotation of a specific
 * type is selected or deselected. This is a direct selection-event channel
 * (separate from registerPropertyPanel) so plugins can mount UI outside the
 * property-panel without scraping DOM internals.
 *
 * Listener contract:
 *   listener(annotation | null)
 *
 *   - annotation = a selected annotation matching typeName
 *   - null       = the selection was cleared (deselect, close, multi-select)
 *
 * Idempotency: listeners are called on every selection change, including
 * re-selecting the same annotation (object-ref may differ across renders).
 * The plugin should compare by stable id, not by reference.
 *
 * Lifecycle: listeners are NOT auto-cleaned. Plugin-manager._cleanup() must
 * call unregisterSelectionListener for each registered (typeName, fn) pair.
 */

const listeners = new Map(); // typeName -> Set<fn>

// Luisteraars voor elke selectiewissel, los van het type (#574): het
// eigenschappenpaneel houdt zo de formulieren van extensies voor
// systeem-instances bij (selecteren, verversen, deselecteren, tabwissel).
// Intern; geen plugin-API.
const algemeen = new Set();

/** Luister naar elke selectiewissel; geeft de afmeldfunctie. */
export function onAnySelectionChange(fn) {
  if (typeof fn !== 'function') throw new TypeError('onAnySelectionChange: fn must be a function');
  algemeen.add(fn);
  return () => { algemeen.delete(fn); };
}

export function registerSelectionListener(typeName, fn) {
  if (typeof typeName !== 'string' || !typeName) {
    throw new Error('registerSelectionListener: typeName must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new Error(`registerSelectionListener: fn must be a function for type "${typeName}"`);
  }
  let set = listeners.get(typeName);
  if (!set) {
    set = new Set();
    listeners.set(typeName, set);
  }
  set.add(fn);
}

export function unregisterSelectionListener(typeName, fn) {
  const set = listeners.get(typeName);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(typeName);
}

/**
 * Fire all listeners for the matching typeName. annotation=null fires for ALL
 * registered types (deselect signal — plugins don't know which type was active).
 */
export function fireSelectionChange(annotation) {
  for (const fn of [...algemeen]) {
    try { fn(annotation ?? null); } catch (err) { console.error('[selection-listener] general listener threw', err); }
  }
  if (annotation == null) {
    for (const set of listeners.values()) {
      for (const fn of set) {
        try { fn(null); } catch (err) { console.error('[selection-listener] threw on null', err); }
      }
    }
    return;
  }
  const set = listeners.get(annotation.type);
  if (!set) return;
  for (const fn of set) {
    try { fn(annotation); } catch (err) { console.error(`[selection-listener] threw for ${annotation.type}`, err); }
  }
}
