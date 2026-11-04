// Extension catalogue, in the spirit of pyRevit's extensions.json: one shared
// JSON list in a GitHub repository, where authors add their extension with a
// pull request. Each entry points at the author's own repository; the app
// installs the .oppx from its latest GitHub release (or a fixed package link
// with a SHA-256). Users can add more catalogues and install any extension
// by link ("custom"), which is not reviewed.
//
// Catalogue format (extensions.json):
// { "version": 1, "extensions": [ {
//     "id": "my-extension", "name": "My Extension", "description": "...",
//     "author": "...", "repo": "https://github.com/owner/my-extension",
//     "homepage": "...", "tags": ["markup"],
//     "package": "https://.../my-extension.oppx", "sha256": "...",  (optional)
//     "version": "0.1.2"   (with package: the version it installs)
// } ] }

import { state } from '../core/state.js';

// The project's own catalogue repository (to be created by the maintainers).
export const STANDAARD_CATALOGUS = 'https://raw.githubusercontent.com/OpenAEC-Foundation/open-pdf-studio-extensions/main/extensions.json';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The catalogue URLs: the default one plus what the user added. */
export function catalogi() {
  const eigen = Array.isArray(state.preferences?.extensionCatalogs) ? state.preferences.extensionCatalogs : [];
  return [STANDAARD_CATALOGUS, ...eigen.filter(u => typeof u === 'string' && u !== STANDAARD_CATALOGUS)];
}

async function bewaarVoorkeuren() {
  const { savePreferences } = await import('../core/preferences.js');
  savePreferences();
}

export async function voegCatalogusToe(url) {
  if (!/^https:\/\//.test(url)) throw new Error('A catalogue link must start with https://');
  const eigen = catalogi().slice(1);
  if (!eigen.includes(url)) state.preferences.extensionCatalogs = [...eigen, url];
  await bewaarVoorkeuren();
}

export async function verwijderCatalogus(url) {
  state.preferences.extensionCatalogs = catalogi().slice(1).filter(u => u !== url);
  await bewaarVoorkeuren();
}

function schoon(e, catalogus) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !ID.test(e.id)) return null;
  const tekst = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
  const https = (v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : '');
  const item = {
    id: e.id, name: tekst(e.name, 80) || e.id, description: tekst(e.description), author: tekst(e.author, 80),
    repo: https(e.repo), homepage: https(e.homepage) || https(e.repo), package: https(e.package),
    sha256: /^[0-9a-f]{64}$/i.test(e.sha256 || '') ? e.sha256 : '',
    version: tekst(e.version, 64).replace(/^v/i, ''),
    tags: Array.isArray(e.tags) ? e.tags.filter(t => typeof t === 'string').slice(0, 8) : [],
    catalogus,
  };
  return item.repo || item.package ? item : null;
}

/** All entries of all catalogues; `problemen` lists catalogues that failed. */
export async function laadCatalogi() {
  const items = [], problemen = [];
  for (const url of catalogi()) {
    try {
      const data = JSON.parse(await invoke('extensie_tekst_ophalen', { url }));
      for (const e of Array.isArray(data?.extensions) ? data.extensions : []) {
        const item = schoon(e, url);
        if (item && !items.some(i => i.id === item.id)) items.push(item);
      }
    } catch (e) {
      problemen.push({ url, error: String(e?.message ?? e) });
    }
  }
  return { items, problemen };
}

/**
 * Turn a link into a package to download: a .oppx link as is, a GitHub
 * repository link into the .oppx of its latest release.
 * @returns {Promise<{ url, version, sha256 }>}
 */
export async function losLinkOp(link, sha256 = '') {
  const l = String(link || '').trim();
  if (/^https:\/\/\S+\.oppx(\?\S*)?$/i.test(l)) return { url: l, version: '', sha256 };
  const m = GITHUB_REPO.exec(l);
  if (!m) throw new Error('Use a GitHub repository link (https://github.com/owner/repo) or a link to a .oppx file');
  const info = JSON.parse(await invoke('extensie_tekst_ophalen', {
    url: `https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest`,
  }));
  const asset = (info.assets || []).find(a => /\.oppx$/i.test(a.name || ''));
  if (!asset) throw new Error(`The latest release of ${m[1]}/${m[2]} has no .oppx file`);
  // GitHub reports a digest for release assets ("sha256:..."): use it when the
  // catalogue gives none.
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')?.[1] || '';
  return { url: asset.browser_download_url, version: String(info.tag_name || '').replace(/^v/i, ''), sha256: sha256 || digest };
}

/** Where each installed extension came from: { id: { link, catalogus } }. */
export function bronnen() {
  return state.preferences?.extensionSources && typeof state.preferences.extensionSources === 'object'
    ? state.preferences.extensionSources : {};
}

/**
 * Download and install from a link (catalogue entry or custom).
 * @returns {Promise<{ id, name, version }>}
 */
export async function installeerVanLink(link, { sha256 = '', catalogus = '' } = {}) {
  const pakket = await losLinkOp(link, sha256);
  const pad = await invoke('extensie_pakket_ophalen', { url: pakket.url, sha256: pakket.sha256 || null });
  const { installPluginFromFile } = await import('./plugin-manager.js');
  const manifest = await installPluginFromFile(pad);
  state.preferences.extensionSources = { ...bronnen(), [manifest.id]: { link: String(link).trim(), catalogus } };
  await bewaarVoorkeuren();
  return manifest;
}

/** Install a catalogue entry. */
export function installeerItem(item) {
  return installeerVanLink(item.package || item.repo, { sha256: item.sha256, catalogus: item.catalogus });
}

/** Compare versions like 1.2.10 > 1.2.9; non-numeric parts compare as text. */
export function vergelijkVersies(a, b) {
  const pa = String(a || '').split(/[.+-]/), pb = String(b || '').split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0', y = pb[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c) return Math.sign(c);
  }
  return 0;
}

/**
 * The latest version for an installed extension, or '': the catalogue entry's
 * version when it has one (a package link), otherwise the latest release
 * behind the link it was installed from.
 */
export async function nieuwsteVersie(id, catalogusItems = []) {
  const item = catalogusItems.find(i => i.id === id);
  if (item?.version) return item.version;
  // Installed from a file but listed in a catalogue: follow the catalogue's
  // repository, so updates are offered all the same.
  const link = bronnen()[id]?.link || item?.repo || '';
  if (!link || /\.oppx(\?|$)/i.test(link)) return '';
  try { return (await losLinkOp(link)).version; } catch { return ''; }
}
