/**
 * Opdrachtregister voor extensies (#551).
 *
 * Elke lintactie en elke keuze van een keuzelijst van een extensie krijgt bij
 * registratie een opdracht:
 *   ext:<extId>:<itemId>             een actie
 *   ext:<extId>:<itemId>=<optionId>  een keuze van een keuzelijst
 * Dit register is de enige bron: een klik in het lint en een MCP-aanroep
 * (app_run_command) lopen langs hetzelfde codepad, `voerUit(id, { source })`.
 * Omdat de lijst uit het register komt en niet uit de DOM, zijn de opdrachten
 * ook bereikbaar als het lint is ingeklapt of de groep in "Meer" zit.
 *
 * Zuivere module zonder app-afhankelijkheden.
 */

const STANDAARD_TIMEOUT_MS = 15_000;
const MAX_RESULTAAT = 64 * 1024;

/** Het opdracht-id van een actie, of van één keuze van een keuzelijst. */
export function opdrachtId(extId, itemId, optionId = undefined) {
  return optionId === undefined ? `ext:${extId}:${itemId}` : `ext:${extId}:${itemId}=${optionId}`;
}

/**
 * Kies de tekst voor de actieve taal uit een string of een object
 * `{ taalcode: tekst }`: eerst de taal zelf, dan de basistaal ("pt" bij
 * "pt-BR"), dan `en`, dan de eerste waarde.
 */
export function kiesTekst(tekst, taal) {
  if (typeof tekst === 'string') return tekst;
  if (!tekst || typeof tekst !== 'object') return '';
  const t = typeof taal === 'string' ? taal : '';
  if (t && typeof tekst[t] === 'string') return tekst[t];
  const basis = t.split('-')[0];
  if (basis && typeof tekst[basis] === 'string') return tekst[basis];
  if (typeof tekst.en === 'string') return tekst.en;
  const eerste = Object.values(tekst).find((v) => typeof v === 'string');
  return eerste ?? '';
}

function metTijdgrens(belofte, ms) {
  let timer;
  const grens = new Promise((_, weiger) => {
    timer = setTimeout(() => weiger(Object.assign(new Error(`command did not finish within ${ms / 1000} s`),
      { code: 'COMMAND_TIMEOUT' })), ms);
  });
  return Promise.race([belofte, grens]).finally(() => clearTimeout(timer));
}

/** JSON-kloon van het resultaat, hooguit 64 KB; anders weglaten met een waarschuwing. */
function vormResultaat(waarde) {
  if (waarde === undefined) return {};
  let json;
  try {
    json = JSON.stringify(waarde);
  } catch (fout) {
    return { warnings: [{ code: 'RESULT_NOT_SERIALIZABLE', message: String(fout?.message ?? fout) }] };
  }
  if (json === undefined) return {};
  if (json.length > MAX_RESULTAAT) {
    return { warnings: [{ code: 'RESULT_TOO_LARGE', message: `result is larger than 64 KB (${json.length} bytes) and was left out` }] };
  }
  return { result: JSON.parse(json) };
}

/**
 * Maak een opdrachtregister.
 * @param {{ timeoutMs?: number, isBezig?: (extId: string) => boolean }} [opties]
 */
export function maakOpdrachtRegister(opties = {}) {
  const timeoutMs = opties.timeoutMs ?? STANDAARD_TIMEOUT_MS;
  let isBezig = opties.isBezig ?? (() => false);
  // id -> { id, extId, tab, kind, lees, voerUit, loopt }
  const opdrachten = new Map();
  const luisteraars = new Set();

  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };

  return {
    /** Laat het register weten welke extensies aan het wisselen zijn. */
    zetWisselControle(fn) { isBezig = typeof fn === 'function' ? fn : () => false; },

    /**
     * Registreer één opdracht.
     * @param {{ id: string, extId: string, tab: string|null, kind: 'action'|'option',
     *   lees: () => { label, title, disabled, active }, voerUit: (ctx) => any }} opdracht
     */
    registreer(opdracht) {
      if (opdrachten.has(opdracht.id)) throw new Error(`command ${opdracht.id} is already registered`);
      opdrachten.set(opdracht.id, { ...opdracht, loopt: null });
      meld();
    },

    verwijder(id) {
      if (opdrachten.delete(id)) meld();
    },

    heeft: (id) => opdrachten.has(id),
    loopt: (id) => Boolean(opdrachten.get(id)?.loopt),

    /** Alle opdrachten in de vorm van app_list_commands. */
    lijst(taal) {
      return [...opdrachten.values()].map((o) => {
        const t = o.lees() || {};
        return {
          command: o.id, tab: o.tab ?? null,
          label: kiesTekst(t.label, taal), title: kiesTekst(t.title, taal),
          disabled: t.disabled === true, active: t.active === true, stableId: true,
          extension: o.extId, kind: o.kind,
        };
      });
    },

    /**
     * Voer een opdracht uit. Geeft altijd een object; nooit een afwijzing.
     * @param {string} id
     * @param {{ source?: 'ui'|'mcp' }} [ctx]
     */
    async voerUit(id, ctx = {}) {
      const o = opdrachten.get(id);
      if (!o) return { ok: false, code: 'UNKNOWN_COMMAND', error: `unknown command: ${id} — see app_list_commands` };
      const basis = { command: id, extension: o.extId };
      if (isBezig(o.extId)) {
        return { ok: false, code: 'EXTENSION_BUSY', error: `extension ${o.extId} is being installed or reloaded`, ...basis };
      }
      if ((o.lees() || {}).disabled === true) {
        return { ok: false, found: true, disabled: true, code: 'COMMAND_DISABLED', error: 'command is disabled', ...basis };
      }
      if (o.loopt) return { ok: false, code: 'COMMAND_BUSY', error: 'command is still running', ...basis };
      // Het slot hoort bij deze uitvoering; het gaat pas los als de belofte van
      // de extensie zelf klaar is, ook na een time-out.
      const uitvoering = {};
      o.loopt = uitvoering;
      meld();
      const geefVrij = () => { if (o.loopt === uitvoering) { o.loopt = false; meld(); } };
      const lopend = Promise.resolve().then(() => o.voerUit({ source: ctx.source === 'mcp' ? 'mcp' : 'ui', commandId: id }));
      lopend.then(geefVrij, geefVrij);
      try {
        const waarde = await metTijdgrens(lopend, timeoutMs);
        geefVrij();
        return { ok: true, ...basis, ...vormResultaat(waarde) };
      } catch (fout) {
        if (fout?.code === 'COMMAND_TIMEOUT') return { ok: false, code: 'COMMAND_TIMEOUT', error: fout.message, ...basis };
        geefVrij();
        return { ok: false, code: 'COMMAND_FAILED', error: String(fout?.message ?? fout), ...basis };
      }
    },

    /** Luister naar wijzigingen (registratie, loopt/klaar). Geeft een afmeldfunctie. */
    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
}

// Het register van de app. Lint en MCP gebruiken allebei dit exemplaar.
export const extensieOpdrachten = maakOpdrachtRegister();

/** Voer een extensieopdracht uit; hetzelfde pad voor een klik en voor MCP. */
export function voerExtensieOpdrachtUit(id, ctx = {}) {
  return extensieOpdrachten.voerUit(id, ctx);
}
