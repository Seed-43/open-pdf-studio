import { createEffect, on, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  bestandsnaam, verkeerd, bezig, ronde, bevestigWachtwoord, annuleerWachtwoord,
} from '../../stores/wachtwoordDialoogStore.js';

/**
 * Vraagt het openingswachtwoord van een beveiligde PDF (js/pdf/wachtwoord-pdf.js).
 * Windows-dialoog via Dialog.jsx: verplaatsbaar, sluit niet bij een klik
 * ernaast. Enter = OK, Esc = Annuleren. Na een verkeerd wachtwoord blijft hij
 * open met een foutregel en een leeg veld.
 */
export default function PasswordDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  let invoer;

  // Elke nieuwe vraag (ook na een verkeerd wachtwoord): veld leeg, focus erin.
  createEffect(on(ronde, () => {
    if (invoer) invoer.value = '';
    requestAnimationFrame(() => invoer?.focus());
  }));

  function ok() {
    if (bezig()) return;
    const ww = invoer ? invoer.value : '';
    // Het wachtwoord niet in het veld laten staan.
    if (invoer) invoer.value = '';
    bevestigWachtwoord(ww);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      ok();
    }
  }

  const footer = (
    <div class="pdf-password-footer">
      <button class="pref-btn pref-btn-primary" id="pdf-password-ok" disabled={bezig()} onClick={ok}>{tCommon('ok')}</button>
      <button class="pref-btn pref-btn-secondary" id="pdf-password-cancel" onClick={annuleerWachtwoord}>{tCommon('cancel')}</button>
    </div>
  );

  return (
    <Dialog
      title={t('pdfPassword.title')}
      dialogClass="pdf-password-dialog"
      onClose={annuleerWachtwoord}
      footer={footer}
    >
      <div class="pdf-password-body">
        <p class="pdf-password-message">{t('pdfPassword.message', { fileName: bestandsnaam() })}</p>
        <label class="pdf-password-row">
          <span>{t('pdfPassword.label')}</span>
          <input
            ref={invoer}
            id="pdf-password-input"
            type="password"
            autocomplete="off"
            spellcheck={false}
            disabled={bezig()}
            onKeyDown={onKeyDown}
          />
        </label>
        <Show when={verkeerd()}>
          <div class="pdf-password-error" role="alert">{t('pdfPassword.wrong')}</div>
        </Show>
      </div>
    </Dialog>
  );
}
