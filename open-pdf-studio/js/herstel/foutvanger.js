// Onafgevangen fouten in de frontend: in het crashlog en een noodmomentopname.
//
// `window` krijgt luisteraars op `error` (zelfde gebeurtenissen als
// window.onerror) en `unhandledrejection`. Bij zo'n fout:
//   1. een regel in het crashlog (zonder documentinhoud, ingekort);
//   2. meteen een momentopname van alle documenten met niet-opgeslagen
//      wijzigingen, zonder de gewone wachttijd.
//
// Beveiligingen (getest in foutvanger.test.mjs):
//  * recursie: een fout tijdens het afhandelen (ook een fout uit de
//    noodmomentopname zelf) start geen nieuwe afhandeling; hij komt na
//    afloop wel in het log (hooguit MAX_WACHTRIJ), en wat tijdens dat loggen
//    nog binnenkomt valt weg;
//  * hooguit één noodmomentopname per `tussenpoos` (een fout in een
//    tekenlus komt anders tientallen keren per seconde);
//  * hooguit `maxLogRegels` regels per sessie in het crashlog;
//  * bekende onschuldige meldingen (ResizeObserver) tellen niet.

export const TUSSENPOOS_MS = 15_000;
export const MAX_LOG_REGELS = 50;
export const MAX_TEKST = 4000;
export const MAX_WACHTRIJ = 10;

const ONSCHULDIG = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
];

/** Leesbare tekst van een ErrorEvent, PromiseRejectionEvent, Error of waarde. */
export function beschrijf(gebeurtenis) {
  let tekst;
  try {
    const e = gebeurtenis;
    const fout = e?.error ?? e?.reason ?? (e instanceof Error ? e : null);
    if (fout instanceof Error || (fout && typeof fout === 'object' && 'message' in fout)) {
      const kop = `${fout.name || 'Error'}: ${fout.message}`;
      // Een stapelspoor begint meestal al met naam en melding.
      const spoor = fout.stack ? String(fout.stack) : '';
      tekst = !spoor ? kop : (spoor.startsWith(kop) ? spoor : `${kop}\n${spoor}`);
    } else if (e && typeof e === 'object' && 'message' in e && e.message) {
      const plek = e.filename ? ` (${e.filename}:${e.lineno || 0}:${e.colno || 0})` : '';
      tekst = `${e.message}${plek}`;
    } else if (e && typeof e === 'object' && 'reason' in e) {
      tekst = `Unhandled rejection: ${String(e.reason)}`;
    } else {
      tekst = String(e);
    }
  } catch {
    tekst = '(unreadable error)';
  }
  return tekst.length > MAX_TEKST ? `${tekst.slice(0, MAX_TEKST)}… [cut]` : tekst;
}

export function isOnschuldig(tekst) {
  return ONSCHULDIG.some((r) => r.test(String(tekst || '').trim()));
}

/**
 * @param {object} o
 * @param {(reden:string)=>Promise<any>} o.noodopslag
 * @param {(soort:string, tekst:string)=>Promise<any>} o.schrijfLog
 * @param {()=>number} [o.nu]
 */
export function maakFoutvanger({ noodopslag, schrijfLog, nu = () => Date.now(), tussenpoos = TUSSENPOOS_MS, maxLogRegels = MAX_LOG_REGELS }) {
  let bezig = false;
  let laatsteNood = -Infinity;
  let logRegels = 0;
  const telling = { afgehandeld: 0, recursie: 0, onschuldig: 0, noodopnamen: 0 };

  // Fouten die binnenkomen terwijl een vorige wordt afgehandeld: hooguit
  // MAX_WACHTRIJ, één keer gelogd na de afhandeling. Wat tijdens dat loggen nog
  // binnenkomt, valt weg; zo eindigt elke ronde.
  const wachtrij = [];
  let spoelen = false;

  async function log(soort, tekst) {
    if (logRegels >= maxLogRegels) return;
    logRegels++;
    try { await schrijfLog(soort, tekst); } catch { /* het log mag nooit zelf een fout geven */ }
  }

  async function bijFout(soort, gebeurtenis) {
    if (bezig) {
      // Tijdens de afhandeling: geen nieuwe noodmomentopname, de melding
      // komt na afloop in het log.
      telling.recursie++;
      const tekst = beschrijf(gebeurtenis);
      if (!spoelen && !isOnschuldig(tekst) && wachtrij.length < MAX_WACHTRIJ) {
        wachtrij.push([soort, `${tekst}\n(raised while a previous error was being handled)`]);
      }
      return 'recursie';
    }
    bezig = true;
    try {
      const tekst = beschrijf(gebeurtenis);
      if (isOnschuldig(tekst)) { telling.onschuldig++; return 'onschuldig'; }
      telling.afgehandeld++;
      await log(soort, tekst);
      const t = nu();
      if (t - laatsteNood >= tussenpoos) {
        laatsteNood = t;
        telling.noodopnamen++;
        try { await noodopslag(soort); } catch { /* fouten hierin starten geen nieuwe ronde */ }
      }
      return 'afgehandeld';
    } finally {
      spoelen = true;
      try {
        for (const [s, t] of wachtrij.splice(0)) await log(s, t);
      } finally {
        spoelen = false;
        bezig = false;
      }
    }
  }

  function installeer(g = globalThis) {
    const opFout = (e) => { bijFout('js-error', e); };
    const opWeigering = (e) => { bijFout('js-unhandled-rejection', e); };
    g.addEventListener?.('error', opFout);
    g.addEventListener?.('unhandledrejection', opWeigering);
    return () => {
      g.removeEventListener?.('error', opFout);
      g.removeEventListener?.('unhandledrejection', opWeigering);
    };
  }

  return { bijFout, installeer, telling, isBezig: () => bezig };
}
