/**
 * Plugin Manager
 *
 * Dunne laag boven de levenscyclus van extensies (extension-lifecycle.js,
 * #550). Hier worden de echte afhankelijkheden ingespoten: de Tauri-aanroep,
 * het importeren van de broncode, de plug-in-API, het na-opruimen en het lint.
 * De geëxporteerde namen blijven bestaan voor main.js en het extensiepaneel.
 */

import { createPluginApi } from './plugin-api.js';
import { maakLevenscyclus } from './extension-lifecycle.js';
import { extensieOpdrachten } from './extension-commands.js';
import { lintRegister } from './ribbon-tab-registry.js';
import { activeTab, setActiveTab } from '../solid/stores/ribbonStore.js';

async function tauriInvoke(cmd, args) {
  if (!window.__TAURI__) throw JSON.stringify({ code: 'NOT_SUPPORTED', message: 'extensions need the desktop app' });
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

// Elke import is een nieuwe module-instantie: Blob-URL's worden niet gecachet.
async function importeerBron(code) {
  const blob = new Blob([code], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Na het opruimen (§4 van het ontwerp): een verdwenen gereedschap van de
// extensie wordt 'select', de annotaties worden opnieuw getekend en het
// eigenschappenpaneel zoekt zijn renderer opnieuw op.
function naOpruimen({ typen = [] } = {}) {
  (async () => {
    const [{ state, getActiveDocument }, { setTool }, { hasRegisteredTool }, { hasAnnotationType }, tekenen, paneel] = await Promise.all([
      import('../core/state.js'),
      import('../tools/manager.js'),
      import('../tools/tool-registry.js'),
      import('./annotation-type-registry.js'),
      import('../annotations/rendering.js'),
      import('../ui/panels/properties-panel.js'),
    ]);
    const huidig = state.currentTool;
    if (typen.includes(huidig) && !hasAnnotationType(huidig) && !hasRegisteredTool(huidig)) setTool('select');
    const doc = getActiveDocument();
    if (doc?.viewMode === 'continuous') tekenen.redrawContinuous();
    else tekenen.redrawAnnotations();
    if (doc?.selectedAnnotations?.length > 1) paneel.showMultiSelectionProperties();
    else if (doc?.selectedAnnotation) paneel.showProperties(doc.selectedAnnotation, { redraw: false });
  })().catch((e) => console.warn('[plugin-manager] na-opruimen mislukt', e));
}

/** De levenscyclus van de app. */
export const levenscyclus = maakLevenscyclus({
  invoke: tauriInvoke,
  importeer: importeerBron,
  maakApi: createPluginApi,
  naOpruimen,
  lint: { actief: activeTab, zet: setActiveTab, heeft: (id) => lintRegister.heeft(id) },
});

// Een extensieopdracht tijdens een wissel krijgt EXTENSION_BUSY.
extensieOpdrachten.zetWisselControle((id) => levenscyclus.isBezig(id));

const uiSleutel = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function alsFout(r) {
  const fout = new Error(r.code ? `${r.code}: ${r.error}` : String(r.error));
  fout.code = r.code;
  fout.resultaat = r;
  return fout;
}

/**
 * Load and activate a plugin module that is already in memory.
 * Module must export: { manifest: { id, name, version, ... }, activate(api), deactivate() }
 */
export async function loadPlugin(pluginModule) {
  const r = await levenscyclus.laadModule(pluginModule, pluginModule?.manifest);
  return r.ok === true;
}

/** Unload and deactivate a plugin (blijft geïnstalleerd). */
export async function unloadPlugin(pluginId) {
  const r = await levenscyclus.zetUit(pluginId, { bron: 'ui' });
  return r.ok === true;
}

/** Get list of loaded (active) plugins. */
export function getLoadedPlugins() {
  return levenscyclus.lijst().filter((e) => e.activated).map((e) => ({
    id: e.id, name: e.name, version: e.version, description: e.description, author: e.author, builtin: false,
  }));
}

/** Check if a plugin is loaded. */
export function isPluginLoaded(pluginId) {
  return Boolean(levenscyclus.actief(pluginId));
}

/**
 * Reinstall a plugin from a new .oppx file, met terugrollen naar de vorige
 * versie als de nieuwe niet activeert.
 */
export async function reinstallPlugin(pluginId, filePath) {
  const r = await levenscyclus.installeer({ pad: filePath, beleid: 'always', sleutel: uiSleutel(), bron: 'ui' });
  if (!r.ok) throw alsFout(r);
  return { id: r.id, name: r.name, version: r.version };
}

/** Install a plugin from a .oppx file path; actief zonder herstart. */
export async function installPluginFromFile(filePath) {
  const r = await levenscyclus.installeer({ pad: filePath, beleid: 'always', sleutel: uiSleutel(), bron: 'ui' });
  if (!r.ok) throw alsFout(r);
  return { id: r.id, name: r.name, version: r.version };
}

/** Get list of installed plugins from the plugins directory. */
export async function getInstalledPlugins() {
  if (!window.__TAURI__) return [];
  const { extensions } = await levenscyclus.lijstVers();
  return extensions.filter((e) => e.installed);
}

/** Load installed plugins that are not running yet. */
export async function loadInstalledPlugins() {
  if (!window.__TAURI__) return;
  await levenscyclus.laadBijStart();
}

/** Initialize all plugins: herstel na een onderbreking, dan laden. */
export async function initPlugins() {
  await loadInstalledPlugins();
}
