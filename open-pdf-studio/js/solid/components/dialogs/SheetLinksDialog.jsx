import { createSignal, For, Show, untrack } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { captureLinkIndex, scanSheetLinks, renderLinkPreview, exportLinkedPackage, sheetLinkRequest } from '../../../sheet-links/service.js';

export default function SheetLinksDialog() {
  const { t } = useTranslation('dialogs');
  const [files, setFiles] = createSignal([]),
    [index, setIndex] = createSignal([]),
    [prefix, setPrefix] = createSignal(''),
    [sensitive, setSensitive] = createSignal(false),
    [scan, setScan] = createSignal(null),
    [selected, setSelected] = createSignal({}),
    [targets, setTargets] = createSignal({}),
    [replace, setReplace] = createSignal(false),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [preview, setPreview] = createSignal(false),
    [report, setReport] = createSignal(null);
  let sourceCanvas, targetCanvas;
  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const change = (id, key, value) => {
    setIndex(rows => rows.map(r => r.id === id ? { ...r, [key]: value } : r));
    setScan(null);
  };
  async function previewHit(hit) {
    setPreview(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await untrack(() => renderLinkPreview(scan().id, hit.id, targets()[hit.id], 'source', sourceCanvas));
    if (targets()[hit.id]) await untrack(() => renderLinkPreview(scan().id, hit.id, targets()[hit.id], 'target', targetCanvas));
    else {
      targetCanvas.width = 0;
      targetCanvas.height = 0;
    }
  }
  async function download() {
    const selections = Object.entries(selected()).filter(([, v]) => v).map(([hitId]) => ({ hitId, targetId: targets()[hitId] }));
    const result = await exportLinkedPackage({ id: scan().id, selections, replaceExisting: replace() });
    setReport(result.report);
    const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/zip' })),
      a = document.createElement('a');
    a.href = url;
    a.download = 'linked-drawing-package.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <Dialog
    title={t('sheetLinks.title')}
    onClose={() => closeDialog('sheet-links')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog sheet-links-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('sheet-links')}>{t('sheetLinks.close')}</button>}
  >
    <p>{t('sheetLinks.help')}</p>
    <p>{t('sheetLinks.limits')}</p>
    <button
      class="pref-btn"
      disabled={busy()}
      onClick={() => act(async () => {
        const result = await captureLinkIndex();
        setFiles(result.files.map(f => ({ ...f, selected: true })));
        setIndex(result.index);
        setScan(null);
        setPreview(false);
      })}
    >
      {t('sheetLinks.capture')}
    </button>
    <For each={files()}>
      {f => <label><input
          type="checkbox"
          checked={f.selected}
          onChange={e => {
            setFiles(rows => rows.map(r => r.documentId === f.documentId ? { ...r, selected: e.target.checked } : r));
            setScan(null);
          }}
        />{f.path} · {f.pageCount} {f.modified ? t('sheetLinks.unsaved') : ''}</label>}
    </For>
    <label>
      {t('sheetLinks.prefix')}
      <input type="text" value={prefix()} onInput={e => {
        setPrefix(e.target.value);
        setScan(null);
      }} />
    </label>
    <label>
      <input
        type="checkbox"
        checked={sensitive()}
        onChange={e => {
          setSensitive(e.target.checked);
          setScan(null);
        }}
      />
      {t('sheetLinks.caseSensitive')}
    </label>
    <div class="sheet-links-table">
      <table>
        <thead>
          <tr>
            <th>{t('sheetLinks.page')}</th>
            <th>{t('sheetLinks.label')}</th>
            <th>{t('sheetLinks.region')}</th>
          </tr>
        </thead>
        <tbody>
          <For each={index().filter(r => files().some(f => f.selected && f.path === r.path))}>
            {row => <tr>
              <td>{row.path} #{row.page}</td>
              <td><input type="text" value={row.label} onChange={e => change(row.id, 'label', e.target.value)} /></td>
              <td>
                <label>
                  <input
                    type="checkbox"
                    checked={!!row.region}
                    onChange={e => change(row.id, 'region', e.target.checked ? [0, 0, 100, 100] : null)}
                  />
                  {t('sheetLinks.detail')}
                </label>
                <Show when={row.region}>
                  <For each={[0, 1, 2, 3]}>
                    {i => <input
                      aria-label={`${row.label} ${['left', 'bottom', 'right', 'top'][i]}`}
                      type="text"
                      inputmode="decimal"
                      data-getal="decimaal"
                      value={row.region[i]}
                      onChange={e => change(row.id, 'region', row.region.map((v, n) => n === i ? leesGetal(e.target.value) : v))}
                    />}
                  </For>
                </Show>
              </td>
            </tr>}
          </For>
        </tbody>
      </table>
    </div>
    <button
      class="pref-btn"
      disabled={busy() || !files().some(f => f.selected)}
      onClick={() => act(async () => {
        const chosen = files().filter(f => f.selected);
        const result = await scanSheetLinks({
          files: chosen,
          index: index().filter(r => chosen.some(f => f.path === r.path)),
          prefix: prefix(),
          caseSensitive: sensitive()
        });
        setScan(result);
        setSelected({});
        setTargets(Object.fromEntries(result.hits.map(h => [h.id, h.targets.length === 1 ? h.targets[0] : ''])));
        setPreview(false);
        setReport(null);
      })}
    >
      {t('sheetLinks.scan')}
    </button>
    <button class="pref-btn" disabled={!busy()} onClick={() => sheetLinkRequest({ action: 'cancel' })}>
      {t('sheetLinks.cancel')}
    </button>
    <Show when={scan()}>
      <p>{scan()?.hits.length} {t('sheetLinks.found')}</p>
      <For each={scan()?.hits}>
        {hit => <div class="sheet-links-hit">
          <input
            aria-label={`${t('sheetLinks.accept')} ${hit.label}`}
            type="checkbox"
            disabled={!targets()[hit.id]}
            checked={!!selected()[hit.id]}
            onChange={e => setSelected(s => ({ ...s, [hit.id]: e.target.checked }))}
          />
          <span>{hit.source} #{hit.page}: {hit.label} — {t(`sheetLinks.states.${hit.status}`)} {hit.existing ? t('sheetLinks.existing') : ''} {hit.approximate ? t('sheetLinks.approximate') : ''}</span>
          <select
            value={targets()[hit.id] || ''}
            onChange={e => {
              setTargets(s => ({ ...s, [hit.id]: e.target.value }));
              setSelected(s => ({ ...s, [hit.id]: false }));
              setPreview(false);
            }}
          >
            <option value="">—</option>
            <For each={scan()?.index}>
              {target => <option value={target.id}>{target.label} · {target.path} #{target.page}</option>}
            </For>
          </select>
          <button class="pref-btn" disabled={busy()} onClick={() => act(() => previewHit(hit))}>
            {t('sheetLinks.preview')}
          </button>
        </div>}
      </For>
      <label>
        <input type="checkbox" checked={replace()} onChange={e => setReplace(e.target.checked)} />
        {t('sheetLinks.replace')}
      </label>
      <button
        class="pref-btn"
        disabled={busy() || !Object.values(selected()).some(Boolean)}
        onClick={() => act(download)}
      >
        {t('sheetLinks.export')}
      </button>
    </Show>
    <Show when={preview()}>
      <div class="sheet-links-preview">
        <canvas ref={sourceCanvas} />
        <canvas ref={targetCanvas} />
      </div>
    </Show>
    <For each={report() || []}>
      {r => <p>{r.path}: {t('sheetLinks.result', { added: r.added, skipped: r.skipped, replaced: r.replaced })}</p>}
    </For>
    <p role="status">{error()}</p>
  </Dialog>;
}
