/**
 * Gestructureerde opdrachten van extensies (#575).
 *
 * Een extensie registreert met `api.registerCommand(descriptor)` een opdracht
 * met een eigen naam, een invoer- en een uitvoerschema en een asynchrone
 * handler. De opdracht krijgt de MCP-toolnaam
 *   ext_<extensie-id met '_' voor '.'>__<naam>
 * en staat daarmee in tools/list van de MCP-server (de app geeft de lijst aan
 * Rust door, mcp_extensie_tools.rs) en is ook aan te roepen via
 * app_call_extension_command. Een klik in de eigen bediening van de extensie
 * en een MCP-aanroep gebruiken zo dezelfde dienstcode, zonder DOM.
 *
 * Dit register is de dispatcher: het controleert de argumenten vóór de
 * handler (json-schema-subset.js), eist bij een wijzigende opdracht een
 * idempotentiesleutel en een revisiecontext, controleert een documentrevisie,
 * geeft elke aanroep een stabiel requestId, bewaakt de tijdgrens, annuleert
 * lopende aanroepen bij uitzetten of herladen en controleert het resultaat
 * tegen het uitvoerschema. Een aanroep wijst nooit af: de uitkomst is altijd
 * { ok: true, … } of { ok: false, code, error, … }.
 *
 * Contract en foutcodes: docs/extensies-mcp-en-ribbon.md §16.
 *
 * Zuivere module zonder app-afhankelijkheden; de documentrevisie en de
 * wisselcontrole worden ingespoten.
 */

import { ExtensionContributionError, isStriktExtensieId } from './extension-contributions.js';
import { kiesTekst } from './extension-commands.js';
import {
  normaliseerSchema, valideerWaarde, SchemaFout, isPlatObject, canoniekeJson, isJsonWaarde,
} from './json-schema-subset.js';

export const TOOL_VOORVOEGSEL = 'ext_';
const NAAM = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MAX_NAAM = 48;
const MAX_TOOLNAAM = 64;
const MAX_PER_EXTENSIE = 32;
const MAX_TITEL = 100;
const MAX_BESCHRIJVING = 1024;
const STANDAARD_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ARGUMENTEN = 1024 * 1024;
const MAX_RESULTAAT = 256 * 1024;
const MAX_DETAILS = 16 * 1024;
const MAX_GELIJKTIJDIG = 8;
const IDEMPOTENTIE_MAX = 500;
const IDEMPOTENTIE_TTL_MS = 24 * 60 * 60 * 1000;
const SLEUTEL = /^[A-Za-z0-9._:-]{8,128}$/;
const FOUTCODE = /^[A-Z][A-Z0-9_]{2,47}$/;
const VELDEN = new Set(['name', 'title', 'description', 'inputSchema', 'outputSchema', 'effect', 'timeoutMs', 'handler']);
const GERESERVEERD = ['idempotencyKey', 'revisionContext'];
const CONTEXT_VELDEN = new Set(['documentId', 'documentRevision', 'sourceRevision']);

const ongeldig = (bericht) => new ExtensionContributionError('INVALID_CONTRIBUTION', bericht);

/** De MCP-toolnaam van opdracht `naam` van extensie `extId`. */
export function toolNaam(extId, naam) {
  return `${TOOL_VOORVOEGSEL}${extId.replace(/\./g, '_')}__${naam}`;
}

/** Het extensie-id uit een toolnaam (een id bevat nooit '_'), of null. */
export function extensieUitTool(tool) {
  if (typeof tool !== 'string' || !tool.startsWith(TOOL_VOORVOEGSEL)) return null;
  const rest = tool.slice(TOOL_VOORVOEGSEL.length);
  const i = rest.indexOf('__');
  if (i <= 0) return null;
  const id = rest.slice(0, i).replace(/_/g, '.');
  return isStriktExtensieId(id) ? id : null;
}

/** Het extra deel van het gepubliceerde invoerschema van een wijzigende opdracht. */
function revisieSchema() {
  return {
    idempotencyKey: {
      type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$',
      description: 'Caller-chosen key for this change. Repeating the call with the same key and arguments returns the stored result without running the command again; the same key with other arguments is refused.',
    },
    revisionContext: {
      type: 'object',
      description: 'The revisions this change is based on. Give documentId with documentRevision (from the document the command changes), sourceRevision (a revision the extension handed out), or both. A stale revision is refused.',
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 128 },
        documentRevision: { type: 'string', minLength: 1, maxLength: 128 },
        sourceRevision: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
  };
}

function fout(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

/** JSON-kloon van een fout-`details`, hooguit 16 KB; anders weggelaten. */
function veiligeDetails(details) {
  if (details === undefined || !isJsonWaarde(details)) return undefined;
  const json = JSON.stringify(details);
  return json.length <= MAX_DETAILS ? JSON.parse(json) : undefined;
}

/**
 * Maak een register. Opties (allemaal optioneel, voor tests):
 *   nu() → ms, maakRequestId() → string,
 *   isBezig(extId) → boolean (de extensie wordt geïnstalleerd of herladen),
 *   documentRevisie(documentId) → string | null (null: niet open).
 */
export function maakOpdrachtDienst(opties = {}) {
  const nu = opties.nu ?? (() => Date.now());
  let teller = 0;
  const maakRequestId = opties.maakRequestId
    ?? (() => `xc-${nu().toString(36)}-${(++teller).toString(36)}`);
  let isBezig = opties.isBezig ?? (() => false);
  let documentRevisie = opties.documentRevisie ?? (() => null);
  // tool -> opdracht
  const opdrachten = new Map();
  // requestId -> { tool, rpcId, annuleer(code, bericht) }
  const lopend = new Map();
  // tool -> aantal handlers dat nog loopt (ook na een time-out)
  const bezig = new Map();
  // `${tool}\u0000${sleutel}` -> { vingerafdruk, status, uitkomst, resultaat, tijd }
  const idempotentie = new Map();
  const luisteraars = new Set();

  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };

  function ruimIdempotentieOp() {
    const grens = nu() - IDEMPOTENTIE_TTL_MS;
    for (const [k, e] of idempotentie) {
      if (e.status === 'done' && e.tijd < grens) idempotentie.delete(k);
    }
    while (idempotentie.size > IDEMPOTENTIE_MAX) {
      const oudste = [...idempotentie].find(([, e]) => e.status === 'done');
      if (!oudste) break;
      idempotentie.delete(oudste[0]);
    }
  }

  /** Publiek beeld van een opdracht (lijst, app_list_extensions). */
  function beeld(o) {
    return {
      tool: o.tool, extension: o.extId, name: o.name,
      title: kiesTekst(o.title, 'en'), description: kiesTekst(o.description, 'en'),
      effect: o.effect, timeoutMs: o.timeoutMs,
      inputSchema: JSON.parse(JSON.stringify(o.gepubliceerdSchema)),
      outputSchema: JSON.parse(JSON.stringify(o.outputSchema)),
    };
  }

  /** Vorm het resultaat van de handler: JSON-object, ≤ 256 KB, past op het uitvoerschema. */
  function vormResultaat(o, waarde) {
    if (!isPlatObject(waarde) || !isJsonWaarde(waarde)) {
      return fout('RESULT_INVALID', 'the command returned something other than a JSON object');
    }
    const json = JSON.stringify(waarde);
    if (json.length > MAX_RESULTAAT) {
      return fout('RESULT_TOO_LARGE', `the result is larger than ${MAX_RESULTAAT / 1024} KB (${json.length} bytes)`);
    }
    const resultaat = JSON.parse(json);
    const fouten = valideerWaarde(o.outputSchema, resultaat);
    if (fouten.length) return fout('RESULT_INVALID', 'the result does not match the output schema of the command', { details: fouten });
    return { ok: true, result: resultaat };
  }

  function vormFout(e) {
    if (e?.name === 'AbortError') return fout('COMMAND_CANCELLED', String(e?.message || 'the command was cancelled'));
    const code = typeof e?.code === 'string' && FOUTCODE.test(e.code) ? e.code : 'COMMAND_FAILED';
    const extra = {};
    const details = veiligeDetails(e?.details);
    if (details !== undefined) extra.details = details;
    return fout(code, String(e?.message ?? e), extra);
  }

  function controleerContext(c) {
    if (!isPlatObject(c)) return 'revisionContext must be an object with documentId and documentRevision, sourceRevision, or both';
    for (const k of Object.keys(c)) {
      if (!CONTEXT_VELDEN.has(k)) return `revisionContext: unknown property "${k}"`;
      if (typeof c[k] !== 'string' || !c[k] || c[k].length > 128) return `revisionContext.${k} must be text of 1-128 characters`;
    }
    if ((c.documentId === undefined) !== (c.documentRevision === undefined)) {
      return 'revisionContext: documentId and documentRevision go together';
    }
    if (c.documentId === undefined && c.sourceRevision === undefined) {
      return 'revisionContext needs documentId with documentRevision, sourceRevision, or both';
    }
    return null;
  }

  return {
    /** Laat het register weten welke extensies aan het wisselen zijn. */
    zetWisselControle(fn) { isBezig = typeof fn === 'function' ? fn : () => false; },

    /** De revisie van een open document (string), of null als het niet open is. */
    zetDocumentRevisie(fn) { documentRevisie = typeof fn === 'function' ? fn : () => null; },

    /**
     * Controleer een descriptor en bouw de opdracht, zonder te registreren.
     * Gooit ExtensionContributionError (INVALID_CONTRIBUTION, LIMIT_EXCEEDED).
     */
    controleer(extId, descriptor) {
      if (!isStriktExtensieId(extId)) {
        throw ongeldig(`structured commands need an extension id of lowercase letters, digits, "-" and "."; ${JSON.stringify(extId)} does not qualify`);
      }
      if (!isPlatObject(descriptor)) throw ongeldig('registerCommand needs a descriptor object');
      for (const k of Object.keys(descriptor)) {
        if (!VELDEN.has(k)) throw ongeldig(`unknown command field "${k}"`);
      }
      const { name, title, description, inputSchema, outputSchema, handler } = descriptor;
      if (typeof name !== 'string' || name.length > MAX_NAAM || !NAAM.test(name)) {
        throw ongeldig(`command name ${JSON.stringify(name)} must be 1-${MAX_NAAM} characters of lowercase letters, digits and single underscores, starting with a letter`);
      }
      const tool = toolNaam(extId, name);
      if (tool.length > MAX_TOOLNAAM) {
        throw ongeldig(`the tool name ${tool} is longer than ${MAX_TOOLNAAM} characters; choose a shorter command name`);
      }
      const tekst = (v, max, veld, verplicht) => {
        if (v === undefined && !verplicht) return undefined;
        const goed = typeof v === 'string'
          ? v.trim().length > 0 && v.length <= max
          : isPlatObject(v) && Object.keys(v).length > 0
            && Object.values(v).every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= max);
        if (!goed) throw ongeldig(`${veld} must be text of 1-${max} characters, or an object of such texts per language`);
        return typeof v === 'string' ? v : { ...v };
      };
      const titel = tekst(title, MAX_TITEL, 'title', false);
      const beschrijving = tekst(description, MAX_BESCHRIJVING, 'description', true);
      const effect = descriptor.effect ?? 'read';
      if (effect !== 'read' && effect !== 'mutate') throw ongeldig("effect must be 'read' or 'mutate'");
      const timeoutMs = descriptor.timeoutMs ?? STANDAARD_TIMEOUT_MS;
      if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
        throw ongeldig(`timeoutMs must be an integer of ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`);
      }
      if (typeof handler !== 'function') throw ongeldig('handler must be a function');
      let invoer;
      let uitvoer;
      try {
        invoer = normaliseerSchema(inputSchema, 'inputSchema');
        uitvoer = normaliseerSchema(outputSchema, 'outputSchema');
      } catch (e) {
        if (e instanceof SchemaFout) throw ongeldig(e.message);
        throw e;
      }
      for (const [schema, veld] of [[invoer, 'inputSchema'], [uitvoer, 'outputSchema']]) {
        if (schema.type !== 'object') throw ongeldig(`${veld} must have type "object"`);
      }
      for (const naam of GERESERVEERD) {
        if (invoer.properties && Object.hasOwn(invoer.properties, naam)) {
          throw ongeldig(`inputSchema may not define "${naam}": the host adds it to mutating commands`);
        }
      }
      if (invoer.additionalProperties === true && effect === 'mutate') {
        throw ongeldig('a mutating command needs a closed inputSchema (additionalProperties false)');
      }
      if ([...opdrachten.values()].filter((o) => o.extId === extId).length >= MAX_PER_EXTENSIE) {
        throw new ExtensionContributionError('LIMIT_EXCEEDED', `an extension can register at most ${MAX_PER_EXTENSIE} structured commands`);
      }
      // Het gepubliceerde schema: dat van de extensie, plus de velden van de
      // host bij een wijzigende opdracht.
      const gepubliceerdSchema = effect === 'mutate'
        ? {
          ...invoer,
          properties: { ...(invoer.properties || {}), ...revisieSchema() },
          required: [...(invoer.required || []), ...GERESERVEERD],
        }
        : invoer;
      return {
        tool, extId, name, title: titel ?? name, description: beschrijving, effect, timeoutMs,
        inputSchema: invoer, outputSchema: uitvoer, gepubliceerdSchema, handler,
      };
    },

    /** Neem een gecontroleerde opdracht op. Gooit als de toolnaam al bestaat. */
    voegToe(opdracht) {
      if (opdrachten.has(opdracht.tool)) {
        throw new ExtensionContributionError('CONTRIBUTION_CONFLICT', `structured command ${opdracht.tool} is already registered`);
      }
      opdrachten.set(opdracht.tool, opdracht);
      meld();
    },

    /**
     * Haal een opdracht weg. Lopende aanroepen krijgen meteen `reden` als
     * uitkomst en hun AbortSignal gaat af; een laat resultaat van de handler
     * bereikt de aanroeper niet meer (de idempotentie onthoudt het wel).
     */
    verwijder(tool, reden = 'EXTENSION_UNLOADED') {
      if (!opdrachten.delete(tool)) return false;
      for (const l of [...lopend.values()]) {
        if (l.tool === tool) l.annuleer(reden, reden === 'EXTENSION_UNLOADED'
          ? 'the extension was unloaded or reloaded; the command was cancelled'
          : 'the command was unregistered; the call was cancelled');
      }
      meld();
      return true;
    },

    heeft: (tool) => opdrachten.has(tool),

    /** Alle opdrachten (of die van één extensie) als publiek beeld. */
    lijst(extId = undefined) {
      return [...opdrachten.values()].filter((o) => extId === undefined || o.extId === extId).map(beeld);
    },

    /** De definities voor tools/list (doorgegeven aan Rust). */
    mcpTools() {
      return [...opdrachten.values()].map((o) => ({
        name: o.tool,
        description: `${kiesTekst(o.description, 'en')} (Extension ${o.extId}.)`,
        inputSchema: JSON.parse(JSON.stringify(o.gepubliceerdSchema)),
        annotations: {
          title: kiesTekst(o.title, 'en'),
          readOnlyHint: o.effect === 'read',
          destructiveHint: o.effect === 'mutate',
          openWorldHint: false,
        },
      }));
    },

    /** Hoeveel aanroepen nu op een uitkomst wachten (voor tests en diagnose). */
    aantalLopend: () => lopend.size,

    /**
     * Roep een opdracht aan. `opties.source` is 'mcp' of 'api'; `rpcId` is het
     * JSON-RPC-id van de MCP-aanroep (voor annuleren).
     */
    async roepAan(tool, invoer, opties = {}) {
      const requestId = maakRequestId();
      const extId = extensieUitTool(tool);
      const basis = { requestId, tool: typeof tool === 'string' ? tool : null, ...(extId ? { extension: extId } : {}) };
      const terug = (r) => ({ ...r, ...basis, replayed: false });
      if (typeof tool !== 'string' || !tool) return terug(fout('INVALID_ARGUMENT', 'tool must be the name of an extension command (ext_…)'));
      if (extId && isBezig(extId)) return terug(fout('EXTENSION_BUSY', `extension ${extId} is being installed or reloaded; try again`));
      const o = opdrachten.get(tool);
      if (!o) return terug(fout('UNKNOWN_COMMAND', `unknown extension command: ${tool} — see app_list_extensions with includeContributions`));
      basis.command = o.name;

      // Argumenten: een JSON-object binnen de grens.
      const args = invoer === undefined || invoer === null ? {} : invoer;
      if (!isPlatObject(args) || !isJsonWaarde(args)) return terug(fout('INVALID_ARGUMENT', 'arguments must be a JSON object'));
      if (JSON.stringify(args).length > MAX_ARGUMENTEN) return terug(fout('INVALID_ARGUMENT', 'arguments are larger than 1 MB'));
      const eigen = { ...args };
      const { idempotencyKey, revisionContext } = eigen;
      for (const naam of GERESERVEERD) delete eigen[naam];
      if (o.effect === 'read') {
        const extra = GERESERVEERD.find((n) => Object.hasOwn(args, n));
        if (extra) return terug(fout('INVALID_ARGUMENT', `${extra} is only accepted by mutating commands`, { details: [{ path: `/${extra}`, message: 'not accepted by a read command' }] }));
      }
      const fouten = valideerWaarde(o.inputSchema, eigen);
      if (fouten.length) return terug(fout('INVALID_ARGUMENT', `invalid arguments: ${fouten[0].path} ${fouten[0].message}`, { details: fouten }));

      let sleutel = null;
      if (o.effect === 'mutate') {
        if (typeof idempotencyKey !== 'string' || !SLEUTEL.test(idempotencyKey)) {
          return terug(fout('INVALID_ARGUMENT', 'idempotencyKey must be 8-128 characters of A-Z, a-z, 0-9, ".", "_", ":" or "-"', { details: [{ path: '/idempotencyKey', message: 'missing or invalid' }] }));
        }
        const probleem = controleerContext(revisionContext);
        if (probleem) return terug(fout('INVALID_ARGUMENT', probleem, { details: [{ path: '/revisionContext', message: probleem }] }));
        // Idempotentie vóór de revisiecontrole: een herhaling na een geslaagde
        // wijziging draagt de oude revisie en moet het bewaarde resultaat krijgen.
        ruimIdempotentieOp();
        sleutel = `${tool}\u0000${idempotencyKey}`;
        const vinger = canoniekeJson({ args: eigen, revisionContext });
        const bestaand = idempotentie.get(sleutel);
        if (bestaand) {
          if (bestaand.vingerafdruk !== vinger) {
            return terug(fout('IDEMPOTENCY_KEY_REUSED', 'this idempotencyKey was used for a call with other arguments; use a new key'));
          }
          if (bestaand.status === 'done') return { ...bestaand.resultaat, replayed: true };
          // De eerste aanroep loopt nog (bijvoorbeeld na een time-out): wacht
          // op dezelfde uitkomst, met dezelfde tijdgrens.
          let wachtTimer;
          const grens = new Promise((klaar) => {
            wachtTimer = setTimeout(() => klaar(fout('COMMAND_TIMEOUT',
              `an earlier call with this idempotencyKey is still running after ${o.timeoutMs / 1000} s; repeat the call later`)), o.timeoutMs);
          });
          const r = await Promise.race([bestaand.uitkomst, grens]).finally(() => clearTimeout(wachtTimer));
          return r.ok ? { ...(idempotentie.get(sleutel)?.resultaat ?? r), replayed: true }
            : { ...r, ...basis, replayed: true };
        }
        if (revisionContext.documentId !== undefined) {
          const huidig = documentRevisie(revisionContext.documentId);
          if (huidig === null || huidig === undefined) {
            return terug(fout('DOCUMENT_NOT_FOUND', `no open document with id ${revisionContext.documentId}`));
          }
          if (huidig !== revisionContext.documentRevision) {
            return terug(fout('STALE_REVISION', `stale document revision: expected ${revisionContext.documentRevision}, the current revision is ${huidig}`,
              { details: { field: 'revisionContext.documentRevision', currentRevision: huidig } }));
          }
        }
      }
      if ((bezig.get(tool) ?? 0) >= MAX_GELIJKTIJDIG) {
        return terug(fout('COMMAND_BUSY', `${MAX_GELIJKTIJDIG} calls of this command are still running`));
      }

      // Uitvoeren. `uitkomst` is de echte afloop van de handler en wijst nooit
      // af; de aanroeper krijgt die, of eerder een time-out of annulering.
      const regelaar = new AbortController();
      const ctx = Object.freeze({
        requestId, tool, command: o.name, extensionId: o.extId,
        source: opties.source === 'mcp' ? 'mcp' : 'api',
        signal: regelaar.signal,
        idempotencyKey: o.effect === 'mutate' ? idempotencyKey : null,
        revisionContext: o.effect === 'mutate' ? JSON.parse(JSON.stringify(revisionContext)) : null,
      });
      bezig.set(tool, (bezig.get(tool) ?? 0) + 1);
      const uitkomst = Promise.resolve()
        .then(() => o.handler(JSON.parse(JSON.stringify(eigen)), ctx))
        .then((v) => vormResultaat(o, v), vormFout)
        .finally(() => {
          const n = (bezig.get(tool) ?? 1) - 1;
          if (n > 0) bezig.set(tool, n); else bezig.delete(tool);
        });
      if (sleutel) {
        const record = { vingerafdruk: canoniekeJson({ args: eigen, revisionContext }), status: 'running', uitkomst, resultaat: null, tijd: nu() };
        idempotentie.set(sleutel, record);
        uitkomst.then((r) => {
          if (idempotentie.get(sleutel) !== record) return;
          // Alleen een geslaagde wijziging wordt bewaard: na een fout is er
          // niets gebeurd en mag dezelfde sleutel opnieuw.
          if (r.ok) Object.assign(record, { status: 'done', resultaat: { ...r, ...basis }, tijd: nu() });
          else idempotentie.delete(sleutel);
        });
      }

      let timer;
      const afgebroken = new Promise((klaar) => {
        lopend.set(requestId, {
          tool, rpcId: opties.rpcId ?? null,
          annuleer: (code, bericht) => { regelaar.abort(code); klaar(fout(code, bericht)); },
        });
        timer = setTimeout(() => {
          regelaar.abort('COMMAND_TIMEOUT');
          klaar(fout('COMMAND_TIMEOUT', `the command did not finish within ${o.timeoutMs / 1000} s; it may still complete — repeat the call with the same idempotencyKey to get its result`));
        }, o.timeoutMs);
      });
      try {
        const r = await Promise.race([uitkomst, afgebroken]);
        return terug(r);
      } finally {
        clearTimeout(timer);
        lopend.delete(requestId);
      }
    },

    /**
     * Annuleer lopende aanroepen op requestId of op het JSON-RPC-id van de
     * MCP-aanroep. Geeft het aantal geannuleerde aanroepen.
     */
    annuleer({ requestId, rpcId } = {}) {
      let n = 0;
      for (const [id, l] of [...lopend]) {
        const raak = (requestId !== undefined && id === requestId)
          || (rpcId !== undefined && rpcId !== null && canoniekeJson(l.rpcId) === canoniekeJson(rpcId));
        if (raak) { l.annuleer('COMMAND_CANCELLED', 'the call was cancelled by the client'); n++; }
      }
      return n;
    },

    /** Luister naar wijzigingen in de lijst. Geeft een afmeldfunctie. */
    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
}

// Het register van de app; plugin-API, MCP-brug en tests van de aansluiting
// gebruiken dit exemplaar.
export const gestructureerdeOpdrachten = maakOpdrachtDienst();

const isObj = isPlatObject;

/**
 * MCP-handler voor `mcp:call-extension-command`. Rust stuurt
 *   { tool, arguments, rpcId }                    voor een ext_-tool zelf, of
 *   { generic: true, call: { tool, arguments }, rpcId }   voor app_call_extension_command.
 */
export async function handleCallExtensionCommand(p, dienst = gestructureerdeOpdrachten) {
  if (!isObj(p)) return fout('INVALID_ARGUMENT', 'arguments must be an object with tool and arguments');
  let tool = p.tool;
  let args = p.arguments;
  if (p.generic === true) {
    const call = p.call ?? {};
    if (!isObj(call)) return fout('INVALID_ARGUMENT', 'arguments must be an object with tool and arguments');
    for (const k of Object.keys(call)) {
      if (k !== 'tool' && k !== 'arguments') return fout('INVALID_ARGUMENT', `unknown argument: ${k}`);
    }
    if (call.arguments !== undefined && !isObj(call.arguments)) return fout('INVALID_ARGUMENT', 'arguments must be an object');
    tool = call.tool;
    args = call.arguments;
  }
  return dienst.roepAan(tool, args, { source: 'mcp', rpcId: p.rpcId ?? null });
}

/** MCP-handler voor `mcp:cancel-extension-command` ({ rpcId }). */
export function handleCancelExtensionCommand(p, dienst = gestructureerdeOpdrachten) {
  if (!isObj(p) || p.rpcId === undefined || p.rpcId === null) return { ok: false, code: 'INVALID_ARGUMENT', error: 'rpcId is required' };
  return { ok: true, cancelled: dienst.annuleer({ rpcId: p.rpcId }) };
}
