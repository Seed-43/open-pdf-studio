import { createSignal, For, Index, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { openDialog, closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import {
  pickPageRegion, readRegion, readRegionsOnAllPages, buildLabelFromTemplate, setPageLabels, pageLabelFor,
} from '../../../pdf/page-labels.js';

// Page label builder: the user types the label in one
// field, and "Select" drops an {OCR1}, {OCR2}... placeholder at the cursor for
// text picked on the page (read from the same spot on every page). State lives
// at module level so it survives the dialog closing while a region is dragged.
const [template, setTemplate] = createSignal('');
const [regions, setRegions] = createSignal([]); // [{ n, rect, page, sample }]
const [useOcr, setUseOcr] = createSignal(true);
const [rows, setRows] = createSignal([]);       // [{ page, texts, ocr, label, edited }]
const [progress, setProgress] = createSignal(null);
let docId = null;
let cancelled = false;
let nextN = 1;
let caret = null; // cursor position in the template field when Select was pressed

const activeDoc = () => state.documents[state.activeDocumentIndex];

function resetForDoc(doc) {
  if (doc?.id === docId) return;
  docId = doc?.id ?? null;
  setTemplate('');
  setRegions([]);
  setRows([]);
  setProgress(null);
  nextN = 1;
}

const sampleTexts = () => Object.fromEntries(regions().map(r => [r.n, r.sample]));
const example = () => buildLabelFromTemplate(template(), sampleTexts());

function relabel() {
  setRows(rs => rs.map(r => (r.edited ? r : { ...r, label: buildLabelFromTemplate(template(), r.texts) })));
}

export default function PageLabelsDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const tx = (key, fallback, opts) => t(`pageLabels.${key}`, { defaultValue: fallback, ...opts });
  let fieldRef;

  resetForDoc(activeDoc());

  const close = () => { cancelled = true; closeDialog('pageLabels'); };

  async function select() {
    caret = fieldRef ? [fieldRef.selectionStart, fieldRef.selectionEnd] : null;
    closeDialog('pageLabels');
    const res = await pickPageRegion(tx('pickHint', 'Drag a box around the text to use (e.g. the sheet number). Esc to cancel.'));
    if (res) {
      const doc = activeDoc();
      const { text } = doc ? await readRegion(doc, res.page, res.rect, useOcr()) : { text: '' };
      const n = nextN++;
      setRegions(r => [...r, { n, rect: res.rect, page: res.page, sample: text }]);
      // Insert the placeholder where the cursor was (end of field otherwise).
      const tpl = template();
      const token = `{OCR${n}}`;
      const [a, b] = caret && caret[0] != null ? caret : [tpl.length, tpl.length];
      setTemplate(tpl.slice(0, a) + token + tpl.slice(b));
      setRows([]);
    }
    openDialog('pageLabels');
  }

  function removeRegion(n) {
    setRegions(r => r.filter(x => x.n !== n));
    setTemplate(tpl => tpl.replace(new RegExp(`\\{OCR${n}\\}`, 'gi'), ''));
    setRows([]);
  }

  async function readAll() {
    const doc = activeDoc();
    if (!doc?.pdfDoc || !regions().length) return;
    cancelled = false;
    setProgress({ done: 0, total: doc.pdfDoc.numPages });
    const result = await readRegionsOnAllPages(doc, regions(), {
      useOcr: useOcr(),
      isCancelled: () => cancelled,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setProgress(null);
    setRows(result.map(r => ({ ...r, edited: false, label: buildLabelFromTemplate(template(), r.texts) })));
  }

  function apply() {
    const doc = activeDoc();
    if (!doc) return;
    const labels = Array.from({ length: doc.pdfDoc.numPages }, (_, i) => pageLabelFor(doc, i + 1));
    for (const r of rows()) if (r.label) labels[r.page - 1] = r.label;
    setPageLabels(doc, labels);
    closeDialog('pageLabels');
  }

  function resetToNumbers() {
    const doc = activeDoc();
    if (!doc) return;
    setPageLabels(doc, null);
    setRows([]);
    closeDialog('pageLabels');
  }

  const footer = (
    <div class="page-labels-footer">
      <button onClick={resetToNumbers}>{tx('reset', 'Reset to page numbers')}</button>
      <span style={{ flex: 1 }} />
      <button class="primary" disabled={!rows().length} onClick={apply}>{tx('apply', 'Apply')}</button>
      <button onClick={close}>{tCommon('cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={tx('title', 'Page labels')}
      overlayClass="page-labels-overlay"
      dialogClass="page-labels-dialog"
      bodyClass="page-labels-body"
      onClose={close}
      footer={footer}
    >
      <p class="page-labels-intro">
        {tx('intro3', 'Type the page name in the field. Press Select to pick text on the page: it is inserted as {OCR1}, {OCR2}... and read from the same spot on every page. Example: {OCR1} - {OCR2}')}
      </p>

      <div class="page-labels-fieldrow">
        <input
          ref={fieldRef}
          class="page-labels-field"
          type="text"
          value={template()}
          placeholder="{OCR1} - {OCR2}"
          onInput={(e) => { setTemplate(e.currentTarget.value); relabel(); }}
        />
        <button class="page-labels-add" onClick={select}>{tx('select', 'Select')}</button>
      </div>

      <Show when={regions().length}>
        <div class="page-labels-regions">
          <For each={regions()}>
            {(reg) => (
              <div class="page-labels-region">
                <span class="page-labels-token">{`{OCR${reg.n}}`}</span>
                <span class="page-labels-sample">{reg.sample || tx('noText', '(no text found)')}</span>
                <span class="page-labels-region-page">{tx('chipTitle', 'Selected on page {{page}}', { page: reg.page })}</span>
                <button class="page-labels-chip-x" title={tx('remove', 'Remove')} onClick={() => removeRegion(reg.n)}>×</button>
              </div>
            )}
          </For>
        </div>
        <div class="page-labels-example">{tx('example', 'Example')}: <b>{example() || '-'}</b></div>
      </Show>

      <label class="page-labels-check">
        <input type="checkbox" checked={useOcr()} onChange={(e) => setUseOcr(e.currentTarget.checked)} />
        {tx('useOcr', 'Use OCR where the page has no text (scanned sheets, slower)')}
      </label>

      <div class="page-labels-actions">
        <button
          class="primary"
          disabled={!!progress() || !regions().length}
          onClick={readAll}
        >{tx('read', 'Read all pages')}</button>
        <Show when={progress()}>
          <span class="page-labels-progress">
            {tx('reading', 'Reading page {{done}} of {{total}}...', { done: Math.min(progress().done + 1, progress().total), total: progress().total })}
          </span>
          <button onClick={() => { cancelled = true; }}>{tCommon('cancel')}</button>
        </Show>
      </div>

      <Show when={rows().length}>
        <div class="page-labels-table-wrap">
          <table class="page-labels-table">
            <thead>
              <tr>
                <th>{tx('colPage', 'Page')}</th>
                <th>{tx('colLabel', 'Page label')}</th>
              </tr>
            </thead>
            <tbody>
              <Index each={rows()}>
                {(row) => (
                  <tr classList={{ empty: !row().label, ocr: row().ocr }}>
                    <td>{row().page}</td>
                    <td>
                      <input
                        type="text"
                        value={row().label}
                        placeholder={String(row().page)}
                        onInput={(e) => {
                          const v = e.currentTarget.value;
                          setRows(rs => rs.map(r => (r.page === row().page ? { ...r, label: v, edited: true } : r)));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </div>
        <div class="page-labels-legend">{tx('legend', 'Rows read with OCR are marked; check them before applying.')}</div>
      </Show>
    </Dialog>
  );
}
