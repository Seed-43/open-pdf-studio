// Preview of a PDF component from a PDF Collection in its own tab.
//
// The component name comes from the collection file and cannot be trusted:
// it is used as the tab title only. The document is untitled, so Save asks
// for a location. On the desktop the bytes go to a temporary file with an
// app-chosen name in the private import folder (the render pipeline reads
// files); that file is removed with the tab. Without a file system the tab
// is an in-memory document.

const FALLBACK = 'portfolio-component.pdf';

/** A plain file name for the tab title: no folders, no control characters. */
export function previewDisplayName(entryName) {
  const base = String(entryName ?? '').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
  return base && !/^\.+$/.test(base) ? base : FALLBACK;
}

async function desktopDeps() {
  const [{ isTauri, writeBinaryFileNew }, { createTab }, { loadPDF }, { importMap }, { onthoudWerkbestand }] = await Promise.all([
    import('../core/platform.js'),
    import('../ui/chrome/tabs.js'),
    import('./loader.js'),
    import('./cad-import.js'),
    import('./document-release.js'),
  ]);
  return {
    desktop: isTauri() && !!window.__TAURI__?.fs,
    now: () => Date.now(),
    privateDir: importMap,
    writeNew: writeBinaryFileNew,
    createTab: (path) => createTab(path),
    loadPDF,
    rememberTemp: onthoudWerkbestand,
  };
}

/**
 * Open `bytes` as an untitled preview tab titled after `entryName`.
 * @returns {Promise<object>} the new document
 */
export async function openPortfolioPreview(bytes, entryName, deps = null) {
  const d = deps || await desktopDeps();
  const title = previewDisplayName(entryName);
  let path = null;
  if (d.desktop) {
    const dir = await d.privateDir();
    if (!dir) throw new Error('PREVIEW_UNAVAILABLE');
    path = `${dir}opds-import-${d.now()}-portfolio-preview.pdf`;
    await d.writeNew(path, bytes);
  }
  const { doc, index } = d.createTab(path);
  // Before loading, so the loader keeps the temporary path out of the recent files.
  doc.isUntitled = true;
  if (path) d.rememberTemp(doc, path);
  await d.loadPDF(path || `__memory__${doc.id}`, index, bytes.slice());
  doc.fileName = title;
  return doc;
}
