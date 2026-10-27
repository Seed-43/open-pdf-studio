import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { listOcrReview, updateOcrReview } from '../../../pdf/ocr-review-service.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const PAGE_SIZE = 100;

export default function OcrReviewDialog(props) {
  const { t } = useTranslation('dialogs');
  const documentId = props.data?.documentId;
  const [queue, setQueue] = createSignal(null);
  const [cursor, setCursor] = createSignal(0);
  const [threshold, setThreshold] = createSignal(80);
  const [text, setText] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [canvas, setCanvas] = createSignal(null);
  let generation = 0;
  onCleanup(() => { generation++; });

  const current = () => queue()?.words[cursor()];
  const failure = (e) => (e?.message === 'OCR_REVIEW_TEXT_NOT_ENCODABLE'
    ? t('ocrReview.notEncodable', { characters: (e.characters || []).join(' ') })
    : `${t('ocrReview.error')} (${e?.message})`);

  const load = async (offset = 0, index = 0) => {
    const g = ++generation;
    setBusy(true);
    setError('');
    try {
      const q = await listOcrReview(documentId, threshold(), { offset, limit: PAGE_SIZE });
      if (g === generation) {
        setQueue(q);
        setCursor(Math.min(index, Math.max(0, q.words.length - 1)));
      }
    } catch (e) {
      if (g === generation) setError(failure(e));
    } finally {
      if (g === generation) setBusy(false);
    }
  };
  void load();

  const step = async (direction) => {
    const q = queue();
    if (!q) return;
    const next = cursor() + direction;
    if (next >= 0 && next < q.words.length) setCursor(next);
    else if (direction > 0 && q.offset + q.words.length < q.total) await load(q.offset + q.words.length, 0);
    else if (direction < 0 && q.offset > 0) await load(Math.max(0, q.offset - PAGE_SIZE), PAGE_SIZE - 1);
  };

  const apply = async (action) => {
    const w = current();
    const q = queue();
    if (!w || w.archived || busy()) return;
    setBusy(true);
    setError('');
    try {
      const next = await updateOcrReview({
        action,
        documentId,
        revision: q.revision,
        page: w.page,
        index: w.index,
        expectedText: w.text,
        text: text(),
        threshold: threshold(),
        offset: q.offset,
        limit: q.limit,
      });
      setQueue(next);
      await step(1);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  createEffect(() => {
    const w = current();
    const el = canvas();
    if (!w || !el) return;
    setText(w.text);
    let cancelled = false;
    let task;
    onCleanup(() => {
      cancelled = true;
      task?.cancel();
    });
    (async () => {
      const doc = getActiveDocument();
      if (doc?.id !== documentId) throw new Error('DOCUMENT_CHANGED');
      const pdf = doc.pdfDoc;
      const page = await pdf.getPage(w.page);
      if (cancelled) return;
      if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw new Error('DOCUMENT_CHANGED');
      const scale = Math.min(4, 650 / (w.width + 20), 160 / (w.height + 20));
      el.width = Math.ceil((w.width + 20) * scale);
      el.height = Math.ceil((w.height + 20) * scale);
      task = page.render({
        canvasContext: el.getContext('2d'),
        viewport: page.getViewport({ scale, rotation: 0 }),
        transform: [1, 0, 0, 1, (-w.left + 10) * scale, (-w.top + 10) * scale],
        background: 'white',
      });
      await task.promise;
    })().catch((e) => {
      if (!cancelled) setError(failure(e));
    });
  });

  const close = () => closeDialog('ocr-review');
  const locked = () => busy() || !!current()?.archived;

  return (
    <Dialog
      title={t('ocrReview.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={<button class="pref-btn" onClick={close}>{t('ocrReview.close')}</button>}
    >
      <div
        class="ocr-review"
        onKeyDown={(e) => {
          if (busy()) return;
          if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); void step(1); }
          if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); void step(-1); }
        }}
      >
        <p>{t('ocrReview.instructions')}</p>
        <label>
          {t('ocrReview.threshold')}{' '}
          <input
            type="text"
            inputmode="decimal"
            data-getal
            value={threshold()}
            disabled={busy()}
            onChange={(e) => { setThreshold(Number(e.currentTarget.value)); void load(); }}
          />
        </label>
        <Show when={queue()}>{(q) => <p>{q().reviewed}/{q().total} {t('ocrReview.reviewed')}</p>}</Show>
        <Show when={current()} fallback={<p>{t('ocrReview.empty')}</p>}>
          <p>
            {t('ocrReview.page')} {current()?.page} — {t('ocrReview.confidence')}:{' '}
            {current()?.confidence ?? t('ocrReview.unknown')} — {t(`ocrReview.${current()?.review?.status || 'pending'}`)}
          </p>
          <Show when={current()?.archived}><p>{t('ocrReview.archived')}</p></Show>
          <canvas ref={setCanvas} aria-label={t('ocrReview.crop')} style={{ 'max-width': '100%' }} />
          <input
            type="text"
            aria-label={t('ocrReview.text')}
            value={text()}
            disabled={locked()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void apply(text() === current()?.text ? 'accept' : 'correct');
              }
            }}
          />
          <div>
            <button disabled={busy()} onClick={() => step(-1)}>{t('ocrReview.previous')}</button>
            <button disabled={locked()} onClick={() => apply('accept')}>{t('ocrReview.accept')}</button>
            <button disabled={locked() || !text().trim()} onClick={() => apply('correct')}>{t('ocrReview.correct')}</button>
            <button disabled={busy()} onClick={() => step(1)}>{t('ocrReview.next')}</button>
          </div>
        </Show>
        <button disabled={busy()} onClick={() => load()}>{t('ocrReview.refresh')}</button>
        <Show when={error()}><p role="alert">{error()}</p></Show>
      </div>
    </Dialog>
  );
}
