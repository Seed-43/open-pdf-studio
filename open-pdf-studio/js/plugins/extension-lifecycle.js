/**
 * Levenscyclus van extensies (#550): installeren, bijwerken, herladen,
 * verwijderen en laden bij het opstarten, met terugrollen naar de vorige
 * werkende versie.
 *
 * Per extensie houdt deze module één record bij (§7.1 van het ontwerp). Alle
 * wijzigende bewerkingen lopen door één wachtrij, zodat twee bewerkingen
 * elkaar nooit raken. De volgorde bij installeren of bijwerken:
 *   1. pakket controleren (native), 2. native installeren in een transactie,
 *   3. de nieuwe code lezen en importeren VOOR de oude uitgaat,
 *   4. oude versie uitzetten en volledig opruimen, 5. nieuwe activeren,
 *   6. bevestigen; mislukt 5 of 6, dan terugdraaien op schijf en de vorige
 *      broncode uit het geheugen opnieuw activeren.
 *
 * Een wissel en opslaan sluiten elkaar uit (opslag-wissel-slot.js): een
 * wissel begint pas als er geen save loopt, en een save pas als er geen
 * wissel loopt.
 *
 * Alle afhankelijkheden worden ingespoten (native aanroep, import van de
 * broncode, de plug-in-API, het na-opruimen en het lint). Deze module krijgt
 * dus geen documenten, geen tabbladfuncties, geen herstart en geen
 * bestandskiezer mee: open PDF's en niet-opgeslagen wijzigingen kan ze niet
 * raken.
 */

import { ExtensionContributionError } from './extension-contributions.js';
import { beginWisselSlot, wachtOpWisselSlot } from './opslag-wissel-slot.js';

const STANDAARD_ACTIVATIE_MS = 10_000;
const STANDAARD_DEACTIVATIE_MS = 5_000;
const MAX_SLEUTELS = 200;
const SLEUTEL_TTL_MS = 24 * 60 * 60 * 1000;
// Bevestigen op schijf: zo vaak proberen, met een oplopende pauze ertussen.
const BEVESTIG_POGINGEN = 3;
const BEVESTIG_PAUZE_MS = 50;

// Codes die de native kant zelf geeft en die ongewijzigd doorgaan.
const NATIEVE_CODES = new Set([
  'PATH_NOT_ALLOWED', 'FILE_NOT_FOUND', 'PACKAGE_INVALID', 'MANIFEST_INVALID', 'ENTRY_MISSING',
  'PACKAGE_CHANGED', 'ALREADY_INSTALLED', 'VERSION_NOT_NEWER', 'VERSION_UNCOMPARABLE',
  'INSTALL_IO_FAILED', 'INVALID_ARGUMENT', 'TRANSACTION_UNKNOWN', 'TRANSACTION_PENDING', 'ID_CASE_CONFLICT',
]);

/** Een native fout (JSON-tekst `{"code","message"}`) als { code, message }. */
export function natieveFout(e) {
  const tekst = typeof e === 'string' ? e : (e?.message ?? String(e));
  try {
    const v = JSON.parse(tekst);
    if (v && typeof v.code === 'string') {
      return { code: NATIEVE_CODES.has(v.code) ? v.code : 'INSTALL_IO_FAILED', message: String(v.message ?? v.code) };
    }
  } catch { /* geen JSON: een gewone fouttekst */ }
  return { code: 'INSTALL_IO_FAILED', message: tekst };
}

const bericht = (e) => String(e?.message ?? e);

function metTijdgrens(belofte, ms, code) {
  let timer;
  const grens = new Promise((_, weiger) => {
    timer = setTimeout(() => weiger(Object.assign(new Error(`did not finish within ${ms / 1000} s`), { code })), ms);
  });
  return Promise.race([belofte, grens]).finally(() => clearTimeout(timer));
}

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Klaar zodra er geen extensiewissel loopt; direct klaar als er geen loopt.
 * Opslaan gebruikt het slot zelf (metOpslagSlot in opslag-wissel-slot.js);
 * deze functie blijft voor wie alleen wil wachten.
 */
export function wachtOpExtensieWissel() {
  return wachtOpWisselSlot();
}

/**
 * @param {{
 *   invoke: (cmd: string, args?: object) => Promise<any>,
 *   importeer: (broncode: string) => Promise<object>,
 *   maakApi: (id: string) => object,
 *   naOpruimen?: () => void,
 *   lint?: { actief: () => string, zet: (id: string) => void, heeft: (id: string) => boolean },
 *   nu?: () => number,
 *   activatieTimeoutMs?: number,
 *   deactivatieTimeoutMs?: number,
 *   opWissel?: (id: string, bezig: boolean) => void,
 * }} afh
 */
export function maakLevenscyclus(afh) {
  const invoke = afh.invoke;
  const importeer = afh.importeer;
  const maakApi = afh.maakApi;
  const naOpruimen = (ctx) => { try { afh.naOpruimen?.(ctx); } catch (e) { console.warn('[extensies] na-opruimen mislukt', e); } };
  const lint = afh.lint ?? { actief: () => null, zet: () => {}, heeft: () => false };
  const nu = afh.nu ?? (() => Date.now());
  const activatieMs = afh.activatieTimeoutMs ?? STANDAARD_ACTIVATIE_MS;
  const deactivatieMs = afh.deactivatieTimeoutMs ?? STANDAARD_DEACTIVATIE_MS;

  // id -> record. `actief` = { module, api, bron, manifest } van de draaiende versie.
  const records = new Map();
  // Wat de native lijst het laatst zei: id -> { id, name, version, sha256, source, legacyId, ... }
  let geinstalleerd = new Map();
  let problemen = [];
  const sleutels = new Map();
  const bezig = new Set();
  let staart = Promise.resolve();
  const luisteraars = new Set();
  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };

  const iso = () => new Date(nu()).toISOString();

  function record(id) {
    let r = records.get(id);
    if (!r) {
      r = {
        id, name: null, version: null, description: null, author: null,
        geladen: false, actief: null, status: 'notLoaded', error: null, source: null, lastChange: null,
      };
      records.set(id, r);
    }
    return r;
  }

  function inWachtrij(fn) {
    const p = staart.then(fn, fn);
    staart = p.catch(() => {});
    p.then(meld, meld);
    return p;
  }

  function zetBezig(id, aan) {
    if (aan) bezig.add(id); else bezig.delete(id);
    meld();
    try { afh.opWissel?.(id, aan); } catch { /* alleen melding */ }
  }

  /**
   * Begin een wissel. Met `slot` (de standaard) wacht hij eerst tot een
   * lopende save klaar is en wacht een nieuwe save daarna op hem. Zonder slot
   * (eerste keer laden bij het opstarten: er verdwijnt niets uit de registers)
   * houdt een trage activate opslaan niet op.
   */
  async function beginWissel(id, { slot = true } = {}) {
    const eindeSlot = slot ? await beginWisselSlot() : () => {};
    zetBezig(id, true);
    let klaar = false;
    return () => {
      if (klaar) return;
      klaar = true;
      zetBezig(id, false);
      eindeSlot();
    };
  }

  function verversGeinstalleerd(lijst) {
    geinstalleerd = new Map((lijst?.extensions ?? []).map((e) => [e.id, e]));
    problemen = (lijst?.problems ?? []).map((p) => ({ folder: p.folder, code: p.code, error: p.message ?? p.error ?? '' }));
    for (const [id, r] of records) {
      if (!geinstalleerd.has(id) && !r.actief && !r.geladen) records.delete(id);
    }
  }

  async function haalLijst(herstel = false) {
    const lijst = await invoke('extensie_lijst', herstel ? { herstel: true } : {});
    verversGeinstalleerd(lijst);
    return lijst;
  }

  const actieveStaat = (r) => (r?.actief ? { version: r.actief.manifest.version ?? null, activated: true } : null);

  /**
   * Activeer een module met een nieuwe API. `streng` (MCP): een activate die
   * niet binnen de tijdgrens klaar is, geldt als mislukt (ACTIVATION_TIMEOUT)
   * en wordt teruggerold. Niet streng (opstarten, extensiepaneel): de
   * extensie blijft actief met de waarschuwing ACTIVATION_SLOW, en `laat` is
   * de nog lopende activatie (zie volgTrageActivatie).
   */
  async function activeer(id, module, manifest, { streng = true } = {}) {
    const api = maakApi(id);
    let activatie = null;
    try {
      if (module?.manifest?.id !== undefined && module.manifest.id !== id) {
        throw new Error(`the module manifest id "${module.manifest.id}" does not match ${id}`);
      }
      activatie = Promise.resolve().then(() => module?.activate?.(api));
      await metTijdgrens(activatie, activatieMs, 'ACTIVATION_TIMEOUT');
      return { ok: true, api, warnings: [] };
    } catch (e) {
      const timeout = e?.code === 'ACTIVATION_TIMEOUT';
      if (timeout && !streng) {
        return {
          ok: true, api, laat: activatie,
          warnings: [{ code: 'ACTIVATION_SLOW', message: `activate() did not finish within ${activatieMs / 1000} s; the extension stays active` }],
        };
      }
      const opruim = [];
      if (timeout) {
        // De module loopt nog door: eerst haar eigen deactivate, zodat ze
        // daarna opnieuw te activeren is (een "al actief"-vlag blijft anders staan).
        try {
          await metTijdgrens(Promise.resolve().then(() => module?.deactivate?.()), deactivatieMs, 'DEACTIVATE_TIMEOUT');
        } catch (d) {
          opruim.push({ code: 'DEACTIVATE_FAILED', message: bericht(d) });
        }
      }
      // Daarna is de API gesloten: een late registratie geeft EXTENSION_INACTIVE.
      try {
        const w = api._cleanup?.();
        if (Array.isArray(w)) opruim.push(...w);
      } catch (c) {
        opruim.push({ code: 'CLEANUP_FAILED', message: bericht(c) });
      }
      const fout = {
        code: timeout ? 'ACTIVATION_TIMEOUT' : 'ACTIVATION_FAILED',
        message: timeout ? `activate() did not finish within ${activatieMs / 1000} s` : `activate() threw: ${bericht(e)}`,
      };
      if (e instanceof ExtensionContributionError) fout.cause = e.code;
      return { ok: false, fout, warnings: opruim };
    }
  }

  /**
   * Een trage activatie (ACTIVATION_SLOW) die later alsnog mislukt: zet de
   * extensie dan uit, ruim op en markeer haar als mislukt. Was ze intussen
   * vervangen of uitgezet, dan gebeurt er niets.
   */
  function volgTrageActivatie(id, api, laat) {
    laat.then(meld, (e) => {
      inWachtrij(async () => {
        const r = records.get(id);
        if (!r?.actief || r.actief.api !== api) return;
        const typen = annotatieTypenVan(r.actief);
        const klaar = await beginWissel(id);
        try {
          const w = await deactiveer(r.actief);
          if (w.length) console.warn('[extensies] opruimen na een mislukte trage activatie', w);
          r.actief = null;
          r.status = 'failed';
          r.error = { code: 'ACTIVATION_FAILED', message: `activate() threw: ${bericht(e)}`, at: iso() };
        } finally {
          naOpruimen({ typen });
          klaar();
        }
      });
    });
  }

  /**
   * Bevestig een transactie op schijf, met een paar pogingen. Pas daarna geldt
   * de installatie: een open journaal draait het herstel bij de volgende
   * start terug.
   */
  async function bevestig(transactie) {
    let laatste = null;
    for (let poging = 0; poging < BEVESTIG_POGINGEN; poging++) {
      if (poging) await pauze(BEVESTIG_PAUZE_MS * poging);
      try {
        await invoke('extensie_bevestig', { transactie });
        return { ok: true };
      } catch (e) {
        laatste = natieveFout(e);
        if (laatste.code === 'TRANSACTION_UNKNOWN') break;
      }
    }
    return { ok: false, ...laatste };
  }

  function annotatieTypenVan(entry) {
    try { return [...(entry?.api?._bijdragenOverzicht?.()?.annotationTypes ?? [])]; } catch { return []; }
  }

  async function deactiveer(entry) {
    const warnings = [];
    try {
      await metTijdgrens(Promise.resolve().then(() => entry.module?.deactivate?.()), deactivatieMs, 'DEACTIVATE_TIMEOUT');
    } catch (e) {
      warnings.push({ code: 'DEACTIVATE_FAILED', message: bericht(e) });
    }
    try {
      const w = entry.api?._cleanup?.();
      if (Array.isArray(w)) warnings.push(...w);
    } catch (e) {
      warnings.push({ code: 'CLEANUP_FAILED', message: bericht(e) });
    }
    return warnings;
  }

  function bijdragen(r) {
    try {
      const o = r.actief?.api?._bijdragenOverzicht?.();
      return o ? { ribbonTabs: o.ribbonTabs ?? [], commands: o.commands ?? 0 } : { ribbonTabs: [], commands: 0 };
    } catch {
      return { ribbonTabs: [], commands: 0 };
    }
  }

  function zetManifest(r, manifest) {
    r.name = manifest.name ?? r.name ?? null;
    r.version = manifest.version ?? null;
    r.description = manifest.description ?? null;
    r.author = manifest.author ?? null;
  }

  /**
   * Zet de draaiende versie uit en activeer de nieuwe. Bij een mislukte
   * activatie of bevestiging: terugdraaien op schijf (als er een transactie
   * is) en de vorige broncode opnieuw activeren.
   */
  async function wissel(id, nieuw, { transactie = null, bron, actie }) {
    const r = record(id);
    const vorige = r.actief;
    // Alleen MCP behandelt een trage activate als mislukt (en rolt terug).
    const streng = bron === 'mcp';
    // Eerste keer laden bij het opstarten: er verdwijnt niets, dus opslaan
    // hoeft niet te wachten. Anders eerst wachten tot een lopende save klaar is.
    const klaar = await beginWissel(id, { slot: Boolean(vorige) || bron !== 'startup' });
    const tabWas = lint.actief();
    const eigenTab = typeof tabWas === 'string' && tabWas.startsWith(`${id}.`) ? tabWas : null;
    const herstelTab = () => { if (eigenTab && lint.heeft(eigenTab)) lint.zet(eigenTab); };
    // Annotatietypen van de vorige versie: was een daarvan het actieve
    // gereedschap en bestaat het na de wissel niet meer, dan wordt het 'select'.
    const typen = annotatieTypenVan(vorige);
    r.status = 'busy';
    const warnings = [];
    try {
      if (vorige) warnings.push(...await deactiveer(vorige));
      r.actief = null;

      const poging = await activeer(id, nieuw.module, nieuw.manifest, { streng });
      warnings.push(...poging.warnings);
      let fout = poging.ok ? null : poging.fout;
      if (poging.ok && transactie) {
        const b = await bevestig(transactie);
        if (!b.ok) {
          // Niet vastgelegd: het herstel bij de volgende start zou de update
          // stil terugdraaien. Dan nu bewust terug, met een eerlijk resultaat.
          warnings.push(...await deactiveer({ module: nieuw.module, api: poging.api }));
          fout = { code: 'CONFIRM_FAILED', message: `the installation could not be confirmed on disk: ${b.message}` };
        }
      }
      if (!fout) {
        r.actief = { module: nieuw.module, api: poging.api, bron: nieuw.bron, manifest: nieuw.manifest };
        r.geladen = true;
        zetManifest(r, nieuw.manifest);
        r.status = 'active';
        r.error = null;
        r.source = bron;
        r.lastChange = { action: actie, at: iso(), source: bron };
        if (poging.laat) volgTrageActivatie(id, poging.api, poging.laat);
        herstelTab();
        return { ok: true, warnings };
      }

      // Terugrollen.
      let rollbackFout = null;
      let opSchijfTerug = false;
      if (transactie) {
        try {
          await invoke('extensie_terugdraaien', { transactie });
          opSchijfTerug = true;
        } catch (e) {
          rollbackFout = natieveFout(e);
        }
      }
      let actief = null;
      if (vorige) {
        let module = vorige.module;
        if (typeof vorige.bron === 'string') {
          try { module = await importeer(vorige.bron); } catch (e) { warnings.push({ code: 'RESTORE_FAILED', message: bericht(e) }); module = null; }
        }
        // De vorige versie werkte: een trage activate is hier geen reden om op te geven.
        const herstel = module ? await activeer(id, module, vorige.manifest, { streng: false }) : { ok: false, fout: { code: 'RESTORE_FAILED' }, warnings: [] };
        warnings.push(...herstel.warnings);
        if (herstel.ok) {
          r.actief = { module, api: herstel.api, bron: vorige.bron, manifest: vorige.manifest };
          zetManifest(r, vorige.manifest);
          r.status = 'active';
          actief = { version: vorige.manifest.version ?? null, activated: true };
          if (herstel.laat) volgTrageActivatie(id, herstel.api, herstel.laat);
          herstelTab();
        } else {
          r.status = 'failed';
          actief = { version: vorige.manifest.version ?? null, activated: false };
        }
      } else {
        r.status = 'failed';
      }
      r.error = { code: fout.code, message: fout.message, at: iso() };
      r.source = bron;
      r.lastChange = { action: actie, at: iso(), source: bron };
      r.geladen = true;
      // Een eerste installatie die mislukt, laat niets achter.
      if (!vorige && transactie && opSchijfTerug && !geinstalleerdVoorWissel(id, nieuw)) {
        records.delete(id);
      }
      const uit = {
        ok: false, code: fout.code, error: fout.message,
        rolledBack: opSchijfTerug || Boolean(actief?.activated), active: actief, warnings,
      };
      if (fout.cause) uit.cause = fout.cause;
      if (rollbackFout) {
        uit.cause = fout.code;
        uit.code = 'ROLLBACK_FAILED';
        uit.error = `${fout.message}; restoring the previous files failed: ${rollbackFout.message}`;
        uit.diskState = 'inconsistent';
      }
      return uit;
    } finally {
      if (r.status === 'busy') r.status = r.actief ? 'active' : 'failed';
      // Na het opruimen: gereedschap, hertekenen en eigenschappenpaneel (§4).
      naOpruimen({ typen });
      klaar();
    }
  }

  // Stond deze extensie al op schijf vóór de transactie (een eerder mislukte)?
  function geinstalleerdVoorWissel(id, nieuw) {
    return nieuw.wasGeinstalleerd === true;
  }

  function mislukt(code, message, extra = {}) {
    return { ok: false, code, error: message, ...extra };
  }

  async function laadVanSchijf(id, { bron, actie, transactie = null, manifest }) {
    let code;
    let module;
    const r = record(id);
    try {
      code = await invoke('read_plugin_file', { pluginId: id, filePath: 'index.js' });
      module = await importeer(code);
    } catch (e) {
      if (!r.actief) {
        r.status = 'failed';
        r.error = { code: 'MODULE_LOAD_FAILED', message: bericht(e), at: iso() };
        r.lastChange = { action: actie, at: iso(), source: bron };
        r.source = bron;
        zetManifest(r, manifest);
      }
      return { geladen: false, fout: { code: 'MODULE_LOAD_FAILED', message: `index.js could not be loaded: ${bericht(e)}` } };
    }
    const w = await wissel(id, { module, bron: code, manifest, wasGeinstalleerd: true }, { transactie, bron, actie });
    return { geladen: true, w };
  }

  function manifestUit(bron) {
    return {
      id: bron.id, name: bron.name ?? null, version: bron.version ?? null,
      description: bron.description ?? null, author: bron.author ?? null,
    };
  }

  async function voerInstallatieUit(pad, beleid, bron) {
    let info;
    try {
      // De bron bepaalt de padregels: alleen de bestandsdialoog mag een netwerkshare gebruiken.
      info = await invoke('extensie_inspecteer', { pad, bron });
    } catch (e) {
      const f = natieveFout(e);
      return mislukt(f.code, f.message, { id: null, version: null, activated: false, rolledBack: false, active: null });
    }
    const id = info.id;
    const r = records.get(id);
    const vorige = actieveStaat(r);
    const basis = { id, name: info.name ?? null, version: info.version ?? null };
    let ins;
    try {
      ins = await invoke('extensie_installeer', { pad, beleid, verwachteSha256: info.sha256, bron });
    } catch (e) {
      const f = natieveFout(e);
      return mislukt(f.code, f.message, { ...basis, activated: false, rolledBack: false, active: vorige });
    }
    const manifest = manifestUit(info);
    const wasGeinstalleerd = geinstalleerd.has(id);

    if (ins.outcome === 'unchanged') {
      await haalLijst().catch(() => {});
      if (r?.actief) {
        return {
          ok: true, outcome: 'unchanged', ...basis, previousVersion: ins.previousVersion ?? r.version ?? null,
          activated: true, rolledBack: false, warnings: [], contributions: bijdragen(r),
        };
      }
      // Wel geïnstalleerd, maar niet actief: een laadpoging zoals herladen.
      const l = await laadVanSchijf(id, { bron, actie: 'installed', manifest });
      const nr = records.get(id);
      if (!l.geladen) return mislukt(l.fout.code, l.fout.message, { ...basis, activated: false, rolledBack: false, active: null });
      if (!l.w.ok) return { ...basis, activated: false, ...l.w };
      return {
        ok: true, outcome: 'unchanged', ...basis, previousVersion: ins.previousVersion ?? null,
        activated: true, rolledBack: false, warnings: l.w.warnings, contributions: bijdragen(nr),
      };
    }

    // Nieuwe code lezen en importeren vóór de oude versie wordt uitgezet.
    let code;
    let module;
    try {
      code = await invoke('read_plugin_file', { pluginId: id, filePath: 'index.js' });
      module = await importeer(code);
    } catch (e) {
      const extra = { ...basis, activated: false, rolledBack: true, active: vorige };
      try {
        await invoke('extensie_terugdraaien', { transactie: ins.transactie });
      } catch (t) {
        const f = natieveFout(t);
        return mislukt('ROLLBACK_FAILED', `index.js could not be loaded (${bericht(e)}); restoring the previous files failed: ${f.message}`,
          { ...extra, rolledBack: false, cause: 'MODULE_LOAD_FAILED', diskState: 'inconsistent' });
      }
      await haalLijst().catch(() => {});
      return mislukt('MODULE_LOAD_FAILED', `index.js could not be loaded: ${bericht(e)}`, extra);
    }

    const w = await wissel(id, { module, bron: code, manifest, wasGeinstalleerd }, {
      transactie: ins.transactie, bron, actie: ins.outcome,
    });
    await haalLijst().catch(() => {});
    const nr = records.get(id);
    if (!w.ok) return { ...basis, activated: false, ...w };
    return {
      ok: true, outcome: ins.outcome, ...basis, previousVersion: ins.previousVersion ?? null,
      activated: true, rolledBack: false, warnings: w.warnings, contributions: bijdragen(nr),
    };
  }

  async function voerUitVeilig(fn, id) {
    try {
      return await fn();
    } catch (e) {
      return mislukt('INSTALL_IO_FAILED', bericht(e), { id: id ?? null, activated: false, rolledBack: false, active: null });
    }
  }

  function ruimSleutelsOp() {
    const grens = nu() - SLEUTEL_TTL_MS;
    for (const [k, v] of sleutels) if (v.klaar && v.at < grens) sleutels.delete(k);
    while (sleutels.size > MAX_SLEUTELS) sleutels.delete(sleutels.keys().next().value);
  }

  function vorm(r, { includeContributions = false } = {}) {
    const inst = geinstalleerd.get(r.id);
    const uit = {
      id: r.id,
      name: r.name ?? inst?.name ?? null,
      version: r.actief ? (r.actief.manifest.version ?? null) : (r.version ?? inst?.version ?? null),
      description: r.description ?? inst?.description ?? null,
      author: r.author ?? inst?.author ?? null,
      installed: Boolean(inst),
      installedVersion: inst?.version ?? null,
      loaded: r.geladen,
      activated: Boolean(r.actief) && r.status !== 'busy',
      status: r.status,
      error: r.error,
      source: r.source,
      installedVia: inst?.source ?? null,
      legacyId: inst?.legacyId === true,
      lastChange: r.lastChange,
    };
    if (includeContributions) {
      let c = { ribbonTabs: [], commands: 0, annotationTypes: [], palettes: [], propertyPanels: [] };
      try { c = { ...c, ...(r.actief?.api?._bijdragenOverzicht?.() ?? {}) }; } catch { /* leeg overzicht */ }
      uit.contributions = c;
    }
    return uit;
  }

  return {
    /** De extensies zoals de app ze nu kent (geïnstalleerd en/of geladen). */
    lijst(opties = {}) {
      for (const id of geinstalleerd.keys()) record(id);
      return [...records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => vorm(r, opties));
    },

    /** Eerst de native lijst verversen; daarna de lijst met problemen. */
    async lijstVers(opties = {}) {
      try { await haalLijst(); } catch (e) { problemen = [{ folder: null, ...natieveFout(e), error: natieveFout(e).message }]; }
      return { extensions: this.lijst(opties), problems: problemen.map(({ folder, code, error }) => ({ folder, code, error })) };
    },

    /**
     * Installeer of werk bij vanaf een lokaal pakket. `sleutel` maakt de
     * aanvraag idempotent binnen deze app-sessie.
     */
    async installeer({ pad, beleid, sleutel, bron = 'mcp' }) {
      ruimSleutelsOp();
      const bestaand = sleutels.get(sleutel);
      if (bestaand) {
        if (bestaand.pad !== pad || bestaand.beleid !== beleid) {
          return mislukt('IDEMPOTENCY_KEY_REUSED', 'this idempotencyKey was already used with a different path or replace policy',
            { id: null, activated: false, rolledBack: false, active: null, replayed: false });
        }
        const r = await bestaand.belofte;
        return { ...r, replayed: true };
      }
      const belofte = inWachtrij(() => voerUitVeilig(() => voerInstallatieUit(pad, beleid, bron)));
      const ingang = { pad, beleid, belofte, at: nu(), klaar: false };
      sleutels.set(sleutel, ingang);
      ruimSleutelsOp();
      const r = await belofte;
      ingang.klaar = true;
      ingang.at = nu();
      return { ...r, replayed: false };
    },

    /** Herlaad een extensie van schijf: uitzetten, opruimen, opnieuw activeren. */
    herlaad(id, { bron = 'mcp' } = {}) {
      return inWachtrij(() => voerUitVeilig(async () => {
        try { await haalLijst(); } catch { /* dan met de laatst bekende lijst */ }
        const inst = geinstalleerd.get(id);
        const r = records.get(id);
        if (!inst && !r?.actief) return mislukt('NOT_INSTALLED', `extension ${id} is not installed`, { id, activated: false, rolledBack: false, active: null });
        const manifest = inst ? manifestUit(inst) : r.actief.manifest;
        const basis = { id, version: manifest.version ?? null };
        if (!inst) {
          // Geladen maar niet op schijf (ingebouwd): dezelfde module opnieuw.
          const w = await wissel(id, { module: r.actief.module, bron: r.actief.bron, manifest }, { bron, actie: 'reloaded' });
          return w.ok ? { ok: true, outcome: 'reloaded', ...basis, activated: true, rolledBack: false, active: actieveStaat(records.get(id)),
            warnings: w.warnings, contributions: bijdragen(records.get(id)) } : { ...basis, activated: false, ...w };
        }
        const l = await laadVanSchijf(id, { bron, actie: 'reloaded', manifest });
        if (!l.geladen) {
          return mislukt(l.fout.code, l.fout.message, { ...basis, activated: Boolean(records.get(id)?.actief), rolledBack: false,
            active: actieveStaat(records.get(id)) });
        }
        if (!l.w.ok) return { ...basis, activated: false, ...l.w };
        const nr = records.get(id);
        return {
          ok: true, outcome: 'reloaded', ...basis, activated: true, rolledBack: false,
          active: actieveStaat(nr), warnings: l.w.warnings, contributions: bijdragen(nr),
        };
      }, id));
    },

    /** Zet uit, ruim op en verwijder van schijf. */
    verwijder(id, { bron = 'ui' } = {}) {
      return inWachtrij(() => voerUitVeilig(async () => {
        const r = records.get(id);
        const warnings = [];
        if (r?.actief) {
          const typen = annotatieTypenVan(r.actief);
          const klaar = await beginWissel(id);
          try {
            warnings.push(...await deactiveer(r.actief));
            r.actief = null;
          } finally {
            naOpruimen({ typen });
            klaar();
          }
        }
        try {
          await invoke('uninstall_plugin', { id });
        } catch (e) {
          const f = natieveFout(e);
          if (r) { r.status = 'failed'; r.error = { code: f.code, message: f.message, at: iso() }; }
          return mislukt(f.code, f.message, { id, warnings });
        }
        records.delete(id);
        try { await haalLijst(); } catch { geinstalleerd.delete(id); }
        void bron;
        return { ok: true, id, warnings };
      }, id));
    },

    /** Zet een extensie uit zonder haar van schijf te halen. */
    zetUit(id, { bron = 'ui' } = {}) {
      return inWachtrij(async () => {
        const r = records.get(id);
        if (!r?.actief) return { ok: false, code: 'NOT_LOADED', error: `extension ${id} is not active`, id };
        const typen = annotatieTypenVan(r.actief);
        const klaar = await beginWissel(id);
        const warnings = [];
        try {
          warnings.push(...await deactiveer(r.actief));
          r.actief = null;
          r.status = 'notLoaded';
          r.source = bron;
          r.lastChange = { action: 'unloaded', at: iso(), source: bron };
        } finally {
          naOpruimen({ typen });
          klaar();
        }
        return { ok: true, id, warnings };
      });
    },

    /** Bij het opstarten: herstel, dan elke geïnstalleerde extensie laden. */
    laadBijStart() {
      return inWachtrij(async () => {
        let lijst;
        try {
          lijst = await haalLijst(true);
        } catch (e) {
          problemen = [{ folder: null, code: natieveFout(e).code, error: natieveFout(e).message }];
          return;
        }
        for (const ext of lijst.extensions ?? []) {
          if (records.get(ext.id)?.actief) continue;
          try {
            await laadVanSchijf(ext.id, { bron: 'startup', actie: 'loaded', manifest: manifestUit(ext) });
          } catch (e) {
            console.warn(`[extensies] laden van ${ext.id} mislukt`, e);
          }
        }
      });
    },

    /** Een module die al in het geheugen staat (ingebouwd of oude laadroute). */
    laadModule(module, manifest) {
      return inWachtrij(async () => {
        const id = manifest?.id;
        if (!id) return mislukt('MANIFEST_INVALID', 'plugin has no manifest id');
        if (records.get(id)?.actief) return mislukt('ALREADY_LOADED', `extension ${id} is already loaded`, { id });
        const w = await wissel(id, { module, bron: null, manifest: manifestUit(manifest) }, { bron: 'startup', actie: 'loaded' });
        return w.ok ? { ok: true, id } : { id, ...w };
      });
    },

    /** Klaar zodra er geen wissel loopt; direct klaar als er geen loopt. */
    wachtOpExtensieWissel() {
      return wachtOpWisselSlot();
    },

    isBezig: (id) => bezig.has(id),

    /** Luister naar wijzigingen (na elke bewerking, en bij begin en einde van een wissel). */
    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },

    /** De draaiende module en API van een extensie, of null. */
    actief: (id) => records.get(id)?.actief ?? null,
  };
}
