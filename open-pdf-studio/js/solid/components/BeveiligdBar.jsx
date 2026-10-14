import { Show } from 'solid-js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { isBeveiligdDocument } from '../../pdf/wachtwoord-pdf.js';

/**
 * Infobalk voor een PDF die met een wachtwoord is geopend: het document is
 * alleen-lezen en blijft dat (geen "Bewerken inschakelen" zoals bij PDF/A).
 * Volgt het actieve tabblad vanzelf; het kruisje verbergt de balk alleen voor
 * dit tabblad.
 */
export default function BeveiligdBar() {
  const { t } = useTranslation('statusbar');
  const { t: tCommon } = useTranslation('common');
  const doc = () => state.documents[state.activeDocumentIndex];
  const zichtbaar = () => {
    const d = doc();
    return !!d && isBeveiligdDocument(d) && !!d.pdfDoc && !d._beveiligdBalkVerborgen;
  };

  return (
    <Show when={zichtbaar()}>
      <div class="pdfa-bar beveiligd-bar" role="status">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7h1zm1 0h4V5a2 2 0 0 0-4 0v2zm1.5 2.5v2h1v-2h-1z" fill="currentColor"/>
        </svg>
        <span>{t('passwordProtectedBar')}</span>
        <button
          class="pdfa-bar-close"
          title={tCommon('close')}
          onClick={() => { const d = doc(); if (d) d._beveiligdBalkVerborgen = true; }}
        >&times;</button>
      </div>
    </Show>
  );
}
