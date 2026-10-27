import { createSignal, For, Show, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { leesGetal } from '../../../core/getal-invoer.js';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openFileDialog, openFolderDialog, isTauri } from '../../../core/platform.js';
import { defaultWorkflow, validateWorkflow, processWorkflow } from '../../../workflows/document-workflow.js';
import { workflowRequest, workflowStatus } from '../../../workflows/workflow-service.js';

export default function DocumentWorkflowsDialog() {
  const { t } = useTranslation('dialogs');
  const [config, setConfig] = createSignal(JSON.stringify(defaultWorkflow(), null, 2)),
    [status, setStatus] = createSignal(workflowStatus()),
    [error, setError] = createSignal(''),
    [output, setOutput] = createSignal(''),
    [busy, setBusy] = createSignal(false);
  const timer = setInterval(() => setStatus(workflowStatus()), 1000);
  onCleanup(() => clearInterval(timer));
  const draft = () => JSON.parse(config());
  const workflow = () => validateWorkflow(draft());
  const edit = fn => {
    const value = draft();
    fn(value);
    setConfig(JSON.stringify(value, null, 2));
  };
  const editStep = (index, key, value) => edit(w => {
    w.steps[index][key] = value;
  });
  const download = (bytes, name, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type })),
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
      setStatus(workflowStatus());
    } catch {
      setError(t('workflows.failed'));
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    const paths = await openFileDialog(['pdf'], { multiple: true });
    if (!paths) return;
    await workflowRequest({
      action: 'run',
      paths: Array.isArray(paths) ? paths : [paths],
      workflow: workflow(),
      output: output()
    });
  }
  return <Dialog
    title={t('workflows.title')}
    onClose={() => closeDialog('document-workflows')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog document-workflows-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('document-workflows')}>
      {t('workflows.close')}
    </button>}
  >
    <p>{t('workflows.help')}</p>
    <p>{t('workflows.limits')}</p>
    <label>
      {t('workflows.saved')}
      <select onChange={e => {
        const w = status().saved.find(w => w.name === e.target.value);
        if (w) setConfig(JSON.stringify(w, null, 2));
      }}>
        <option value="">—</option>
        <For each={status().saved}>{w => <option value={w.name}>{w.name}</option>}</For>
      </select>
    </label>
    <label>
      {t('workflows.name')}
      <input type="text" value={draft().name} onChange={e => edit(w => {
        w.name = e.target.value;
      })} />
    </label>
    <label>
      {t('workflows.suffix')}
      <input type="text" value={draft().suffix} onChange={e => edit(w => {
        w.suffix = e.target.value;
      })} />
    </label>
    <For each={draft().steps}>
      {(step, index) => <fieldset>
        <legend>{index() + 1}. {t(`workflows.${step.type}`)}</legend>
        <Show when={step.type === 'rotate'}>
          <label>
            {t('workflows.angle')}
            <select value={step.angle} onChange={e => editStep(index(), 'angle', leesGetal(e.target.value))}>
              <For each={[0, 90, 180, 270]}>{angle => <option value={angle}>{angle}°</option>}</For>
            </select>
          </label>
        </Show>
        <Show when={step.type === 'cropMargins'}>
          <For each={['left', 'right', 'top', 'bottom']}>
            {key => <label>
              {t(`workflows.${key}`)}
              <input
                type="text"
                inputmode="decimal"
                data-getal="decimaal"
                value={step[key]}
                onChange={e => editStep(index(), key, leesGetal(e.target.value))}
              />
            </label>}
          </For>
        </Show>
        <Show when={step.type === 'metadata'}>
          <For each={['title', 'author', 'subject']}>
            {key => <label>
              {t(`workflows.field_${key}`)}
              <input type="text" value={step[key]} onChange={e => editStep(index(), key, e.target.value)} />
            </label>}
          </For>
        </Show>
        <button
          class="pref-btn"
          disabled={index() === 0}
          onClick={() => edit(w => {
            [w.steps[index() - 1], w.steps[index()]] = [w.steps[index()], w.steps[index() - 1]];
          })}
        >
          {t('workflows.up')}
        </button>
        <button
          class="pref-btn"
          disabled={draft().steps.length === 1}
          onClick={() => edit(w => w.steps.splice(index(), 1))}
        >
          {t('workflows.remove')}
        </button>
      </fieldset>}
    </For>
    <For each={defaultWorkflow().steps}>
      {step => <button
        class="pref-btn"
        disabled={draft().steps.length >= 30}
        onClick={() => edit(w => w.steps.push({ ...step }))}
      >{t('workflows.add')}: {t(`workflows.${step.type}`)}</button>}
    </For>
    <div>
      <button
        class="pref-btn"
        disabled={busy()}
        onClick={() => act(() => workflowRequest({ action: 'save', workflow: workflow() }))}
      >
        {t('workflows.save')}
      </button>
      <button
        class="pref-btn"
        onClick={() => act(() => download(JSON.stringify(workflow(), null, 2), 'workflow.json', 'application/json'))}
      >
        {t('workflows.export')}
      </button>
      <label>
        {t('workflows.importLabel')}
        <input
          type="file"
          accept=".json"
          onChange={e => {
            const file = e.target.files[0];
            if (file) act(async () => {
              if (file.size > 100000) throw Error();
              setConfig(JSON.stringify(validateWorkflow(JSON.parse(await file.text())), null, 2));
            });
          }}
        />
      </label>
    </div>
    <label>
      {t('workflows.sample')}
      <input
        type="file"
        accept=".pdf"
        disabled={busy()}
        onChange={e => {
          const file = e.target.files[0];
          if (file) act(async () => download(await processWorkflow(new Uint8Array(await file.arrayBuffer()), workflow()), 'workflow-preview.pdf', 'application/pdf'));
        }}
      />
    </label>
    <p>{t('workflows.output')}: {output() || '—'} <button
        class="pref-btn"
        disabled={!isTauri() || busy()}
        onClick={() => act(async () => {
          const path = await openFolderDialog(t('workflows.output'));
          if (path) setOutput(path);
        })}
      >
        {t('workflows.choose')}
      </button></p>
    <button
      class="pref-btn"
      disabled={!isTauri() || busy() || status().running || !output()}
      onClick={() => act(run)}
    >
      {t('workflows.run')}
    </button>
    <button
      class="pref-btn"
      disabled={!isTauri() || busy() || status().watch || !output()}
      onClick={() => act(async () => {
        const input = await openFolderDialog(t('workflows.input'));
        if (input) await workflowRequest({ action: 'watch', input, output: output(), workflow: workflow() });
      })}
    >
      {t('workflows.watch')}
    </button>
    <button
      class="pref-btn"
      disabled={!status().running && !status().watch}
      onClick={() => act(() => workflowRequest({ action: 'stop' }))}
    >
      {t('workflows.stop')}
    </button>
    <p role="status">
      {error()}
      {status().watch ? `${t('workflows.watching')}: ${status().watch.input} ${status().watch.error || ''}` : ''}
    </p>
    <ul>
      <For each={status().results.slice(-20).reverse()}>
        {r => <li>{r.path}: {r.status} {r.code || ''} {r.step === null ? '' : `(${r.step + 1})`}</li>}
      </For>
    </ul>
  </Dialog>;
}
