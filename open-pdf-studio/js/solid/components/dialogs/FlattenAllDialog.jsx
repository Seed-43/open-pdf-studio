import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Alles vlakken (#615): bevestigen en kiezen of terughalen mogelijk blijft.
// Het basisvenster (Dialog) is verplaatsbaar en sluit niet bij een klik ernaast.
export default function FlattenAllDialog(props) {
  const data = props.data || {};
  const { t } = useTranslation('ribbon');
  const [herstelbaar, setHerstelbaar] = createSignal(true);

  const sluit = (uitkomst) => {
    closeDialog('flatten-all');
    data.resolve?.(uitkomst);
  };

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" id="flatten-all-ok"
        onClick={() => sluit({ ok: true, herstelbaar: herstelbaar() })}>{t('flattenAll.ok')}</button>
      <button class="pref-btn pref-btn-secondary" id="flatten-all-cancel"
        onClick={() => sluit({ ok: false })}>{t('annotationLayers.cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('flattenAll.title')}
      dialogClass="flatten-all-dialog"
      onClose={() => sluit({ ok: false })}
      footer={footer}
    >
      <div class="flatten-all-body">
        <p>{t('flattenAll.message', { count: data.count ?? 0 })}</p>
        <label class="flatten-all-choice">
          <input type="checkbox" id="flatten-allow-unflatten" checked={herstelbaar()}
            onChange={(e) => setHerstelbaar(e.currentTarget.checked)} />
          <span>{t('flattenAll.allowUnflatten')}</span>
        </label>
        <p class="flatten-all-hint">
          <Show when={herstelbaar()} fallback={t('flattenAll.noUnflattenHint')}>
            {t('flattenAll.allowUnflattenHint')}
          </Show>
        </p>
        <p class="flatten-all-hint">{t('flattenAll.saveNote')}</p>
      </div>
    </Dialog>
  );
}
