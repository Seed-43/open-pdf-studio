/**
 * MCP-handlers voor extensies (#550): app_list_extensions,
 * app_install_extension en app_reload_extension.
 *
 * Deze module controleert de invoer en vormt het resultaat; het werk zelf doet
 * de levenscyclus (extension-lifecycle.js). Net als bij de andere app-tools
 * komt de uitkomst als JSON terug en is `ok: false` met `code` de foutmelding.
 * mcp-bridge.js verwijst met één regel per tool hierheen.
 */

const PATROON_SLEUTEL = /^[A-Za-z0-9._:-]+$/;
const BELEID = new Set(['never', 'ifNewer', 'always']);

const ongeldig = (error) => ({ ok: false, code: 'INVALID_ARGUMENT', error });
const nietOndersteund = () => ({ ok: false, code: 'NOT_SUPPORTED', error: 'extensions can only be managed in the desktop app' });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function alleenVelden(params, toegestaan) {
  for (const k of Object.keys(params)) {
    if (!toegestaan.includes(k)) return `unknown argument: ${k}`;
  }
  return null;
}

/**
 * @param {{ levenscyclus: () => Promise<object>, isTauri: () => boolean }} afh
 */
export function maakExtensieMcp({ levenscyclus, isTauri }) {
  async function veilig(fn) {
    try {
      return await fn();
    } catch (e) {
      return { ok: false, code: 'INSTALL_IO_FAILED', error: String(e?.message ?? e) };
    }
  }

  return {
    async handleListExtensions(params) {
      const p = params ?? {};
      if (!isObject(p)) return ongeldig('arguments must be an object');
      const extra = alleenVelden(p, ['includeContributions']);
      if (extra) return ongeldig(extra);
      if (p.includeContributions !== undefined && typeof p.includeContributions !== 'boolean') {
        return ongeldig('includeContributions must be a boolean');
      }
      if (!isTauri()) return nietOndersteund();
      return veilig(async () => {
        const lc = await levenscyclus();
        const { extensions, problems } = await lc.lijstVers({ includeContributions: p.includeContributions === true });
        return { ok: true, count: extensions.length, extensions, problems };
      });
    },

    async handleInstallExtension(params) {
      if (!isObject(params)) return ongeldig('arguments must be an object with path, replace and idempotencyKey');
      const extra = alleenVelden(params, ['path', 'replace', 'idempotencyKey']);
      if (extra) return ongeldig(extra);
      const { path, replace, idempotencyKey } = params;
      if (typeof path !== 'string' || !path.trim() || path.length > 4096) return ongeldig('path must be the absolute path of a local .oppx file');
      if (!BELEID.has(replace)) return ongeldig("replace must be 'never', 'ifNewer' or 'always'");
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128
          || !PATROON_SLEUTEL.test(idempotencyKey)) {
        return ongeldig('idempotencyKey must be 8-128 characters of A-Z, a-z, 0-9, ".", "_", ":" or "-"');
      }
      if (!isTauri()) return nietOndersteund();
      return veilig(async () => {
        const lc = await levenscyclus();
        return lc.installeer({ pad: path, beleid: replace, sleutel: idempotencyKey, bron: 'mcp' });
      });
    },

    async handleReloadExtension(params) {
      if (!isObject(params)) return ongeldig('arguments must be an object with id');
      const extra = alleenVelden(params, ['id']);
      if (extra) return ongeldig(extra);
      if (typeof params.id !== 'string' || !params.id || params.id.length > 128) return ongeldig('id must be an extension id from app_list_extensions');
      if (!isTauri()) return nietOndersteund();
      return veilig(async () => {
        const lc = await levenscyclus();
        return lc.herlaad(params.id, { bron: 'mcp' });
      });
    },
  };
}

// De handlers van de app, met de levenscyclus uit plugin-manager.js (lui).
let app = null;
function vanApp() {
  app ??= maakExtensieMcp({
    levenscyclus: async () => (await import('./plugin-manager.js')).levenscyclus,
    isTauri: () => Boolean(globalThis.window?.__TAURI__?.core?.invoke),
  });
  return app;
}

export const handleListExtensions = (params) => vanApp().handleListExtensions(params);
export const handleInstallExtension = (params) => vanApp().handleInstallExtension(params);
export const handleReloadExtension = (params) => vanApp().handleReloadExtension(params);
