// Na een automatische herlaadbeurt van het hoofdvenster (renderer-crash,
// src-tauri/src/crashlog.rs): wat komt er in het logboek en krijgt de
// gebruiker een melding?
//
// Rust herlaadt hooguit 2 keer per 5 minuten. Daarna blijft het venster zoals
// het is; komt de frontend toch weer op (bv. een handmatige herlaadbeurt), dan
// meldt ze dat er niet meer automatisch herladen wordt. Headless komt er nooit
// een melding in beeld, alleen een logregel.
//
// Vlak voor het herladen valt er niets te bewaren: het renderproces met het
// documentmodel is dan al weg. Wat terugkomt is de laatste momentopname, die
// de nieuwe sessie aanbiedt (beleid.js: eerdere sessie van dit proces = wees).

/**
 * @param {{herladen?:number, gestopt?:boolean}|null|undefined} webview  uit herstel_info
 * @param {{headless:boolean}} o
 * @returns {{log:string|null, toonMelding:boolean}}
 */
export function naHerladen(webview, { headless }) {
  const herladen = Math.max(0, Number(webview?.herladen) || 0);
  const gestopt = webview?.gestopt === true;
  const regels = [];
  if (herladen > 0) {
    regels.push(`main window was reloaded automatically after a renderer failure (${herladen}x in this process)`);
  }
  if (gestopt) {
    regels.push(`automatic reload limit reached: the window is no longer reloaded after a renderer failure${headless ? '; message suppressed (headless)' : ''}`);
  }
  return { log: regels.length ? regels.join('; ') : null, toonMelding: gestopt && !headless };
}
