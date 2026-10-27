import { createSignal, createMemo, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { schedules, getScheduleById, buildResultForSchedule } from '../../stores/schedulesStore.js';
import { openFileDialog, readBinaryFile, isTauri } from '../../../core/platform.js';
import { inspectWorkbook } from '../../../quantities/workbook-adapter.js';
import { inspectBindings, bindWorkbook, refreshBinding, prepareWorkbookBinding, workbookBindingRequest, previewBinding } from '../../../quantities/workbook-binding-service.js';

export default function WorkbookBindingsDialog() {
  const { t } = useTranslation('dialogs');
  const [bindings, setBindings] = createSignal([]),
    [id, setId] = createSignal(''),
    [name, setName] = createSignal(''),
    [scheduleId, setScheduleId] = createSignal(schedules()[0]?.id || ''),
    [path, setPath] = createSignal(''),
    [sheets, setSheets] = createSignal([]),
    [sheet, setSheet] = createSignal(''),
    [mapping, setMapping] = createSignal({}),
    [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal(''),
    [status, setStatus] = createSignal('');
  let bytes = null;
  const close = () => closeDialog('workbook-bindings');
  const reload = async () => setBindings(await inspectBindings());
  const run = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  onMount(() => run(reload));
  const columns = createMemo(() => {
    const s = getScheduleById(scheduleId());
    return s ? buildResultForSchedule(s).columns.filter(c => c.kind === 'number' && c.total !== false) : [];
  });
  const load = async data => {
    bytes = data;
    const names = await inspectWorkbook(bytes);
    setSheets(names);
    if (!names.includes(sheet())) setSheet(names[0] || '');
  };
  const browse = () => run(async () => {
    const selected = await openFileDialog(['xlsx']);
    if (!selected) return;
    const target = Array.isArray(selected) ? selected[0] : selected;
    setPath(target);
    await load(new Uint8Array(await readBinaryFile(target)));
  });
  const download = (data, filename, type) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const save = () => run(async () => {
    const binding = bindWorkbook({
      id: id() || undefined,
      name: name(),
      documentId: getActiveDocument()?.id,
      scheduleId: scheduleId(),
      workbookPath: path(),
      sheet: sheet(),
      mappings: columns().filter(c => mapping()[c.key]?.trim()).map(c => ({ field: c.key, cell: mapping()[c.key].trim().toUpperCase(), unit: c.unit || '' }))
    });
    setId(binding.id);
    await reload();
    setStatus(t('workbookBindings.bound'));
  });
  const choose = b => {
    setId(b.id);
    setName(b.name);
    setScheduleId(b.scheduleId);
    setPath(b.workbookPath);
    setSheets([b.sheet]);
    setSheet(b.sheet);
    setMapping(Object.fromEntries(b.mappings.map(m => [m.field, m.cell])));
    bytes = null;
  };
  const refresh = b => run(async () => {
    if (isTauri()) {
      const r = await refreshBinding(b.id);
      setStatus(t('workbookBindings.refreshedWithBackup', { path: r.backupPath }));
    } else {
      if (b.id !== id() || !bytes) throw new Error('RESELECT_WORKBOOK');
      const result = await prepareWorkbookBinding(b, bytes);
      download(result.bytes, 'refreshed-' + path().split(/[\\/]/).pop(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      setStatus(t('workbookBindings.copyReady'));
    }
    await reload();
  });
  return <Dialog
    title={t('workbookBindings.title')}
    dialogClass="workbook-bindings-dialog"
    onClose={close}
    footer={<button class="pref-btn" onClick={close}>{t('workbookBindings.close')}</button>}
  >
    <p>{t('workbookBindings.info')}</p>
    <Show when={error()}>
      <p role="alert">{t(`workbookBindings.errors.${error()}`, { defaultValue: error() })}</p>
    </Show>
    <p role="status">{status()}</p>
    <p>{t('workbookBindings.source')}: {getActiveDocument()?.saveTargetPath || getActiveDocument()?.filePath || '—'}</p>
    <div class="workbook-binding-controls">
      <label>
        {t('workbookBindings.name')}
        <input value={name()} onInput={e => setName(e.currentTarget.value)} />
      </label>
      <label>
        {t('workbookBindings.schedule')}
        <select value={scheduleId()} onChange={e => setScheduleId(e.currentTarget.value)}>
          <For each={schedules()}>{s => <option value={s.id}>{s.name}</option>}</For>
        </select>
      </label>
      <label>
        {t('workbookBindings.path')}
        <input value={path()} onInput={e => {
          setPath(e.currentTarget.value);
          bytes = null;
        }} />
      </label>
      <Show
        when={isTauri()}
        fallback={<label>
          {t('workbookBindings.choose')}
          <input
            type="file"
            accept=".xlsx"
            onChange={e => {
              const f = e.currentTarget.files?.[0];
              if (f) run(async () => {
                setPath(f.name);
                await load(new Uint8Array(await f.arrayBuffer()));
              });
            }}
          />
        </label>}
      >
        <button class="pref-btn" disabled={busy()} onClick={browse}>{t('workbookBindings.choose')}</button>
      </Show>
      <label>
        {t('workbookBindings.sheet')}
        <select value={sheet()} onChange={e => setSheet(e.currentTarget.value)}>
          <For each={sheets()}>{s => <option value={s}>{s}</option>}</For>
        </select>
      </label>
    </div>
    <p>{t('workbookBindings.mapping')}</p>
    <div class="workbook-binding-controls">
      <For each={columns()}>
        {c => <label>{c.label} ({c.unit || '—'})<input
            placeholder="B2"
            value={mapping()[c.key] || ''}
            onInput={e => setMapping(m => ({ ...m, [c.key]: e.currentTarget.value }))}
          /></label>}
      </For>
    </div>
    <button class="pref-btn" disabled={busy()} onClick={save}>
      {id() ? t('workbookBindings.rebind') : t('workbookBindings.bind')}
    </button>
    <button class="pref-btn" onClick={() => {
      setId('');
      setName('');
      setMapping({});
    }}>
      {t('workbookBindings.new')}
    </button>
    <button class="pref-btn" disabled={busy()} onClick={() => run(reload)}>
      {t('workbookBindings.check')}
    </button>
    <For each={bindings()}>
      {b => <section class="workbook-binding-row">
        <button class="pref-btn" onClick={() => choose(b)}>{b.name}</button>
        <strong>{t(`workbookBindings.states.${b.status}`)}</strong>
        <p>{b.sourcePath} → {b.workbookPath} · {b.sheet} · {b.scheduleName}</p>
        <p>{b.mappings.map(m => `${m.field} → ${m.cell} (${m.unit})`).join('; ')}</p>
        <Show when={b.last}>
          <p>{b.last.refreshedAt} · {t('workbookBindings.revision')}: {b.last.revision} {b.last.unsavedSource ? t('workbookBindings.unsaved') : ''}</p>
        </Show>
        <button class="pref-btn" disabled={busy()} onClick={() => refresh(b)}>
          {isTauri() ? t('workbookBindings.refresh') : t('workbookBindings.copy')}
        </button>
        <button
          class="pref-btn"
          disabled={busy()}
          onClick={() => run(async () => {
            const result = await previewBinding(b.id);
            download(result.csv, 'quantities.csv', 'text/csv;charset=utf-8');
          })}
        >
          {t('workbookBindings.csv')}
        </button>
        <button
          class="pref-btn"
          onClick={() => download(JSON.stringify(b, null, 2), 'quantity-binding.json', 'application/json')}
        >
          {t('workbookBindings.export')}
        </button>
        <button
          class="pref-btn"
          disabled={busy()}
          onClick={() => run(async () => {
            await workbookBindingRequest({ action: 'remove', id: b.id });
            await reload();
            if (id() === b.id) setId('');
          })}
        >
          {t('workbookBindings.remove')}
        </button>
      </section>}
    </For>
  </Dialog>;
}
