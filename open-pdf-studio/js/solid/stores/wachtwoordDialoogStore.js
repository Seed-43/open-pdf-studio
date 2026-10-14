// Toestand van de wachtwoorddialoog voor PDF's met een openingswachtwoord
// (js/pdf/wachtwoord-pdf.js). De dialoog blijft open tussen pogingen: na een
// verkeerd wachtwoord toont hij de foutregel en vraagt hij opnieuw, zonder
// eerst te sluiten.
//
// Het wachtwoord zelf staat hier nergens: het gaat rechtstreeks van het
// invoerveld naar de wachtende vraag.

import { createSignal } from 'solid-js';
import { openDialog, closeDialog } from './dialogStore.js';

export const WACHTWOORD_DIALOOG = 'pdf-password';

const [bestandsnaam, setBestandsnaam] = createSignal('');
const [verkeerd, setVerkeerd] = createSignal(false);
const [bezig, setBezig] = createSignal(false);
// Telt elke nieuwe vraag: de dialoog maakt dan het veld leeg en zet de focus.
const [ronde, setRonde] = createSignal(0);

let wachtende = null;
const luisteraars = new Set();
// Eén vraag tegelijk: twee bestanden die tegelijk een wachtwoord nodig hebben
// komen na elkaar aan de beurt.
let rij = Promise.resolve();

/**
 * Voert `fn` uit met de dialoog voor zich alleen; daarna gaat hij dicht.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function metWachtwoordDialoog(fn) {
  const beurt = rij.then(async () => {
    try {
      return await fn();
    } finally {
      sluitWachtwoordDialoog();
    }
  });
  rij = beurt.catch(() => {});
  return beurt;
}

/**
 * Vraagt het wachtwoord voor `fileName`. Geeft het wachtwoord, of null als de
 * gebruiker annuleert.
 */
export function vraagWachtwoord({ fileName, verkeerd: fout = false }) {
  if (wachtende) {
    const vorige = wachtende;
    wachtende = null;
    vorige(null);
  }
  setBestandsnaam(fileName || '');
  setVerkeerd(!!fout);
  setBezig(false);
  setRonde((r) => r + 1);
  openDialog(WACHTWOORD_DIALOOG, {});
  for (const l of luisteraars) {
    try { l({ fileName }); } catch { /* een luisteraar mag de vraag niet breken */ }
  }
  return new Promise((resolve) => { wachtende = resolve; });
}

/** OK: geeft het wachtwoord aan de wachtende vraag; de dialoog blijft open. */
export function bevestigWachtwoord(wachtwoord) {
  if (!wachtende) return;
  const r = wachtende;
  wachtende = null;
  setBezig(true);
  r(String(wachtwoord ?? ''));
}

/** Annuleren of Esc: geen wachtwoord, dialoog dicht. */
export function annuleerWachtwoord() {
  const r = wachtende;
  wachtende = null;
  sluitWachtwoordDialoog();
  r?.(null);
}

export function sluitWachtwoordDialoog() {
  closeDialog(WACHTWOORD_DIALOOG);
  setBezig(false);
  setVerkeerd(false);
  if (wachtende) {
    const r = wachtende;
    wachtende = null;
    r(null);
  }
}

/** Staat er een vraag open? (MCP-brug: openen meldt dan de dialoog.) */
export function wachtwoordGevraagd() {
  return !!wachtende;
}

/** Laat weten wanneer er een wachtwoord gevraagd wordt. Geeft een afmelder. */
export function bijWachtwoordVraag(fn) {
  luisteraars.add(fn);
  return () => luisteraars.delete(fn);
}

export { bestandsnaam, verkeerd, bezig, ronde };
