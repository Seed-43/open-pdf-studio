import { createSignal, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { levenscyclus, installPluginFromFile, reinstallPlugin } from '../../../plugins/plugin-manager.js';
import { isTauri } from '../../../core/platform.js';
import {
  catalogi, STANDAARD_CATALOGUS, laadCatalogi, installeerItem, installeerVanLink, bronnen,
  nieuwsteVersie, vergelijkVersies, voegCatalogusToe, verwijderCatalogus,
} from '../../../plugins/extension-catalog.js';

// Repository with the shared catalogue and how to add an extension to it.
const CATALOGUS_REPO = 'https://github.com/Seed-43/PDF43';

// Het extensiepaneel toont alles wat de levenscyclus kent (#550): actieve,
// mislukte en niet-geladen extensies, zodat ook een kapotte extensie hier te
// verwijderen is. Een extensie die via de AI-koppeling is geïnstalleerd of
// bijgewerkt, krijgt daarvan een label. Daarnaast, zoals pyRevit: bladeren
// in een gedeelde catalogus (extension-catalog.js) en installeren via een
// eigen link.
export default function ExtensionsPanel() {
  const { t } = useTranslation('appMenu');
  const [tab, setTab] = createSignal('installed');
  const [plugins, setPlugins] = createSignal([]);
  const [installing, setInstalling] = createSignal(null); // id or 'file' / 'link'
  const [message, setMessage] = createSignal(null);
  const [catalogus, setCatalogus] = createSignal(null);   // { items, problemen } | null
  const [laden, setLaden] = createSignal(false);
  const [zoek, setZoek] = createSignal('');
  const [link, setLink] = createSignal('');
  const [nieuweCatalogus, setNieuweCatalogus] = createSignal('');
  const [updates, setUpdates] = createSignal({});         // id -> latest version
  const [catalogusLijst, setCatalogusLijst] = createSignal(catalogi());
  const [catalogusItems, setCatalogusItems] = createSignal([]); // for updates

  async function refreshList() {
    if (!isTauri()) { setPlugins([]); return; }
    try {
      const { extensions } = await levenscyclus.lijstVers();
      setPlugins(extensions);
    } catch (err) {
      console.warn('[extensies] lijst ophalen mislukt', err);
    }
  }

  async function zoekUpdates() {
    const uit = {};
    // The catalogue knows the versions of package entries; load it quietly.
    let items = catalogus()?.items;
    if (!items) { try { items = (await laadCatalogi()).items; } catch { items = []; } }
    setCatalogusItems(items);
    for (const p of plugins()) {
      if (!bronnen()[p.id] && !items.some(i => i.id === p.id)) continue;
      const v = await nieuwsteVersie(p.id, items);
      if (v && p.version && vergelijkVersies(v, p.version) > 0) uit[p.id] = v;
    }
    setUpdates(uit);
  }

  onMount(async () => {
    await refreshList();
    zoekUpdates();
    // Ook bijwerken als er via MCP iets verandert terwijl het paneel open is.
    const stop = levenscyclus.abonneer(() => refreshList());
    onCleanup(stop);
  });

  const foutTekst = (err) => (err?.resultaat?.code ? `${err.resultaat.code}: ${err.resultaat.error}` : String(err?.message ?? err));
  const gelukt = (manifest) => setMessage({ type: 'success', text: t('extensionsPanel.installSuccess').replace('{{name}}', manifest.name || manifest.id) });
  const mislukt = (err) => setMessage({ type: 'error', text: `${t('extensionsPanel.installError')}: ${foutTekst(err)}` });

  async function bezig(sleutel, werk) {
    if (!isTauri() || installing()) return;
    setInstalling(sleutel);
    setMessage(null);
    try {
      const manifest = await werk();
      if (manifest) gelukt(manifest);
    } catch (err) {
      mislukt(err);
    } finally {
      setInstalling(null);
      await refreshList();
      zoekUpdates();
    }
  }

  async function kiesPakket() {
    return window.__TAURI__.dialog.open({
      multiple: false,
      filters: [{ name: 'Extension Package', extensions: ['oppx'] }]
    });
  }

  const handleInstall = () => bezig('file', async () => {
    const result = await kiesPakket();
    return result ? installPluginFromFile(result) : null;
  });

  const handleLink = () => bezig('link', () => installeerVanLink(link()).then((m) => { setLink(''); return m; }));

  const handleCatalogusItem = (item) => bezig(item.id, () => installeerItem(item));

  // Update from the link it was installed from, or (installed from a file)
  // from its catalogue entry.
  const handleUpdate = (plugin) => bezig(plugin.id, () => {
    const bron = bronnen()[plugin.id];
    if (bron?.link) return installeerVanLink(bron.link, { catalogus: bron.catalogus });
    const item = (catalogus()?.items || catalogusItems()).find(i => i.id === plugin.id);
    if (!item) throw new Error('No source to update from');
    return installeerItem(item);
  });

  async function laadCatalogus() {
    setLaden(true);
    try { setCatalogus(await laadCatalogi()); } finally { setLaden(false); }
  }

  function openTab(naam) {
    setTab(naam);
    if (naam === 'browse' && !catalogus() && !laden()) laadCatalogus();
  }

  async function handleCatalogusToevoegen() {
    try {
      await voegCatalogusToe(nieuweCatalogus().trim());
      setNieuweCatalogus('');
      setCatalogusLijst(catalogi());
      await laadCatalogus();
    } catch (err) {
      setMessage({ type: 'error', text: foutTekst(err) });
    }
  }

  async function handleCatalogusVerwijderen(url) {
    await verwijderCatalogus(url);
    setCatalogusLijst(catalogi());
    await laadCatalogus();
  }

  const openLink = (url) => import('../../../core/extern-openen.js').then(m => m.openExtern(url));

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

  const geinstalleerd = (id) => plugins().find(p => p.id === id && p.installed);
  const bronLabel = (id) => {
    const b = bronnen()[id];
    if (!b) return '';
    return b.catalogus ? t('extensionsPanel.fromCatalog') : t('extensionsPanel.custom');
  };

  const gefilterd = createMemo(() => {
    const q = zoek().trim().toLowerCase();
    const items = catalogus()?.items || [];
    if (!q) return items;
    return items.filter(i => [i.name, i.id, i.description, i.author, ...(i.tags || [])].join(' ').toLowerCase().includes(q));
  });

  const pictogram = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
    </svg>
  );

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">{t('extensionsPanel.title')}</h2>

      <div class="ext-tabs" role="tablist">
        <For each={[['installed', t('extensionsPanel.tabInstalled')], ['browse', t('extensionsPanel.tabBrowse')], ['custom', t('extensionsPanel.tabCustom')]]}>
          {([id, label]) => (
            <button class="ext-tab" classList={{ 'is-active': tab() === id }} role="tab" aria-selected={tab() === id} onClick={() => openTab(id)}>
              {label}
              <Show when={id === 'installed' && Object.keys(updates()).length}>
                <span class="ext-tab-count">{Object.keys(updates()).length}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <Show when={message()}>
        <div class={`ext-message ext-message-${message().type}`}>
          {message().text}
        </div>
      </Show>

      {/* ── Installed ─────────────────────────────────────────────── */}
      <Show when={tab() === 'installed'}>
        <Show when={plugins().length === 0}>
          <p class="ext-empty">{t('extensionsPanel.noExtensions')}</p>
        </Show>

        <div class="ext-list">
          <For each={plugins()}>
            {(plugin) => (
              <div class={`ext-card${plugin.status === 'failed' ? ' ext-card-failed' : ''}`} data-extension-id={plugin.id}>
                <div class="ext-card-icon">{pictogram}</div>
                <div class="ext-card-info">
                  <div class="ext-card-header">
                    <h4 class="ext-card-name">{plugin.name || plugin.id}</h4>
                    <Show when={plugin.version}>
                      <span class="ext-card-version">v{plugin.version}</span>
                    </Show>
                    <Show when={bronLabel(plugin.id)}>
                      <span class="ext-card-badge">{bronLabel(plugin.id)}</span>
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
                  <Show when={updates()[plugin.id]}>
                    <button class="ext-action-btn ext-action-primary" disabled={!!installing()} onClick={() => handleUpdate(plugin)}>
                      {installing() === plugin.id ? t('extensionsPanel.installing') : t('extensionsPanel.updateTo').replace('{{version}}', updates()[plugin.id])}
                    </button>
                  </Show>
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
      </Show>

      {/* ── Browse the catalogue ──────────────────────────────────── */}
      <Show when={tab() === 'browse'}>
        <div class="ext-browse-bar">
          <input class="ext-input" type="search" placeholder={t('extensionsPanel.search')} value={zoek()} onInput={(e) => setZoek(e.target.value)} />
          <button class="ext-action-btn" onClick={laadCatalogus} disabled={laden()}>{laden() ? t('extensionsPanel.loading') : t('extensionsPanel.refresh')}</button>
        </div>
        <Show when={catalogus()?.problemen?.length}>
          <For each={catalogus().problemen}>
            {(p) => <div class="ext-message ext-message-error">{t('extensionsPanel.catalogFailed').replace('{{url}}', p.url)}: {p.error}</div>}
          </For>
        </Show>
        <Show when={catalogus() && !gefilterd().length && !laden()}>
          <p class="ext-empty">{t('extensionsPanel.noResults')}</p>
        </Show>
        <div class="ext-list">
          <For each={gefilterd()}>
            {(item) => (
              <div class="ext-card" data-extension-id={item.id}>
                <div class="ext-card-icon">{pictogram}</div>
                <div class="ext-card-info">
                  <div class="ext-card-header">
                    <h4 class="ext-card-name">{item.name}</h4>
                    <Show when={geinstalleerd(item.id)?.version}>
                      <span class="ext-card-version">v{geinstalleerd(item.id).version}</span>
                    </Show>
                    <For each={item.tags}>{(tag) => <span class="ext-card-badge">{tag}</span>}</For>
                  </div>
                  <Show when={item.description}><p class="ext-card-desc">{item.description}</p></Show>
                  <p class="ext-card-author">
                    <Show when={item.author}>{t('extensionsPanel.by')} {item.author}</Show>
                    <Show when={item.homepage}>
                      {' '}<a class="ext-link" href="#" onClick={(e) => { e.preventDefault(); openLink(item.homepage); }}>{t('extensionsPanel.homepage')}</a>
                    </Show>
                  </p>
                </div>
                <div class="ext-card-actions">
                  <Show when={!geinstalleerd(item.id)} fallback={
                    <Show when={updates()[item.id]} fallback={<span class="ext-card-badge">{t('extensionsPanel.isInstalled')}</span>}>
                      <button class="ext-action-btn ext-action-primary" disabled={!!installing()} onClick={() => handleCatalogusItem(item)}>
                        {installing() === item.id ? t('extensionsPanel.installing') : t('extensionsPanel.updateTo').replace('{{version}}', updates()[item.id])}
                      </button>
                    </Show>
                  }>
                    <button class="ext-action-btn ext-action-primary" disabled={!!installing()} onClick={() => handleCatalogusItem(item)}>
                      {installing() === item.id ? t('extensionsPanel.installing') : t('extensionsPanel.install')}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="ext-divider" />
        <h3 class="ext-section-title">{t('extensionsPanel.catalogs')}</h3>
        <p class="ext-install-hint">
          {t('extensionsPanel.submitHint')}{' '}
          <a class="ext-link" href="#" onClick={(e) => { e.preventDefault(); openLink(CATALOGUS_REPO); }}>{CATALOGUS_REPO.replace('https://', '')}</a>
        </p>
        <div class="ext-catalog-list">
          <For each={catalogusLijst()}>
            {(url) => (
              <div class="ext-catalog-row">
                <span class="ext-catalog-url" title={url}>{url}</span>
                <Show when={url !== STANDAARD_CATALOGUS} fallback={<span class="ext-card-badge">{t('extensionsPanel.defaultCatalog')}</span>}>
                  <button class="ext-uninstall-btn" title={t('extensionsPanel.removeCatalog')} onClick={() => handleCatalogusVerwijderen(url)}>×</button>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="ext-browse-bar">
          <input class="ext-input" type="url" placeholder="https://.../extensions.json" value={nieuweCatalogus()} onInput={(e) => setNieuweCatalogus(e.target.value)} />
          <button class="ext-action-btn" disabled={!nieuweCatalogus().trim()} onClick={handleCatalogusToevoegen}>{t('extensionsPanel.addCatalog')}</button>
        </div>
      </Show>

      {/* ── Custom: any extension by link or file ─────────────────── */}
      <Show when={tab() === 'custom'}>
        <p class="ext-warning">{t('extensionsPanel.customWarning')}</p>
        <h3 class="ext-section-title">{t('extensionsPanel.installFromLink')}</h3>
        <div class="ext-browse-bar">
          <input class="ext-input" type="url" placeholder="https://github.com/owner/repo" value={link()} onInput={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && link().trim()) handleLink(); }} />
          <button class="ext-action-btn ext-action-primary" disabled={!link().trim() || !!installing()} onClick={handleLink}>
            {installing() === 'link' ? t('extensionsPanel.installing') : t('extensionsPanel.install')}
          </button>
        </div>
        <p class="ext-install-hint">{t('extensionsPanel.linkHint')}</p>

        <div class="ext-divider" />
        <div class="ext-install-section">
          <button class="ext-install-btn" onClick={handleInstall} disabled={!!installing()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {installing() === 'file' ? t('extensionsPanel.installing') : t('extensionsPanel.installFromFile')}
          </button>
          <p class="ext-install-hint">{t('extensionsPanel.installHint')}</p>
        </div>
      </Show>
    </div>
  );
}
