import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import i18next from '../../../i18n/config.js';
import { showMessage } from '../../stores/dialogStore.js';
import {
  aanbod, openHersteld, bewaarHersteldAls, verwijderHersteld, verwijderAllesHersteld, herstelLater,
} from '../../../herstel/herstel.js';

// "Niet-opgeslagen werk herstellen" (js/herstel/herstel.js). Toont wat er van
// een onverwacht afgesloten sessie bewaard is, met per document Openen,
// Opslaan als… en Verwijderen. Het venster is verplaatsbaar en sluit niet bij
// een klik ernaast (Dialog); sluiten met het kruisje of Escape is "Later".
export default function RecoveryDialog() {
  const { t } = useTranslation('dialogs');
  const [bezig, setBezig] = createSignal(null);
  const [bevestig, setBevestig] = createSignal(null); // sleutel of '*'

  const tijd = (ms) => {
    try {
      return new Date(ms).toLocaleString(i18next.language || undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(ms).toLocaleString();
    }
  };

  async function voerUit(sleutel, actie, foutSleutel) {
    setBezig(sleutel);
    try {
      await actie();
    } catch (e) {
      showMessage(t(foutSleutel, { error: e?.message || String(e) }));
    } finally {
      setBezig(null);
    }
  }

  const openen = (a) => voerUit(a.sleutel, () => openHersteld(a.sleutel), 'recovery.openFailed');
  const opslaanAls = (a) => voerUit(a.sleutel, () => bewaarHersteldAls(a.sleutel), 'recovery.saveFailed');
  const verwijderen = (a) => {
    setBevestig(null);
    return voerUit(a.sleutel, () => verwijderHersteld(a.sleutel), 'recovery.deleteFailed');
  };
  const allesVerwijderen = () => {
    setBevestig(null);
    return voerUit('*', () => verwijderAllesHersteld(), 'recovery.deleteFailed');
  };

  const footer = (
    <div class="message-dialog-footer recovery-footer">
      <Show when={bevestig() === '*'} fallback={
        <>
          <button class="pref-btn pref-btn-secondary" disabled={!!bezig()} onClick={() => setBevestig('*')}>
            {t('recovery.deleteAll')}
          </button>
          <button class="pref-btn pref-btn-primary" disabled={!!bezig()} onClick={herstelLater}>
            {t('recovery.later')}
          </button>
        </>
      }>
        <span class="recovery-confirm-text">{t('recovery.confirmDeleteAll')}</span>
        <button class="pref-btn pref-btn-secondary" onClick={allesVerwijderen}>{t('recovery.yesDelete')}</button>
        <button class="pref-btn pref-btn-primary" onClick={() => setBevestig(null)}>{t('recovery.cancel')}</button>
      </Show>
    </div>
  );

  return (
    <Dialog
      title={t('recovery.title')}
      dialogClass="recovery-dialog"
      onClose={herstelLater}
      footer={footer}
    >
      <div class="recovery-body">
        <p class="recovery-intro">{t('recovery.intro')}</p>
        <div class="recovery-list">
          <For each={aanbod()}>
            {(a) => (
              <div class="recovery-row">
                <div class="recovery-info">
                  <div class="recovery-title">{a.titel || t('recovery.untitled')}</div>
                  <div class="recovery-path" title={a.origineelPad || ''}>
                    {a.origineelPad || t('recovery.neverSaved')}
                  </div>
                  <div class="recovery-meta">
                    {t('recovery.savedAt', { time: tijd(a.tijdMs) })}
                    {' · '}
                    {t('recovery.pages', { count: a.paginas })}
                  </div>
                  <Show when={a.origineelGewijzigd}>
                    <div class="recovery-warning">{t('recovery.originalChanged')}</div>
                  </Show>
                </div>
                <div class="recovery-actions">
                  <Show when={bevestig() === a.sleutel} fallback={
                    <>
                      <button class="pref-btn pref-btn-primary" disabled={!!bezig()} onClick={() => openen(a)}>{t('recovery.open')}</button>
                      <button class="pref-btn pref-btn-secondary" disabled={!!bezig()} onClick={() => opslaanAls(a)}>{t('recovery.saveAs')}</button>
                      <button class="pref-btn pref-btn-secondary" disabled={!!bezig()} onClick={() => setBevestig(a.sleutel)}>{t('recovery.delete')}</button>
                    </>
                  }>
                    <span class="recovery-confirm-text">{t('recovery.confirmDelete')}</span>
                    <button class="pref-btn pref-btn-secondary" onClick={() => verwijderen(a)}>{t('recovery.yesDelete')}</button>
                    <button class="pref-btn pref-btn-primary" onClick={() => setBevestig(null)}>{t('recovery.cancel')}</button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
        <p class="recovery-note">{t('recovery.keepNote')}</p>
      </div>
    </Dialog>
  );
}
