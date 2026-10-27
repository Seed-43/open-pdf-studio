// De brug naar de gastpagina (core/host-brug.js, #694) aan de app koppelen.
//
// Alleen de gehoste bouw roept dit aan, als eerste stap van de opstart
// (main.js), zodat `window.__OPDS_HOST__` er staat vóór iets het opslagcontract
// leest. Zonder `#ouder=…` in een iframe, of met een contract van de
// gastpagina zelf, gebeurt er niets.

import i18next from '../i18n/config.js';
import { showMessage } from '../solid/stores/dialogStore.js';
import { installeerHostBrug, opslaanMelding } from './host-brug.js';

/** @returns {object|null} de brug, of null als hij niet nodig of niet toegestaan is */
export function startHostBrug(venster = window) {
  // Per bestand één keer melden dat het niet voor ons vastgezet is (#704).
  const nietVastGemeld = new Set();
  try {
    return installeerHostBrug({
      venster,
      vertaal: (sleutel, opties) => i18next.t(sleutel, opties),
      bijGeenContact: (fout) => {
        console.warn('[brug]', fout?.message);
        showMessage(i18next.t('hostNoContact'));
      },
      // Een conflict of een melding van de gastpagina na het opslaan: de
      // gebruiker hoort waar zijn versie staat; er gaat niets verloren.
      bijOpslaan: (uitkomst) => {
        const tekst = opslaanMelding(uitkomst, (s, o) => i18next.t(s, o), nietVastGemeld);
        if (tekst) showMessage(tekst);
      },
    });
  } catch (e) {
    console.warn('[brug] niet gestart:', e);
    return null;
  }
}
