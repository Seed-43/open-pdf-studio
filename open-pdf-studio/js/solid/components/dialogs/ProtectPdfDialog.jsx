import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { controleerWachtwoorden, STANDAARD_RECHTEN, foutMelding } from '../../../pdf/protect-pdf.js';

// De rechten in de volgorde van de dialoog: [sleutel in het rechtenobject, i18n-sleutel].
const RECHTEN = [
  ['print', 'protectPdf.allowPrint'],
  ['printHogeKwaliteit', 'protectPdf.allowPrintHigh'],
  ['kopieren', 'protectPdf.allowCopy'],
  ['wijzigen', 'protectPdf.allowEdit'],
  ['annoteren', 'protectPdf.allowAnnotate'],
  ['formulieren', 'protectPdf.allowForms'],
  ['samenstellen', 'protectPdf.allowAssemble'],
];

/**
 * "Beveiligen met wachtwoord": wachtwoorden en rechten voor een beveiligde
 * kopie van het geopende document (js/pdf/protect-pdf.js). Windows-stijl via
 * Dialog.jsx: verplaatsbaar, sluit niet bij een klik ernaast.
 */
export default function ProtectPdfDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [gebruiker, setGebruiker] = createSignal('');
  const [gebruikerHerhaald, setGebruikerHerhaald] = createSignal('');
  const [eigenaar, setEigenaar] = createSignal('');
  const [eigenaarHerhaald, setEigenaarHerhaald] = createSignal('');
  const [rechten, setRechten] = createSignal({ ...STANDAARD_RECHTEN });
  const [fout, setFout] = createSignal('');
  const [bezig, setBezig] = createSignal(false);

  const close = () => closeDialog('protect-pdf');

  const zetRecht = (sleutel, aan) => setRechten((r) => ({ ...r, [sleutel]: aan }));

  const handleApply = async () => {
    if (bezig()) return;
    const probleem = controleerWachtwoorden({
      gebruiker: gebruiker(),
      gebruikerHerhaald: gebruikerHerhaald(),
      eigenaar: eigenaar(),
      eigenaarHerhaald: eigenaarHerhaald(),
    });
    if (probleem) {
      setFout(t(probleem));
      return;
    }
    setFout('');
    setBezig(true);
    const invoer = { gebruiker: gebruiker(), eigenaar: eigenaar(), rechten: rechten() };
    // De wachtwoorden niet langer in de dialoog laten staan dan nodig.
    setGebruiker(''); setGebruikerHerhaald(''); setEigenaar(''); setEigenaarHerhaald('');
    close();
    try {
      const { maakBeveiligdeKopie } = await import('../../../pdf/protect-pdf.js');
      const r = await maakBeveiligdeKopie(invoer);
      if (r.ok) showMessage(t('protectPdf.saved', { path: r.pad }));
      else if (r.reden === 'doel-is-geopend') showMessage(t('print.targetIsOpenFile'));
      else if (r.reden === 'beveiligd') showMessage(tCommon('protectedPdfReadOnly'));
      else if (r.reden === 'mislukt') {
        // Vaste foutcode van de Rust-kant -> vertaalde melding.
        const { sleutel, opties } = foutMelding(r.fout);
        console.warn('Beveiligen mislukt:', r.fout);
        showMessage(t(sleutel, opties));
      }
    } catch (e) {
      console.warn('Beveiligen mislukt:', e?.message || e);
      showMessage(t('protectPdf.failed', { error: e?.message || String(e) }));
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="crop-margins-footer-right">
        <button class="pref-btn pref-btn-primary" id="protect-pdf-apply" disabled={bezig()} onClick={handleApply}>{t('protectPdf.apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  const wachtwoordRij = (labelKey, waarde, zet) => (
    <div class="crop-margins-row">
      <label class="crop-margins-label protect-pdf-label">{t(labelKey)}</label>
      <input
        type="password"
        class="crop-margins-input-wide"
        autocomplete="new-password"
        spellcheck={false}
        value={waarde()}
        onInput={(e) => zet(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );

  return (
    <Dialog
      title={t('protectPdf.title')}
      overlayClass="crop-margins-overlay"
      dialogClass="crop-margins-dialog protect-pdf-dialog"
      headerClass="crop-margins-header"
      bodyClass="crop-margins-content"
      footerClass="crop-margins-footer"
      onClose={close}
      footer={footer}
    >
      <div class="crop-margins-form">
        <div class="crop-margins-info">{t('protectPdf.info')}</div>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.openPassword')}</legend>
          {wachtwoordRij('protectPdf.password', gebruiker, setGebruiker)}
          {wachtwoordRij('protectPdf.repeat', gebruikerHerhaald, setGebruikerHerhaald)}
          <div class="protect-pdf-hint">{t('protectPdf.openPasswordHint')}</div>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.rightsPassword')}</legend>
          {wachtwoordRij('protectPdf.password', eigenaar, setEigenaar)}
          {wachtwoordRij('protectPdf.repeat', eigenaarHerhaald, setEigenaarHerhaald)}
          <div class="protect-pdf-hint">{t('protectPdf.rightsPasswordHint')} {t('protectPdf.rightsWarning')}</div>
        </fieldset>

        <fieldset class="pref-fieldset">
          <legend>{t('protectPdf.allow')}</legend>
          <div class="protect-pdf-rechten">
            {RECHTEN.map(([sleutel, label]) => (
              <label class="pref-checkbox-label">
                <input type="checkbox" checked={rechten()[sleutel]} onChange={(e) => zetRecht(sleutel, e.target.checked)} />
                <span>{t(label)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {fout() && <div class="protect-pdf-fout" role="alert">{fout()}</div>}
      </div>
    </Dialog>
  );
}
