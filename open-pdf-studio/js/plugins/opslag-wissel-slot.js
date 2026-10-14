/**
 * Opslaan en een extensiewissel sluiten elkaar uit (#550).
 *
 * Tijdens een wissel (uitzetten, opruimen, activeren en eventueel
 * terugrollen) staat het annotatietype van een extensie even niet in het
 * register. De saver laat annotaties van een onbekend type weg, dus:
 *   - een save begint pas als er geen wissel loopt, en
 *   - een wissel begint pas als er geen save loopt.
 * Controleren en vastleggen gebeuren telkens in één synchroon stuk, zodat er
 * tussen "er loopt niets" en "nu loop ik" geen andere taak tussenkomt.
 *
 * Zuivere module zonder app-afhankelijkheden: de saver en de levenscyclus
 * importeren haar allebei, zonder elkaar mee te trekken.
 */

// De belofte van de lopende wissel, of null. Wijst nooit af.
let wissel = null;
// Lopende saves; elke ingang is klaar (nooit afgewezen) als de save klaar is.
const opslagen = new Set();

/** Loopt er nu een extensiewissel? */
export function wisselLoopt() {
  return wissel !== null;
}

/** Loopt er nu een save? */
export function opslagLoopt() {
  return opslagen.size > 0;
}

/**
 * Voer `fn` uit zodra er geen wissel loopt. Zolang `fn` loopt, wacht een
 * nieuwe wissel. Geeft de uitkomst van `fn`.
 * @template T
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function metOpslagSlot(fn) {
  while (wissel) await wissel;
  // Vanaf hier synchroon tot fn zijn eerste await bereikt.
  let klaar;
  const ingang = new Promise((r) => { klaar = r; });
  opslagen.add(ingang);
  try {
    return await fn();
  } finally {
    opslagen.delete(ingang);
    klaar();
  }
}

/**
 * Begin een wissel zodra er geen save en geen andere wissel loopt. Geeft een
 * functie die de wissel beëindigt (meer dan eens aanroepen kan geen kwaad).
 * @returns {Promise<() => void>}
 */
export async function beginWisselSlot() {
  for (;;) {
    if (wissel) { await wissel; continue; }
    if (opslagen.size) { await Promise.all([...opslagen]); continue; }
    break;
  }
  let los;
  const deze = new Promise((r) => { los = r; });
  wissel = deze;
  return () => {
    if (wissel === deze) wissel = null;
    los();
  };
}

/** Klaar zodra er geen wissel loopt; direct klaar als er geen loopt. */
export async function wachtOpWisselSlot() {
  while (wissel) await wissel;
}
