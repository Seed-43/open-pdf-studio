import { createSignal, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { schrijfOpslag } from '../../../core/opslag.js';

export default function UpdateDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [downloading, setDownloading] = createSignal(false);
  const [progressPct, setProgressPct] = createSignal(0);
  const [progressText, setProgressText] = createSignal(`${t('update.downloading')} 0%`);
  const [installBtnText, setInstallBtnText] = createSignal(t('update.downloadInstall'));
  const [installDisabled, setInstallDisabled] = createSignal(false);
  const [showSkip, setShowSkip] = createSignal(true);
  const [showLater, setShowLater] = createSignal(true);

  const update = () => props.data?.update;
  const currentVersion = () => update()?.currentVersion || '-';
  const newVersion = () => update()?.version || 'Unknown';
  const releaseNotes = () => update()?.body || t('update.noReleaseNotes');

  const close = () => closeDialog('update');

  function handleSkip() {
    const ver = newVersion();
    if (ver && ver !== '-' && ver !== 'Unknown') {
      try { schrijfOpslag('openpdfstudio-skip-version', ver); } catch { /* vraagt de volgende keer opnieuw */ }
    }
    close();
  }

  function handleLater() {
    close();
  }

  async function handleInstall() {
    const upd = update();
    if (!upd) return;

    setDownloading(true);
    setInstallDisabled(true);
    setInstallBtnText(t('update.downloading'));
    setShowSkip(false);
    setShowLater(false);
    setProgressPct(0);
    setProgressText(`${t('update.downloading')} 0%`);

    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await upd.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data?.contentLength || 0;
          downloadedBytes = 0;
          if (totalBytes > 0) {
            const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
            setProgressText(`${t('update.downloading')} 0% of ${totalMB} MB`);
          }
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data?.chunkLength || 0;
          if (totalBytes > 0) {
            const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setProgressPct(pct);
            const dlMB = (downloadedBytes / 1024 / 1024).toFixed(1);
            const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
            setProgressText(t('update.downloadingProgress', { percent: pct, current: dlMB, total: totalMB }));
          }
        } else if (event.event === 'Finished') {
          setProgressPct(100);
          setProgressText(t('update.downloadComplete'));
          setInstallBtnText(t('update.installing'));
        }
      });

      setProgressText(t('update.restarting'));
      await relaunch();
    } catch (e) {
      console.error('Update install failed:', e);
      setProgressText(`${t('update.updateFailed')} ${e.message || e}`);
      setInstallDisabled(false);
      setInstallBtnText(tCommon('retry'));
      setShowLater(true);
    }
  }

  const footer = (
    <div class="update-footer">
      <Show when={showSkip()}>
        <button class="update-btn update-btn-secondary" onClick={handleSkip}>
          {t('update.skipThisVersion')}
        </button>
      </Show>
      <div class="update-footer-right">
        <Show when={showLater()}>
          <button class="update-btn update-btn-secondary" onClick={handleLater}>
            {t('update.remindMeLater')}
          </button>
        </Show>
        <button
          class="update-btn update-btn-primary"
          disabled={installDisabled()}
          onClick={handleInstall}
        >
          {installBtnText()}
        </button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t('update.title')}
      overlayClass="update-overlay"
      dialogClass="update-dialog"
      headerClass="update-header"
      bodyClass="update-body"
      footerClass=""
      onClose={close}
      footer={footer}
    >
      <div class="update-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0078d7" stroke-width="1.5">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </div>
      <div class="update-info">
        <p class="update-message">{t('update.newVersionAvailable')}</p>
        <div class="update-versions">
          <div class="update-version-row">
            <span class="update-version-label">{t('update.currentVersion')}</span>
            <span class="update-version-value">{currentVersion()}</span>
          </div>
          <div class="update-version-row">
            <span class="update-version-label">{t('update.newVersion')}</span>
            <span class="update-version-value update-version-new">{newVersion()}</span>
          </div>
        </div>
        <div class="update-notes-section">
          <label class="update-notes-label">{t('update.releaseNotes')}</label>
          <div class="update-notes">{releaseNotes()}</div>
        </div>
      </div>
      <Show when={downloading()}>
        <div class="update-progress-section">
          <div class="update-progress-bar-track">
            <div
              class="update-progress-bar-fill"
              style={{ width: progressPct() + '%' }}
            />
          </div>
          <span class="update-progress-text">{progressText()}</span>
        </div>
      </Show>
    </Dialog>
  );
}
