import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getAppVersion } from '../../../core/platform.js';
import { openExtern } from '../../../core/extern-openen.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
// Als asset geïmporteerd: Vite zet de bouwbasis ervoor (#545).
import appIcoon from '/icon.png';

export default function AboutDialog() {
  const { t } = useTranslation('appMenu');
  const [version, setVersion] = createSignal(t('aboutPanel.version'));

  onMount(async () => {
    const v = await getAppVersion();
    if (v) setVersion(`${t('aboutPanel.version')} ${v}`);
  });

  const close = () => closeDialog('about');

  return (
    <Dialog
      title={t('aboutPanel.title')}
      dialogClass="about-dialog"
      onClose={close}
    >
      <div class="bs-about-panel">
        <div class="bs-about-app">
          <div class="bs-about-logo">
            <img src={appIcoon} alt="Open PDF Studio" />
          </div>
          <div class="bs-about-app-info">
            <h1 class="bs-about-app-name">{t('aboutPanel.appName')}</h1>
            <p class="bs-about-version">{version()}</p>
            <p class="bs-about-tagline">{t('aboutPanel.tagline')}</p>
          </div>
        </div>

        <p class="bs-about-description">
          {t('aboutPanel.description')}
        </p>

        <div class="bs-about-features">
          <div class="bs-about-feature">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>{t('aboutPanel.featureFree')}</span>
          </div>
          <div class="bs-about-feature">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span>{t('aboutPanel.featureOpen')}</span>
          </div>
          <div class="bs-about-feature">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>{t('aboutPanel.featureNoLock')}</span>
          </div>
        </div>

        <div class="bs-about-company">
          <h3 class="bs-about-company-name">{t('aboutPanel.companyName')}</h3>
          <p class="bs-about-company-desc">
            {t('aboutPanel.companyDescription')}
          </p>
        </div>

        <div class="bs-about-links">
          <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExtern('https://open-aec.com/'); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            {t('aboutPanel.website')}
          </a>
          <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExtern('https://github.com/OpenAEC-Foundation/open-pdf-studio'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExtern('mailto:maarten@open-aec.com'); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            {t('aboutPanel.contact')}
          </a>
        </div>

        <div class="bs-about-footer">
          <p class="bs-about-copyright">{t('aboutPanel.copyright')}</p>
          <p class="bs-about-license">{t('aboutPanel.license')}</p>
        </div>
      </div>
    </Dialog>
  );
}
