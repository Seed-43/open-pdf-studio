// Iets buiten de app openen: een webadres, een mailto:-koppeling, of een
// bijlage uit een PDF. Dit is de ENIGE plek in js/ die een popup opent
// (#695); extern-openen.test.mjs bewaakt dat.
//
// Drie omgevingen, drie antwoorden:
//  - bureaublad (Tauri): de standaardbrowser of het standaardprogramma van
//    het systeem, via de shell-plug-in. Ongewijzigd.
//  - losse webversie (eigen oorsprong): een nieuw tabblad, zoals altijd.
//  - als gast (#544, #691): GEEN popup en GEEN navigatie. De gastsite zet de
//    app in een iframe met een sandbox zonder allow-popups en zonder
//    allow-top-navigation, en heeft daar goede redenen voor: een popup erft
//    het beleid van de site niet, en een HTML-bijlage als blob zou op de
//    oorsprong van de app draaien. Een link toont daarom het adres in een
//    melding, een bijlage wordt een download (<a download>, dat
//    allow-downloads toestaat).

import { isTauri, invoke } from './platform.js';
import { isGehost, GAST_MODUS } from './gehost.js';
import { slaOverInHeadless } from './headless.js';

// Vast bij het bouwen: in de gastbundel vervangt Vite import.meta.env.MODE
// door "hosted". Rollup ziet dan dat de popup-takken hieronder nooit lopen en
// laat ze weg, zodat de gastbundel geen window.open bevat. Buiten Vite (Node,
// de unit-tests) is import.meta.env er niet.
const GAST_BOUW = import.meta.env?.MODE === GAST_MODUS;

/**
 * De melding die een gast krijgt in plaats van een nieuw tabblad. Haalt
 * i18next en de dialoog pas hier op (zoals core/webfuncties.js).
 */
async function toonAdres(url) {
  const [i18n, dialogs] = await Promise.all([
    import('i18next'),
    import('../solid/stores/dialogStore.js'),
  ]);
  const t = (i18n.default || i18n).t;
  dialogs.openDialog('message', {
    title: t('hostedLinkTitle'),
    message: t('hostedLinkMessage'),
    address: String(url),
  });
}

/**
 * Open een adres buiten de app. Als gast: het adres in een melding.
 * @param {string} url
 */
export async function openExtern(url) {
  if (isTauri()) {
    // Headless: geen browser van de gebruiker naar voren halen.
    if (slaOverInHeadless(`open external ${url}`)) return;

    if (window.__TAURI__.shell) {
      try {
        await window.__TAURI__.shell.open(url);
        return;
      } catch (e) {
        console.error('Shell plugin error:', e);
      }
    }
    await invoke('open_url', { url });
    return;
  }
  if (!GAST_BOUW && !isGehost()) {
    window.open(url, '_blank');
    return;
  }
  await toonAdres(url);
}

/**
 * Bied bytes aan als download, met een gewone <a download>. Werkt in de
 * webversie en als gast (allow-downloads); er opent niets.
 * @param {string} naam  bestandsnaam van de download
 * @param {Uint8Array|ArrayBuffer|Blob} data
 * @param {string} [type]  mediatype; standaard application/octet-stream, zodat
 *   de browser het bestand nooit zelf toont
 */
export function biedDownloadAan(naam, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = naam || 'download';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Mediatypen waarmee de losse webversie een bijlage in een tabblad toont.
const BIJLAGE_TYPEN = {
  pdf: 'application/pdf', txt: 'text/plain', html: 'text/html', htm: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', json: 'application/json', xml: 'application/xml',
};

/**
 * Een bijlage "openen" buiten het bureaublad. In de losse webversie in een
 * nieuw tabblad (zoals altijd); als gast als download, met een melding dat
 * openen hier niet kan. Het bureaublad opent bijlagen zelf via een tijdelijk
 * bestand (ui/panels/attachments.js) en komt hier niet.
 * @param {string} naam
 * @param {Uint8Array} data
 * @returns {Promise<'tabblad'|'download'>}
 */
export async function biedBijlageAan(naam, data) {
  if (!GAST_BOUW && !isGehost()) {
    const ext = String(naam || '').split('.').pop().toLowerCase();
    const blob = new Blob([data], { type: BIJLAGE_TYPEN[ext] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'tabblad';
  }
  biedDownloadAan(naam, data);
  const [i18n, dialogs] = await Promise.all([
    import('i18next'),
    import('../solid/stores/dialogStore.js'),
  ]);
  const t = (i18n.default || i18n).t;
  dialogs.showMessage(t('hostedAttachmentMessage', { filename: naam }));
  return 'download';
}
