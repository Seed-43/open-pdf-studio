import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function CropMarginsDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const totalPages = props.data?.totalPages || 1;
  const currentPage = props.data?.currentPage || 1;

  const [applyTo, setApplyTo] = createSignal('current');
  const [rangeStr, setRangeStr] = createSignal('');
  const [padding, setPadding] = createSignal(0);
  const [threshold, setThreshold] = createSignal(250);

  const close = () => closeDialog('crop-margins');

  const handleCrop = async () => {
    const applyToVal = applyTo();
    const rangeVal = rangeStr();
    const paddingMm = Math.max(0, Math.min(50, padding()));
    const thresholdVal = threshold();

    close();

    const { cropMargins } = await import('../../../pdf/crop-margins.js');
    const result = await cropMargins(applyToVal, rangeVal, paddingMm, thresholdVal);

    if (result.cropped === 0 && result.skipped > 0) {
      showMessage(t('cropMargins.noContent'));
    } else if (result.skipped > 0) {
      showMessage(t('cropMargins.resultWithSkipped', { cropped: result.cropped, skipped: result.skipped }));
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleCrop}>{tCommon('crop')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('cropMargins.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('cropMargins.applyTo')}</label>
          <select
            class="crop-margins-select"
            value={applyTo()}
            onChange={(e) => setApplyTo(e.target.value)}
          >
            <option value="current">{t('cropMargins.currentPage')}</option>
            <option value="all">{t('cropMargins.allPages')}</option>
            <option value="range">{t('cropMargins.pageRange')}</option>
          </select>
        </div>
        <Show when={applyTo() === 'range'}>
          <div class="crop-margins-row">
            <label class="crop-margins-label">{t('cropMargins.pages')}</label>
            <input
              type="text"
              class="crop-margins-input-wide"
              placeholder={t('cropMargins.pagesPlaceholder')}
              value={rangeStr()}
              onInput={(e) => setRangeStr(e.target.value)}
            />
          </div>
        </Show>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('cropMargins.padding')}</label>
          <input
            type="text" inputmode="decimal" data-getal
            class="crop-margins-input"
            value={padding()}
            min="0"
            max="50"
            step="1"
            onInput={(e) => setPadding(parseInt(e.target.value) || 0)}
          />
        </div>
        <div class="crop-margins-row">
          <label class="crop-margins-label">{t('cropMargins.threshold')}</label>
          <input
            type="range"
            class="crop-margins-slider"
            min="200"
            max="255"
            value={threshold()}
            onInput={(e) => setThreshold(parseInt(e.target.value))}
          />
          <span class="crop-margins-threshold-value">{threshold()}</span>
        </div>
        <div class="crop-margins-info">
          {t('cropMargins.info', { count: totalPages })}
        </div>
      </div>
    </Dialog>
  );
}
