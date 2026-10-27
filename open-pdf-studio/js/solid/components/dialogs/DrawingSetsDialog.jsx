import { createSignal, createMemo, For, Show, untrack } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { openFolderDialog, isTauri } from '../../../core/platform.js';
import { drawingSetState, drawingSetRequest, renderTransfer } from '../../../drawing-sets/service.js';

export default function DrawingSetsDialog() {
  const { t } = useTranslation('dialogs');
  const [state, setState] = createSignal(drawingSetState()),
    [incoming, setIncoming] = createSignal([]),
    [plan, setPlan] = createSignal(null),
    [choices, setChoices] = createSignal([]),
    [error, setError] = createSignal(''),
    [busy, setBusy] = createSignal(false),
    [from, setFrom] = createSignal(''),
    [to, setTo] = createSignal(''),
    [dx, setDx] = createSignal('0'),
    [dy, setDy] = createSignal('0'),
    [transfer, setTransfer] = createSignal(null),
    [selected, setSelected] = createSignal([]);
  let sourceCanvas, targetCanvas;
  const versions = createMemo(() => state().manifest.sheets.flatMap(s => s.versions.map((v, i) => ({
    key: `${s.id}:${i}`,
    id: s.id,
    index: i,
    sheet: v,
    label: `${v.number} · ${v.revision || '—'} · ${v.source} #${v.page}`
  }))));
  const version = key => versions().find(v => v.key === key);
  const download = (object, name) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  async function act(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
      const next = drawingSetState();
      if (JSON.stringify(next) !== JSON.stringify(state())) setState(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const edit = (index, key, value) => {
    setIncoming(rows => rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
    setPlan(null);
  };
  async function paint() {
    const p = transfer();
    if (!p || !sourceCanvas || !targetCanvas) return;
    for (const [side, canvas] of [['source', sourceCanvas], ['target', targetCanvas]]) {
      const { scale } = await untrack(() => renderTransfer(p.id, side, canvas));
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 / scale;
      for (const row of p.rows.filter(r => selected().includes(r.sourceId))) {
        const a = side === 'source' ? row.sourceAnnotation : row.annotation;
        if (!a) continue;
        if (a.points) {
          ctx.beginPath();
          a.points.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
          ctx.closePath();
          ctx.stroke();
        } else if (a.startX !== undefined) {
          ctx.beginPath();
          ctx.moveTo(a.startX, a.startY);
          ctx.lineTo(a.endX, a.endY);
          ctx.stroke();
        } else ctx.strokeRect(a.x, a.y, a.width, a.height);
      }
      ctx.restore();
    }
  }
  async function previewTransfer() {
    const source = version(from())?.sheet,
      target = version(to())?.sheet;
    const result = await drawingSetRequest({ action: 'transferPreview', source, target, dx: leesGetal(dx()), dy: leesGetal(dy()) });
    setSelected([]);
    setTransfer(result);
    await new Promise(resolve => setTimeout(resolve, 0));
    await paint();
  }
  return <Dialog
    title={t('drawingSets.title')}
    onClose={() => closeDialog('drawing-sets')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog drawing-sets-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('drawing-sets')}>{t('drawingSets.close')}</button>}
  >
    <p>{t('drawingSets.help')}</p>
    <label>
      {t('drawingSets.name')}
      <input
        type="text"
        value={state().manifest.name}
        onChange={e => act(() => drawingSetRequest({ action: 'import', manifest: { ...state().manifest, name: e.target.value } }))}
      />
    </label>
    <div>
      <button class="pref-btn" onClick={() => download(state().manifest, 'drawing-set.json')}>
        {t('drawingSets.export')}
      </button>
      <label>
        {t('drawingSets.importLabel')}
        <input
          type="file"
          accept=".json"
          onChange={e => {
            const f = e.target.files[0];
            if (f) act(async () => {
              if (f.size > 10000000) throw Error('MANIFEST_LIMIT');
              await drawingSetRequest({ action: 'import', manifest: JSON.parse(await f.text()) });
              setPlan(null);
              setTransfer(null);
            });
          }}
        />
      </label>
      <button
        class="pref-btn"
        disabled={!isTauri()}
        onClick={() => act(async () => {
          const root = await openFolderDialog(t('drawingSets.root'));
          if (root) await drawingSetRequest({ action: 'root', root });
        })}
      >
        {t('drawingSets.root')}
      </button>
      {state().root}
    </div>
    <table>
      <thead>
        <tr>
          <th>{t('drawingSets.number')}</th>
          <th>{t('drawingSets.discipline')}</th>
          <th>{t('drawingSets.revisions')}</th>
        </tr>
      </thead>
      <tbody>
        <For each={state().manifest.sheets}>
          {s => <tr>
            <td>{s.versions.at(-1).number} {s.present ? '' : t('drawingSets.removed')}</td>
            <td>{s.versions.at(-1).discipline}</td>
            <td>
              <For each={[...s.versions].reverse()}>
                {v => <button
                  class="pref-btn"
                  disabled={busy()}
                  onClick={() => act(() => drawingSetRequest({ action: 'open', id: s.id, version: s.versions.indexOf(v) }))}
                >{v.revision || '—'} · {v.date} {s.versions.at(-1) === v ? t('drawingSets.latest') : ''}</button>}
              </For>
            </td>
          </tr>}
        </For>
      </tbody>
    </table>
    <h3>{t('drawingSets.package')}</h3>
    <button
      class="pref-btn"
      disabled={busy()}
      onClick={() => act(async () => {
        const { sheets } = await drawingSetRequest({ action: 'capture' });
        setIncoming([...incoming(), ...sheets]);
        setPlan(null);
      })}
    >
      {t('drawingSets.capture')}
    </button>
    <button class="pref-btn" onClick={() => {
      setIncoming([]);
      setPlan(null);
    }}>
      {t('drawingSets.clear')}
    </button>
    <div class="drawing-set-table">
      <table>
        <thead>
          <tr>
            <For each={['source', 'number', 'titleField', 'discipline', 'revision', 'date']}>
              {key => <th>{t(`drawingSets.${key}`)}</th>}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={incoming()}>
            {(sheet, index) => <tr>
              <td>{sheet.source} #{sheet.page}</td>
              <For each={['number', 'title', 'discipline', 'revision', 'date']}>
                {key => <td>
                  <input
                    aria-label={`${sheet.source} ${sheet.page} ${key}`}
                    type="text"
                    value={sheet[key]}
                    onChange={e => edit(index(), key, e.target.value)}
                  />
                </td>}
              </For>
            </tr>}
          </For>
        </tbody>
      </table>
    </div>
    <button
      class="pref-btn"
      disabled={busy() || !incoming().length}
      onClick={() => act(async () => {
        const p = await drawingSetRequest({ action: 'preview', sheets: incoming() });
        setPlan(p);
        setChoices(p.rows.map(r => r.status === 'matched' ? r.matches[0] : r.status === 'added' ? 'new' : ''));
      })}
    >
      {t('drawingSets.review')}
    </button>
    <Show when={plan()}>
      <For each={plan()?.rows}>
        {(r, index) => <label>{r.sheet.number}: {t(`drawingSets.states.${r.status}`)}<select
            value={choices()[index()]}
            onChange={e => setChoices(c => c.map((v, i) => i === index() ? e.target.value : v))}
          >
            <option value="">—</option>
            <option value="new">{t('drawingSets.addNew')}</option>
            <option value="ignore">{t('drawingSets.ignore')}</option>
            <For each={state().manifest.sheets}>
              {s => <option value={s.id}>{s.versions.at(-1).discipline} / {s.versions.at(-1).number} · {s.versions.at(-1).revision} · {s.id.slice(0, 8)}</option>}
            </For>
          </select></label>}
      </For>
      <button
        class="pref-btn"
        disabled={busy() || choices().some(c => !c)}
        onClick={() => act(async () => {
          await drawingSetRequest({ action: 'commit', base: plan().base, sheets: incoming(), resolutions: choices() });
          setPlan(null);
          setIncoming([]);
        })}
      >
        {t('drawingSets.confirm')}
      </button>
    </Show>
    <Show when={state().report}>
      <p>{t('drawingSets.report')}</p>
      <For each={Object.entries(state().report || {})}>
        {([key, values]) => <p>{t(`drawingSets.reportStates.${key}`)}: {values.join(', ') || '—'}</p>}
      </For>
      <button class="pref-btn" onClick={() => download(state().report, 'revision-report.json')}>
        {t('drawingSets.exportReport')}
      </button>
    </Show>
    <h3>{t('drawingSets.transfer')}</h3>
    <p>{t('drawingSets.transferHelp')}</p>
    <For each={['from', 'to']}>
      {side => <label>
        {t(side === 'from' ? 'drawingSets.fromLabel' : 'drawingSets.to')}
        <select
          value={side === 'from' ? from() : to()}
          onChange={e => {
            (side === 'from' ? setFrom : setTo)(e.target.value);
            setTransfer(null);
          }}
        >
          <option value="">—</option>
          <For each={versions()}>{v => <option value={v.key}>{v.label}</option>}</For>
        </select>
      </label>}
    </For>
    <label>
      {t('drawingSets.dx')}
      <input
        type="text"
        inputmode="decimal"
        data-getal="decimaal"
        value={dx()}
        onInput={e => {
          setDx(e.target.value);
          setTransfer(null);
        }}
      />
    </label>
    <label>
      {t('drawingSets.dy')}
      <input
        type="text"
        inputmode="decimal"
        data-getal="decimaal"
        value={dy()}
        onInput={e => {
          setDy(e.target.value);
          setTransfer(null);
        }}
      />
    </label>
    <button class="pref-btn" disabled={busy() || !from() || !to()} onClick={() => act(previewTransfer)}>
      {t('drawingSets.preview')}
    </button>
    <Show when={transfer()}>
      <div class="drawing-set-preview">
        <canvas ref={sourceCanvas} />
        <canvas ref={targetCanvas} />
      </div>
      <For each={transfer()?.rows}>
        {row => <label><input
            type="checkbox"
            disabled={!['ready', 'review'].includes(row.status)}
            checked={selected().includes(row.sourceId)}
            onChange={e => act(async () => {
              setSelected(s => e.target.checked ? [...s, row.sourceId] : s.filter(id => id !== row.sourceId));
              await paint();
            })}
          />{row.sourceId}: {t(`drawingSets.states.${row.status}`)}</label>}
      </For>
      <button
        class="pref-btn"
        disabled={busy() || !selected().length}
        onClick={() => act(async () => {
          await drawingSetRequest({ action: 'transferApply', id: transfer().id, selected: selected(), confirmed: true });
          setTransfer(null);
        })}
      >
        {t('drawingSets.apply')}
      </button>
    </Show>
    <p role="status">{error()}</p>
  </Dialog>;
}
