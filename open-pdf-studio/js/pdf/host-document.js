// Een document van de gastsite openen (#546).
//
// Het opslagcontract zelf staat in core/platform.js; hier zit alleen de stap
// naar een tabblad. Een document van de site opent als elk ander document:
// een tabblad met als pad `opds-host://<id>/<naam>`, zodat Opslaan (Ctrl+S)
// via writeBinaryFile() teruggaat naar de site.
//
// De site geeft een document op twee manieren mee:
//  - bij de start: `window.__OPDS_HOST__.document = '<id>'`
//  - later (een site die zelf niet herlaadt):
//      window.dispatchEvent(new CustomEvent('opds:open-document', { detail: { id } }))

import i18next from '../i18n/config.js';
import { gastObject } from '../core/gehost.js';
import { hostOpslag, openHostBestand } from '../core/platform.js';
import { createTab } from '../ui/chrome/tabs.js';
import { loadPDFIfNeeded } from './loader.js';
import { showMessage } from '../bridge.js';

export const OPEN_EVENT = 'opds:open-document';

/** Open document `id` van de site in een tabblad. */
export async function openHostDocument(id) {
  if (id === undefined || id === null || id === '') return false;
  try {
    const { pad, data } = await openHostBestand(id);
    const { index } = createTab(pad);
    await loadPDFIfNeeded(pad, index, data);
    return true;
  } catch (e) {
    console.error('[gast] document van de site niet geopend:', e);
    showMessage(i18next.t('failedToLoadPdf', { error: e?.message || String(e) }));
    return false;
  }
}

/**
 * Bij de start: het document dat de site meegeeft openen en luisteren naar
 * latere verzoeken. Zonder opslagcontract gebeurt er niets.
 * @returns {Promise<boolean>} of er een document van de site openging
 */
export async function startMetGastsite() {
  if (!hostOpslag()) return false;
  window.addEventListener(OPEN_EVENT, (e) => { openHostDocument(e?.detail?.id); });
  return openHostDocument(gastObject()?.document);
}
