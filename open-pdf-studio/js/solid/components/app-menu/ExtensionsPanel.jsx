import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { levenscyclus, installPluginFromFile, reinstallPlugin } from '../../../plugins/plugin-manager.js';
import { isTauri } from '../../../core/platform.js';

// Het extensiepaneel toont alles wat de levenscyclus kent (#550): actieve,
// mislukte en niet-geladen extensies, zodat ook een kapotte extensie hier te
// verwijderen is. Een extensie die via de AI-koppeling is geïnstalleerd of
// bijgewerkt, krijgt daarvan een label.
export default function ExtensionsPanel() {
  const { t } = useTranslation('appMenu');
  const [plugins, setPlugins] = createSignal([]);
  const [installing, setInstalling] = createSignal(false);
  const [message, setMessage] = createSignal(null);

  async function refreshList() {
    if (!isTauri()) { setPlugins([]); return; }
    try {
      const { extensions } = await levenscyclus.lijstVers();
      setPlugins(extensions);
    } catch (err) {
      console.warn('[extensies] lijst ophalen mislukt', err);
    }
  }

  onMount(() => {
    refreshList();
    // Ook bijwerken als er via MCP iets verandert terwijl het paneel open is.
    const stop = levenscyclus.abonneer(() => refreshList());
    onCleanup(stop);
  });

  const foutTekst = (err) => (err?.resultaat?.code ? `${err.resultaat.code}: ${err.resultaat.error}` : String(err?.message ?? err));

  async function kiesPakket() {
    return window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'Extension Package', extensions: ['oppx'] }]
    });
  }

  async function handleInstall() {
    if (!isTauri()) return;
    setInstalling(true);
    setMessage(null);

    try {
      const result = await kiesPakket();
      if (!result) return;
      const manifest = await installPluginFromFile(result);
      setMessage({ type: 'success', text: t('extensionsPanel.installSuccess').replace('{{name}}', manifest.name || manifest.id) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.installError')}: ${foutTekst(err)}` });
    } finally {
      setInstalling(false);
      refreshList();
    }
  }

  // Herladen = opnieuw installeren uit een bestand, met terugrollen naar de
  // vorige versie als de nieuwe niet activeert.
  async function handleReload(pluginId, pluginName) {
    if (!isTauri()) return;
    setMessage(null);
    try {
      const result = await kiesPakket();
      if (!result) return;
      const manifest = await reinstallPlugin(pluginId, result);
      setMessage({ type: 'success', text: (t('extensionsPanel.reloadSuccess') || '"{{name}}" reloaded successfully').replace('{{name}}', manifest.name || pluginName) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.reloadError') || 'Failed to reload extension'}: ${foutTekst(err)}` });
    } finally {
      refreshList();
    }
  }

  async function handleUninstall(pluginId, pluginName) {
    if (!isTauri()) return;

    try {
      const confirmed = window.__TAURI__?.dialog?.ask
        ? await window.__TAURI__.dialog.ask(
            t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName),
            { title: t('extensionsPanel.title'), kind: 'warning' }
          )
        : confirm(t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName));

      if (!confirmed) return;

      // Uitzetten, opruimen en van schijf halen in één bewerking.
      const r = await levenscyclus.verwijder(pluginId, { bron: 'ui' });
      if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
      setMessage({ type: 'success', text: t('extensionsPanel.uninstallSuccess').replace('{{name}}', pluginName) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.uninstallError')}: ${foutTekst(err)}` });
    } finally {
      refreshList();
    }
  }

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">{t('extensionsPanel.title')}</h2>

      <Show when={message()}>
        <div class={`ext-message ext-message-${message().type}`}>
          {message().text}
        </div>
      </Show>

      <div class="ext-install-section">
        <button class="ext-install-btn" onClick={handleInstall} disabled={installing()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {installing() ? t('extensionsPanel.installing') : t('extensionsPanel.installFromFile')}
        </button>
        <p class="ext-install-hint">{t('extensionsPanel.installHint')}</p>
      </div>

      <div class="ext-divider" />

      <h3 class="ext-section-title">{t('extensionsPanel.installed')}</h3>

      <Show when={plugins().length === 0}>
        <p class="ext-empty">{t('extensionsPanel.noExtensions')}</p>
      </Show>

      <div class="ext-list">
        <For each={plugins()}>
          {(plugin) => (
            <div class={`ext-card${plugin.status === 'failed' ? ' ext-card-failed' : ''}`} data-extension-id={plugin.id}>
              <div class="ext-card-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                </svg>
              </div>
              <div class="ext-card-info">
                <div class="ext-card-header">
                  <h4 class="ext-card-name">{plugin.name || plugin.id}</h4>
                  <Show when={plugin.version}>
                    <span class="ext-card-version">v{plugin.version}</span>
                  </Show>
                  <Show when={plugin.installedVia === 'mcp' || plugin.source === 'mcp'}>
                    <span class="ext-card-badge">{t('extensionsPanel.viaMcp')}</span>
                  </Show>
                </div>
                <Show when={plugin.description}>
                  <p class="ext-card-desc">{plugin.description}</p>
                </Show>
                <Show when={plugin.author}>
                  <p class="ext-card-author">{t('extensionsPanel.by')} {plugin.author}</p>
                </Show>
                <Show when={!plugin.activated && plugin.error}>
                  <p class="ext-card-status">
                    {t('extensionsPanel.activationFailed').replace('{{error}}', `${plugin.error.code}: ${plugin.error.message}`)}
                  </p>
                </Show>
              </div>
              <div class="ext-card-actions">
                <Show when={plugin.installed}>
                  <button class="ext-reload-btn" onClick={() => handleReload(plugin.id, plugin.name || plugin.id)} title={t('extensionsPanel.reload') || 'Reload'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                  <button class="ext-uninstall-btn" onClick={() => handleUninstall(plugin.id, plugin.name || plugin.id)} title={t('extensionsPanel.uninstall')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
