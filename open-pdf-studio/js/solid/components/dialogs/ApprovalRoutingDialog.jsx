import { createSignal, createMemo, For, Show, onMount, untrack } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import { approvalState, approvalRequest, approvalDocument, approvalPackage, renderApprovalPreview, makeReceipt, verifyRequest } from '../../../approval-routing/service.js';

export default function ApprovalRoutingDialog() {
  const { t } = useTranslation('dialogs');
  const [data, setData] = createSignal({ enabled: false, requests: [] }),
    [title, setTitle] = createSignal(''),
    [revision, setRevision] = createSignal(''),
    [mode, setMode] = createSignal('sequential'),
    [expiry, setExpiry] = createSignal(''),
    [recipients, setRecipients] = createSignal([{ id: crypto.randomUUID(), name: '', email: '' }]),
    [fields, setFields] = createSignal([]),
    [id, setId] = createSignal(''),
    [page, setPage] = createSignal('1'),
    [reviewed, setReviewed] = createSignal(''),
    [replacement, setReplacement] = createSignal(''),
    [error, setError] = createSignal(''),
    [busy, setBusy] = createSignal(false),
    [received, setReceived] = createSignal(null),
    [receivedBytes, setReceivedBytes] = createSignal(null),
    [recipient, setRecipient] = createSignal(''),
    [decision, setDecision] = createSignal('approved'),
    [comment, setComment] = createSignal(''),
    [receiptConfirmed, setReceiptConfirmed] = createSignal(false);
  let previewCanvas, receiptCanvas;
  const current = createMemo(() => data().requests.find(r => r.record.id === id()));
  async function act(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
      setData(await approvalState());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  onMount(() => act(async () => {}));
  const download = (bytes, name, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type })),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const updateRecipient = (index, key, value) => setRecipients(rows => rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
  const updateField = (index, key, value) => setFields(rows => rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
  async function preview() {
    const record = current().record,
      bytes = await approvalDocument(record.id);
    await untrack(() => renderApprovalPreview(record, bytes, leesGetal(page()), previewCanvas));
    setReviewed(record.config.source.hash);
  }
  async function exportPackage() {
    const p = await approvalPackage(id());
    download(p.bytes, 'approval-package.zip', 'application/zip');
  }
  return <Dialog
    title={t('approvalRouting.title')}
    onClose={() => closeDialog('approval-routing')}
    overlayClass="crop-margins-overlay"
    dialogClass="crop-margins-dialog approval-routing-dialog"
    headerClass="crop-margins-header"
    bodyClass="crop-margins-content"
    footerClass="crop-margins-footer"
    footer={<button class="pref-btn" onClick={() => closeDialog('approval-routing')}>
      {t('approvalRouting.close')}
    </button>}
  >
    <p>{t('approvalRouting.help')}</p>
    <p>{t('approvalRouting.distinction')}</p>
    <p>{t('approvalRouting.integrity')}</p>
    <label>
      <input
        type="checkbox"
        checked={data().enabled}
        disabled={data().enabled || busy()}
        onChange={e => {
          if (e.target.checked) act(() => approvalRequest({ action: 'configure', adapter: 'local-file-v1', enabled: true }));
        }}
      />
      {t('approvalRouting.configure')}
    </label>
    <h3>{t('approvalRouting.draft')}</h3>
    <label>
      {t('approvalRouting.name')}
      <input type="text" value={title()} onInput={e => setTitle(e.target.value)} />
    </label>
    <label>
      {t('approvalRouting.revision')}
      <input type="text" value={revision()} onInput={e => setRevision(e.target.value)} />
    </label>
    <label>
      {t('approvalRouting.mode')}
      <select value={mode()} onChange={e => setMode(e.target.value)}>
        <option value="sequential">{t('approvalRouting.sequential')}</option>
        <option value="parallel">{t('approvalRouting.parallel')}</option>
      </select>
    </label>
    <label>
      {t('approvalRouting.expiry')}
      <input type="date" value={expiry()} onInput={e => setExpiry(e.target.value)} />
    </label>
    <For each={recipients()}>
      {(r, index) => <div class="approval-recipient">
        <input
          aria-label={t('approvalRouting.recipientName')}
          type="text"
          placeholder={t('approvalRouting.recipientName')}
          value={r.name}
          onChange={e => updateRecipient(index(), 'name', e.target.value)}
        />
        <input
          aria-label={t('approvalRouting.email')}
          type="email"
          placeholder={t('approvalRouting.email')}
          value={r.email}
          onChange={e => updateRecipient(index(), 'email', e.target.value)}
        />
        <button
          class="pref-btn"
          disabled={recipients().length === 1}
          onClick={() => {
            setRecipients(rows => rows.filter(x => x.id !== r.id));
            setFields(rows => rows.filter(f => f.recipientId !== r.id));
          }}
        >
          {t('approvalRouting.remove')}
        </button>
      </div>}
    </For>
    <button
      class="pref-btn"
      disabled={recipients().length >= 50}
      onClick={() => setRecipients(rows => [...rows, { id: crypto.randomUUID(), name: '', email: '' }])}
    >
      {t('approvalRouting.addRecipient')}
    </button>
    <p>{t('approvalRouting.fieldsHelp')}</p>
    <For each={fields()}>
      {(f, index) => <div class="approval-field">
        <select value={f.recipientId} onChange={e => updateField(index(), 'recipientId', e.target.value)}>
          <For each={recipients()}>{r => <option value={r.id}>{r.name || r.email}</option>}</For>
        </select>
        <input
          type="text"
          aria-label={t('approvalRouting.fieldLabel')}
          value={f.label}
          onChange={e => updateField(index(), 'label', e.target.value)}
        />
        <For each={['page', 'x', 'y', 'width', 'height']}>
          {key => <label>
            {t(`approvalRouting.${key}`)}
            <input
              type="text"
              inputmode="decimal"
              data-getal="decimaal"
              value={f[key]}
              onChange={e => updateField(index(), key, leesGetal(e.target.value))}
            />
          </label>}
        </For>
        <button class="pref-btn" onClick={() => setFields(rows => rows.filter(x => x.id !== f.id))}>
          {t('approvalRouting.remove')}
        </button>
      </div>}
    </For>
    <button
      class="pref-btn"
      onClick={() => setFields(rows => [...rows, {
        id: crypto.randomUUID(),
        recipientId: recipients()[0].id,
        label: t('approvalRouting.fieldLabel'),
        page: 1,
        x: 20,
        y: 20,
        width: 100,
        height: 40
      }])}
    >
      {t('approvalRouting.addField')}
    </button>
    <button
      class="pref-btn"
      disabled={busy() || !data().enabled}
      onClick={() => act(async () => {
        const result = await approvalRequest({
          action: 'draft',
          title: title(),
          revision: revision(),
          mode: mode(),
          expiresAt: expiry() ? new Date(expiry() + 'T23:59:59').toISOString() : null,
          recipients: recipients(),
          fields: fields()
        });
        setId(result.record.id);
        setReviewed('');
      })}
    >
      {t('approvalRouting.create')}
    </button>
    <h3>{t('approvalRouting.requests')}</h3>
    <select
      aria-label={t('approvalRouting.requests')}
      value={id()}
      onChange={e => {
        setId(e.target.value);
        setReviewed('');
        setPage('1');
        if (previewCanvas) previewCanvas.width = 0;
      }}
    >
      <option value="">—</option>
      <For each={data().requests}>
        {r => <option value={r.record.id} selected={r.record.id === id()}>{r.record.config.title} · {t(`approvalRouting.states.${r.state.status}`)}</option>}
      </For>
    </select>
    <Show when={current()?.state.integrity}>
      <p>{current()?.record.config.source.name} · {current()?.record.config.source.revision} · SHA-256: {current()?.record.config.source.hash}</p>
      <p>{t(`approvalRouting.states.${current()?.state.status}`)} · {t('approvalRouting.manual')}</p>
      <For each={current()?.record.config.recipients}>
        {r => <p>{r.name} &lt;{r.email}&gt; — {t(`approvalRouting.states.${current()?.state.receipts.find(x => x.recipientId === r.id)?.decision || 'waiting'}`)}</p>}
      </For>
      <label>
        {t('approvalRouting.page')}
        <input
          type="text"
          inputmode="decimal"
          data-getal="decimaal"
          value={page()}
          onInput={e => setPage(e.target.value)}
        />
      </label>
      <button class="pref-btn" disabled={busy()} onClick={() => act(preview)}>
        {t('approvalRouting.preview')}
      </button>
      <button
        class="pref-btn"
        disabled={busy()}
        onClick={() => act(async () => {
          download(await approvalDocument(id()), 'review-document.pdf', 'application/pdf');
          setReviewed(current().record.config.source.hash);
        })}
      >
        {t('approvalRouting.document')}
      </button>
      <canvas ref={previewCanvas} />
      <button
        class="pref-btn"
        disabled={busy() || current()?.state.status !== 'draft' || reviewed() !== current()?.record.config.source.hash}
        onClick={() => act(async () => {
          await approvalRequest({ action: 'submit', id: id(), confirmedHash: reviewed() });
          await exportPackage();
        })}
      >
        {t('approvalRouting.submit')}
      </button>
      <button
        class="pref-btn"
        disabled={busy() || current()?.state.status === 'draft'}
        onClick={() => act(exportPackage)}
      >
        {t('approvalRouting.export')}
      </button>
      <label>
        {t('approvalRouting.importReceipt')}
        <input
          type="file"
          accept=".json"
          disabled={busy()}
          onChange={e => {
            const file = e.target.files[0];
            if (file) act(async () => {
              if (file.size > 100000) throw Error('RECEIPT_LIMIT');
              await approvalRequest({ action: 'receipt', id: id(), receipt: JSON.parse(await file.text()) });
            });
          }}
        />
      </label>
      <button
        class="pref-btn"
        disabled={busy() || !['draft', 'submitted', 'in_progress'].includes(current()?.state.status)}
        onClick={() => act(() => approvalRequest({ action: 'cancel', id: id() }))}
      >
        {t('approvalRouting.cancel')}
      </button>
      <label>
        {t('approvalRouting.replacement')}
        <select value={replacement()} onChange={e => setReplacement(e.target.value)}>
          <option value="">—</option>
          <For each={data().requests.filter(r => r.record.id !== id())}>
            {r => <option value={r.record.id} selected={r.record.id === replacement()}>{r.record.config.title}</option>}
          </For>
        </select>
      </label>
      <button
        class="pref-btn"
        disabled={busy() || !replacement() || current()?.state.status === 'superseded'}
        onClick={() => act(() => approvalRequest({ action: 'supersede', id: id(), replacementId: replacement() }))}
      >
        {t('approvalRouting.supersede')}
      </button>
      <p>{t('approvalRouting.audit')}: {current()?.state.head}</p>
      <For each={current()?.record.events}>
        {event => <p>{event.at} · {t(`approvalRouting.events.${event.kind}`)} · {event.payload.receipt ? current()?.record.config.recipients.find(r => r.id === event.payload.receipt.recipientId)?.email || '—' : event.actor}</p>}
      </For>
    </Show>
    <h3>{t('approvalRouting.receipt')}</h3>
    <p>{t('approvalRouting.receiptHelp')}</p>
    <label>
      {t('approvalRouting.requestFile')}
      <input
        type="file"
        accept=".json"
        onChange={e => {
          const file = e.target.files[0];
          if (file) act(async () => {
            if (file.size > 5000000) throw Error('REQUEST_LIMIT');
            const record = JSON.parse(await file.text());
            await verifyRequest(record);
            setReceived(record);
            setRecipient('');
            setReceivedBytes(null);
            setReceiptConfirmed(false);
          });
        }}
      />
    </label>
    <label>
      {t('approvalRouting.pdfFile')}
      <input
        type="file"
        accept=".pdf"
        onChange={e => {
          const file = e.target.files[0];
          if (file) act(async () => {
            if (file.size > 50 * 1024 * 1024) throw Error('SIZE_LIMIT');
            setReceivedBytes(new Uint8Array(await file.arrayBuffer()));
            setReceiptConfirmed(false);
          });
        }}
      />
    </label>
    <Show when={received()}>
      <label>
        {t('approvalRouting.page')}
        <input
          type="text"
          inputmode="decimal"
          data-getal="decimaal"
          value={page()}
          onInput={e => setPage(e.target.value)}
        />
      </label>
      <p>{received()?.config.title} · SHA-256: {received()?.config.source.hash}</p>
      <select
        aria-label={t('approvalRouting.claimedIdentity')}
        value={recipient()}
        onChange={e => {
          setRecipient(e.target.value);
          setReceiptConfirmed(false);
        }}
      >
        <option value="">—</option>
        <For each={received()?.config.recipients}>
          {r => <option value={r.id}>{r.name} · {r.email}</option>}
        </For>
      </select>
      <select value={decision()} onChange={e => setDecision(e.target.value)}>
        <option value="approved">{t('approvalRouting.states.approved')}</option>
        <option value="rejected">{t('approvalRouting.states.rejected')}</option>
      </select>
      <textarea
        aria-label={t('approvalRouting.comment')}
        maxLength="2000"
        value={comment()}
        onInput={e => setComment(e.target.value)}
      />
      <button
        class="pref-btn"
        disabled={busy() || !receivedBytes()}
        onClick={() => act(() => renderApprovalPreview(received(), receivedBytes(), leesGetal(page()), receiptCanvas))}
      >
        {t('approvalRouting.preview')}
      </button>
      <canvas ref={receiptCanvas} />
      <label>
        <input
          type="checkbox"
          checked={receiptConfirmed()}
          onChange={e => setReceiptConfirmed(e.target.checked)}
        />
        {t('approvalRouting.confirmReceipt')}
      </label>
      <button
        class="pref-btn"
        disabled={busy() || !recipient() || !receivedBytes() || !receiptConfirmed()}
        onClick={() => act(async () => {
          const receipt = await makeReceipt(received(), receivedBytes(), recipient(), decision(), comment());
          download(JSON.stringify(receipt, null, 2), 'approval-receipt.json', 'application/json');
        })}
      >
        {t('approvalRouting.makeReceipt')}
      </button>
    </Show>
    <p role="status">{error()}</p>
  </Dialog>;
}
