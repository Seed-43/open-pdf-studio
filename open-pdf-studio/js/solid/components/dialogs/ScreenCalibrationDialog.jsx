import { createSignal, createMemo, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation, localizeNumber } from '../../../i18n/useTranslation.js';
import {
  REFERENTIES, CSS_PX_PER_INCH, MIN_PX_PER_INCH, MAX_PX_PER_INCH,
  geldigePxPerInch, mmNaarSchermPx, pxPerInchUitLengte,
} from '../../../pdf/schermkalibratie.js';

// Schermkalibratie (issue #520). De gebruiker houdt een betaalpas of liniaal
// tegen het scherm en stelt de balk bij tot hij even lang is, of meet de balk
// op en typt de gemeten lengte. Het resultaat (CSS-pixels per inch) gaat via
// props.data.onApply terug naar het voorkeurenvenster; pas Opslaan daar legt
// het vast.

const NAAM = 'screen-calibration';
const STAP = 0.25;

const LABEL_SLEUTEL = {
  card: 'screenCalibration.referenceCard',
  ruler50: 'screenCalibration.referenceRuler50',
  ruler100: 'screenCalibration.referenceRuler100',
};

export default function ScreenCalibrationDialog(props) {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const data = props.data || {};
  const dpr = Number(data.dpr) > 0 ? Number(data.dpr) : (window.devicePixelRatio || 1);

  const [ppi, setPpi] = createSignal(geldigePxPerInch(data.pxPerInch) ?? CSS_PX_PER_INCH);
  const [referentie, setReferentie] = createSignal('card');
  const [gemeten, setGemeten] = createSignal('');

  const refMm = createMemo(() => (REFERENTIES.find((r) => r.id === referentie()) || REFERENTIES[0]).mm);
  const balkPx = createMemo(() => mmNaarSchermPx(refMm(), ppi()));
  // Streepjes om de 5 mm; om de 10 mm een lange.
  const streepjes = createMemo(() => {
    const uit = [];
    for (let mm = 0; mm <= refMm() + 1e-9; mm += 5) uit.push({ mm, lang: mm % 10 === 0 });
    return uit;
  });

  function zet(waarde) {
    const n = Math.min(MAX_PX_PER_INCH, Math.max(MIN_PX_PER_INCH, Number(waarde)));
    if (Number.isFinite(n)) setPpi(Math.round(n * 100) / 100);
  }

  function pasMetingToe() {
    const uit = pxPerInchUitLengte(balkPx(), gemeten());
    if (uit != null) {
      setPpi(uit);
      setGemeten('');
    }
  }

  function annuleer() {
    closeDialog(NAAM);
  }

  function ok() {
    const waarde = geldigePxPerInch(ppi());
    closeDialog(NAAM);
    if (waarde != null) data.onApply?.(waarde);
  }

  const knopStijl = 'min-width:0;padding:2px 8px';

  return (
    <Dialog
      title={t('screenCalibration.title')}
      dialogClass="screen-calibration-dialog"
      onClose={annuleer}
      footer={
        <div class="pref-footer-right" style="margin-left:auto">
          <button class="pref-btn pref-btn-secondary" onClick={annuleer}>{tCommon('cancel')}</button>
          <button class="pref-btn pref-btn-primary" onClick={ok}>{tCommon('ok')}</button>
        </div>
      }
    >
      <div class="screen-cal-body">
        <p class="screen-cal-text">{t('screenCalibration.instructions')}</p>

        <div class="screen-cal-row">
          <label>{t('screenCalibration.reference')}</label>
          <PrefSelect
            value={referentie}
            setValue={setReferentie}
            options={REFERENTIES.map((r) => ({ value: r.id, label: t(LABEL_SLEUTEL[r.id]) }))}
            style={{ width: '220px' }}
          />
        </div>

        {/* De balk: precies refMm millimeter lang als de kalibratie klopt. */}
        <div class="screen-cal-ruler-wrap">
          <div class="screen-cal-ruler" style={{ width: `${balkPx()}px` }}>
            <For each={streepjes()}>
              {(s) => (
                <span
                  class="screen-cal-tick"
                  classList={{ long: s.lang }}
                  style={{ left: `${mmNaarSchermPx(s.mm, ppi())}px` }}
                />
              )}
            </For>
          </div>
        </div>

        <div class="screen-cal-row">
          <label>{t('screenCalibration.size')}</label>
          <button class="pref-btn pref-btn-secondary" style={knopStijl}
            title={t('screenCalibration.smaller')} onClick={() => zet(ppi() - STAP)}>-</button>
          <input
            type="range"
            class="screen-cal-slider"
            min={MIN_PX_PER_INCH} max={MAX_PX_PER_INCH} step={STAP}
            value={ppi()}
            onInput={(e) => zet(e.target.value)}
          />
          <button class="pref-btn pref-btn-secondary" style={knopStijl}
            title={t('screenCalibration.larger')} onClick={() => zet(ppi() + STAP)}>+</button>
          <input
            type="number"
            class="screen-cal-number"
            min={MIN_PX_PER_INCH} max={MAX_PX_PER_INCH} step={STAP}
            value={ppi()}
            onChange={(e) => zet(e.target.value)}
          />
          <span>{t('screenCalibration.pxPerInch')}</span>
        </div>

        <div class="screen-cal-row">
          <label>{t('screenCalibration.measuredLength')}</label>
          <input
            type="text"
            class="screen-cal-number"
            value={gemeten()}
            placeholder={localizeNumber(refMm())}
            onInput={(e) => setGemeten(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pasMetingToe(); } }}
          />
          <span>mm</span>
          <button class="pref-btn pref-btn-secondary" style="min-width:0"
            disabled={pxPerInchUitLengte(balkPx(), gemeten()) == null}
            onClick={pasMetingToe}>{t('screenCalibration.apply')}</button>
        </div>

        <p class="screen-cal-text screen-cal-note">
          {t('screenCalibration.displayScale', { scale: Math.round(dpr * 100) })}
        </p>
      </div>
    </Dialog>
  );
}
