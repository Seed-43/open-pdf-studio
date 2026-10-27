// Gekozen eenheid voor papiermaten in het eigenschappenpaneel (#598).
//
// Het signaal stuurt de weergave; state.preferences.paperSizeUnit is de
// duurzame opslag (Voorkeuren > Annotaties en de keuzelijst in het paneel
// schrijven er allebei naar). applyPreferences() zet het signaal na het laden
// en na het opslaan van de voorkeuren gelijk.

import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { normaliseerPapierEenheid, STANDAARD_PAPIER_EENHEID } from '../../annotations/papiermaat-eenheid.js';

const [papierEenheid, _zetSignaal] = createSignal(STANDAARD_PAPIER_EENHEID);

export { papierEenheid };

/** Signaal gelijkzetten met de opgeslagen voorkeur. */
export function hydratePapierEenheid() {
  _zetSignaal(normaliseerPapierEenheid(state.preferences?.paperSizeUnit));
}

/**
 * Keuze uit het paneel: alleen de weergave en de voorkeur veranderen, nooit
 * een annotatie.
 */
export function kiesPapierEenheid(eenheid) {
  const e = normaliseerPapierEenheid(eenheid);
  _zetSignaal(e);
  if (state.preferences && state.preferences.paperSizeUnit !== e) {
    state.preferences.paperSizeUnit = e;
    import('../../core/preferences.js')
      .then(m => m.savePreferences && m.savePreferences())
      .catch(() => {});
  }
}
