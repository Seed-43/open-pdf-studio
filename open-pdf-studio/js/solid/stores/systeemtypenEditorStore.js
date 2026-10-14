// De native systeemtypen-editor openen met de focus op een type (#567).
//
// Dialoog dicht: openDialog('systeemtypen', { typeId }) — de dialoog kiest dat
// type als beginselectie. Dialoog al open: niet opnieuw openen (dat zou de
// werkkopie met onbevestigde wijzigingen weggooien), maar een FOCUSSIGNAAL
// zetten; de dialoog verandert daarop alleen de selectie. Het volgnummer
// zorgt dat een herhaalde focus op hetzelfde id ook aankomt, en dat een
// dialoog die net opent geen oud signaal oppikt.
//
// Openen wacht nooit op de gebruiker, past niets toe en meldt niets.
import { createSignal } from 'solid-js';
import { openDialog, getDialogs } from './dialogStore.js';

const [focus, setFocus] = createSignal(null);
let volgnummer = 0;

/** Laatste focusverzoek: { typeId, volgnummer } of null. */
export function systeemtypenFocus() {
  return focus();
}

/** Open de editor (of focus de open editor) op `typeId`.
 *  @returns {{opened:boolean, typeId:string|undefined}} */
export function openSysteemtypenEditor({ typeId } = {}) {
  const alOpen = getDialogs().some(d => d.name === 'systeemtypen');
  volgnummer += 1;
  setFocus({ typeId, volgnummer });
  if (!alOpen) openDialog('systeemtypen', { typeId });
  return { opened: !alOpen, typeId };
}
