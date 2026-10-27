import { createSignal, For, Show, onCleanup } from 'solid-js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { isTauri, openFolderDialog } from '../../core/platform.js';
import { searchWorkspace, revealWorkspaceMatch, prepareSearchOcr } from '../../search/document-search-service.js';

/**
 * Search across documents, shown as an extra row of the find bar when the
 * user picks "Search documents" from the bar's options menu.
 */
export default function DocumentSearch() {
  const { t } = useTranslation('statusbar');
  const [query, setQuery] = createSignal('');
  const [scope, setScope] = createSignal('open');
  const [folder, setFolder] = createSignal('');
  const [annotations, setAnnotations] = createSignal(true);
  const [report, setReport] = createSignal(null);
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal('');
  let controller;
  onCleanup(() => controller?.abort());

  const run = async () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    setRunning(true);
    setError('');
    setReport(null);
    try {
      const result = await searchWorkspace(
        { query: query(), scope: scope(), folder: folder(), annotations: annotations() },
        {
          signal: current.signal,
          onProgress: (value) => { if (controller === current) setReport(value); },
        },
      );
      if (controller === current) setReport(result);
    } catch {
      if (controller === current) setError(t('documentSearch.failed'));
    } finally {
      if (controller === current) setRunning(false);
    }
  };

  const reveal = async (match) => {
    try {
      await revealWorkspaceMatch(match);
    } catch {
      setError(t('documentSearch.stale'));
    }
  };

  const chooseFolder = async () => {
    const path = await openFolderDialog();
    if (path) setFolder(path);
  };

  const prepareOcr = async (file) => {
    try {
      await prepareSearchOcr(file);
    } catch {
      setError(t('documentSearch.stale'));
    }
  };

  const canSearch = () => query().trim() && !running() && !(scope() === 'folder' && !folder());

  return (
    <div class="document-search">
      <div class="find-row">
        <input
          class="find-input"
          aria-label={t('documentSearch.query')}
          placeholder={t('documentSearch.query')}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && query().trim()) run(); }}
        />
        <select aria-label={t('documentSearch.scope')} value={scope()} onChange={(e) => setScope(e.currentTarget.value)}>
          <option value="active">{t('documentSearch.active')}</option>
          <option value="open">{t('documentSearch.open')}</option>
          <Show when={isTauri()}><option value="folder">{t('documentSearch.folder')}</option></Show>
        </select>
        <Show when={scope() === 'folder'}>
          <button onClick={chooseFolder}>{folder() || t('documentSearch.choose')}</button>
        </Show>
        <label>
          <input type="checkbox" checked={annotations()} onChange={(e) => setAnnotations(e.currentTarget.checked)} />
          {t('documentSearch.annotations')}
        </label>
        <button disabled={!canSearch()} onClick={run}>{t('documentSearch.search')}</button>
        <button disabled={!running()} onClick={() => controller?.abort()}>{t('documentSearch.cancel')}</button>
      </div>
      <Show when={scope() === 'folder'}><p>{t('documentSearch.folderHint')}</p></Show>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Show when={report()}>
        {(r) => (
          <div class="document-search-results" aria-live="polite">
            <Show when={r().truncated}><p>{t('documentSearch.limited')}</p></Show>
            <Show when={r().cancelled}><p>{t('documentSearch.cancelled')}</p></Show>
            <For each={r().files}>
              {(file) => (
                <section>
                  <strong>{file.name}</strong> — {t(`documentSearch.status.${file.status}`)} ({file.matches})
                  <Show when={file.unsearchablePages.length}>
                    <Show when={isTauri()}>
                      <button onClick={() => prepareOcr(file)}>{t('documentSearch.prepareOcr')}</button>
                    </Show>
                    <p>{t('documentSearch.ocrHint', { pages: file.unsearchablePages.join(', ') })}</p>
                  </Show>
                  <For each={r().matches.filter((m) => m.documentId === file.id)}>
                    {(match) => (
                      <div>
                        <button onClick={() => reveal(match)}>{match.pageLabel}: {match.snippet || match.matchText}</button>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}
