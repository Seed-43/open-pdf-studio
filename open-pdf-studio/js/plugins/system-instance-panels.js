/**
 * Eigenschappenformulieren van extensies voor native systeem-instances (#574).
 *
 * `api.registerSystemInstancePanel(descriptor)` registreert een formulier dat
 * alleen verschijnt bij een geselecteerde systeem-instance die past: een
 * instance die aan de extensie gekoppeld is ('linked'), een instance met een
 * eigen systeemtype van de extensie ('ownedType'), beide, of een eigen
 * predicaat op een losgekoppelde snapshot. Een gewone instance houdt het
 * native paneel zonder formulier.
 *
 * Conflicten zijn bepaald: er wordt nooit iets vervangen. Elke passende
 * bijdrage krijgt een eigen sectie onder de native secties, in de volgorde
 * (order, extensie-id, paneel-id). Dezelfde extensie kan een paneel-id maar
 * één keer gebruiken (CONTRIBUTION_CONFLICT).
 *
 * De host (maakPaneelHost) houdt de open formulieren bij. Het formulier werkt
 * op een werkversie (setDraft); pas Toepassen schrijft, met de revisie van
 * de snapshot, via dezelfde weg als updateSystemInstance (native validatie,
 * één undo-stap). Annuleren gooit de werkversie weg en laadt de huidige
 * waarden. Bij elke andere selectie, een documentwissel, deselectie of het
 * uitzetten van de extensie wordt het formulier opgeruimd: de opruimfunctie
 * van de extensie draait en het AbortSignal gaat af.
 *
 * Zuivere module: geen DOM en geen app-state; de container komt van de
 * Solid-component (ScopedInstancePanels.jsx), de snapshots en het toepassen
 * van plugin-api.js. Contract: docs/plugin-systeemtypen.md §16.
 */

import { ExtensionContributionError } from './extension-contributions.js';
import { kiesTekst } from './extension-commands.js';
import { EXTENSIE_ID_RE } from '../annotations/systeem-typen.js';

const LOKAAL_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_PER_EXTENSIE = 4;
const MAX_TITEL = 60;
const VELDEN = new Set(['id', 'title', 'matches', 'order', 'render']);
const SOORTEN = new Set(['linked', 'ownedType', 'linkedOrOwnedType']);
const DRAFT_VELDEN = new Set(['data', 'systemTypeId', 'showTag']);

const ongeldig = (bericht) => new ExtensionContributionError('INVALID_CONTRIBUTION', bericht);
const isPlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const kloon = (v) => JSON.parse(JSON.stringify(v));

function vries(v) {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const k of Object.keys(v)) vries(v[k]);
  }
  return v;
}

function vergelijk(a, b) {
  return a.order - b.order || (a.extId < b.extId ? -1 : a.extId > b.extId ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Past de bijdrage op deze snapshot (van de eigen extensie)? */
export function past(entry, snapshot) {
  if (!snapshot) return false;
  const gekoppeld = Boolean(snapshot.link);
  switch (entry.matches) {
    case 'linked': return gekoppeld;
    case 'ownedType': return snapshot.ownedType === true;
    case 'linkedOrOwnedType': return gekoppeld || snapshot.ownedType === true;
    default:
      try {
        return entry.matches(vries(kloon(snapshot))) === true;
      } catch (e) {
        console.warn(`[extensies] matches() of panel ${entry.extId}/${entry.id} threw`, e);
        return false;
      }
  }
}

export function maakInstancePaneelRegister() {
  const panelen = new Map();
  const luisteraars = new Set();
  const sleutel = (extId, id) => `${extId}\u0000${id}`;
  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };

  return {
    /** Controleer een descriptor; gooit INVALID_CONTRIBUTION of LIMIT_EXCEEDED. */
    controleer(extId, d) {
      if (typeof extId !== 'string' || !EXTENSIE_ID_RE.test(extId)) throw ongeldig(`invalid extension id ${JSON.stringify(extId)}`);
      if (!isPlatObject(d)) throw ongeldig('registerSystemInstancePanel needs a descriptor object');
      for (const k of Object.keys(d)) if (!VELDEN.has(k)) throw ongeldig(`unknown panel field "${k}"`);
      if (typeof d.id !== 'string' || !LOKAAL_ID.test(d.id)) throw ongeldig('id must be 1-48 characters of a-z, 0-9 and "-"');
      const tekstGoed = (t) => typeof t === 'string' && t.trim().length > 0 && t.length <= MAX_TITEL;
      if (!(tekstGoed(d.title) || (isPlatObject(d.title) && Object.keys(d.title).length && Object.values(d.title).every(tekstGoed)))) {
        throw ongeldig(`title must be text of 1-${MAX_TITEL} characters, or an object of such texts per language`);
      }
      if (!(SOORTEN.has(d.matches) || typeof d.matches === 'function')) {
        throw ongeldig("matches must be 'linked', 'ownedType', 'linkedOrOwnedType' or a function(snapshot) returning true");
      }
      const order = d.order ?? 0;
      if (!Number.isInteger(order) || order < -1000 || order > 1000) throw ongeldig('order must be an integer of -1000 to 1000');
      if (typeof d.render !== 'function') throw ongeldig('render must be a function(container, ctx)');
      if ([...panelen.values()].filter((p) => p.extId === extId).length >= MAX_PER_EXTENSIE) {
        throw new ExtensionContributionError('LIMIT_EXCEEDED', `an extension can register at most ${MAX_PER_EXTENSIE} system instance panels`);
      }
      return {
        extId, id: d.id, title: typeof d.title === 'string' ? d.title : { ...d.title },
        matches: d.matches, order, render: d.render,
      };
    },

    voegToe(entry) {
      const k = sleutel(entry.extId, entry.id);
      if (panelen.has(k)) {
        throw new ExtensionContributionError('CONTRIBUTION_CONFLICT', `system instance panel "${entry.id}" is already registered by ${entry.extId}`);
      }
      panelen.set(k, entry);
      meld();
    },

    verwijder(extId, id) {
      if (panelen.delete(sleutel(extId, id))) meld();
    },

    vanExtensie: (extId) => [...panelen.values()].filter((p) => p.extId === extId).map((p) => p.id),

    /**
     * De passende bijdragen voor een instance, in vaste volgorde, elk met de
     * snapshot van de eigen extensie. `snapshotVoor(extId)` → snapshot | null.
     */
    passend(snapshotVoor) {
      const uit = [];
      const perExtensie = new Map();
      for (const entry of [...panelen.values()].sort(vergelijk)) {
        if (!perExtensie.has(entry.extId)) perExtensie.set(entry.extId, snapshotVoor(entry.extId));
        const snapshot = perExtensie.get(entry.extId);
        if (past(entry, snapshot)) uit.push({ entry, snapshot });
      }
      return uit;
    },

    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },

    /** Alleen voor tests en diagnose. */
    aantalLuisteraars: () => luisteraars.size,
    aantal: () => panelen.size,
  };
}

export const instancePanelen = maakInstancePaneelRegister();

/**
 * De host van de open formulieren.
 * @param {{ register, snapshotVoor: (extId, annotationId) => snapshot|null,
 *   pasToe: (extId, annotationId, changes) => { instance },
 *   taal?: () => string }} afh
 */
export function maakPaneelHost({ register, snapshotVoor, pasToe, taal = () => 'en' }) {
  let selectie = null;
  let sessies = [];
  let generatie = 0;
  const luisteraars = new Set();
  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };

  function sluitSessie(s) {
    if (s.gesloten) return;
    s.gesloten = true;
    s.regelaar.abort();
    if (typeof s.opruimen === 'function') {
      try { s.opruimen(); } catch (e) { console.warn(`[extensies] cleanup of panel ${s.entry.extId}/${s.entry.id} threw`, e); }
    }
    s.opruimen = null;
  }

  function maakSessie(entry, snapshot, melding = null) {
    const s = {
      sleutel: `${entry.extId}\u0000${entry.id}\u0000${snapshot.annotationId}\u0000${snapshot.revision}\u0000${++generatie}`,
      entry, instance: snapshot, draft: null, bezig: false, melding,
      regelaar: new AbortController(), opruimen: null, gesloten: false, gemount: false,
    };
    s.ctx = Object.freeze({
      instance: vries(kloon(snapshot)),
      signal: s.regelaar.signal,
      /** Zet de werkversie: { data?, systemTypeId?, showTag? }, of null. */
      setDraft(changes) {
        if (s.gesloten) return;
        if (changes === null || changes === undefined) {
          s.draft = null;
        } else {
          if (!isPlatObject(changes)) throw new TypeError('setDraft needs an object or null');
          for (const k of Object.keys(changes)) {
            if (!DRAFT_VELDEN.has(k)) throw new TypeError(`setDraft: unknown field "${k}"`);
          }
          s.draft = kloon(changes);
        }
        s.melding = null;
        meld();
      },
      getDraft: () => (s.draft ? kloon(s.draft) : null),
      apply: () => pasSessieToe(s),
      cancel: () => annuleerSessie(s),
    });
    return s;
  }

  function titel(s) {
    return kiesTekst(s.entry.title, taal());
  }

  /** Bepaal de formulieren voor de huidige selectie opnieuw. */
  function synchroniseer({ melding = null } = {}) {
    const gewenst = selectie
      ? register.passend((extId) => snapshotVoor(extId, selectie.annotationId))
      : [];
    const volgende = [];
    for (const { entry, snapshot } of gewenst) {
      const bestaand = sessies.find((s) => !s.gesloten && s.entry === entry
        && s.instance.annotationId === snapshot.annotationId && s.instance.revision === snapshot.revision);
      // Dezelfde instance met een nieuwe revisie terwijl er een werkversie
      // openstond (elders gewijzigd, bijvoorbeeld via MCP): de werkversie
      // vervalt, en het nieuwe formulier zegt dat.
      const verlopen = !bestaand && sessies.some((s) => !s.gesloten && s.entry === entry && s.draft
        && s.instance.annotationId === snapshot.annotationId);
      volgende.push(bestaand ?? maakSessie(entry, snapshot, melding?.(entry) ?? (verlopen ? { soort: 'stale' } : null)));
    }
    for (const s of sessies) if (!volgende.includes(s)) sluitSessie(s);
    const veranderd = volgende.length !== sessies.length || volgende.some((s, i) => s !== sessies[i]);
    sessies = volgende;
    if (veranderd) meld();
  }

  async function pasSessieToe(s) {
    if (s.gesloten || s.bezig) return { ok: false, code: 'busy' };
    if (!s.draft) return { ok: false, code: 'no-changes' };
    s.bezig = true;
    meld();
    try {
      const r = pasToe(s.entry.extId, s.instance.annotationId, { expectedRevision: s.instance.revision, ...kloon(s.draft) });
      s.draft = null;
      s.bezig = false;
      // De revisie is veranderd: het formulier komt opnieuw met de nieuwe snapshot.
      synchroniseer();
      return { ok: true, status: r?.status ?? 'updated', revision: r?.instance?.revision ?? null };
    } catch (e) {
      s.bezig = false;
      const code = e?.code ?? 'failed';
      if (code === 'stale-revision' || code === 'not-found' || code === 'not-linked') {
        // Elders gewijzigd: niets is geschreven; het formulier toont de
        // huidige waarden met een melding.
        sluitSessie(s);
        sessies = sessies.filter((x) => x !== s);
        synchroniseer({ melding: (entry) => (entry === s.entry ? { soort: 'stale' } : null) });
        meld();
      } else {
        s.melding = { soort: 'failed', tekst: String(e?.message ?? e) };
        meld();
      }
      return { ok: false, code, error: String(e?.message ?? e) };
    }
  }

  function annuleerSessie(s) {
    if (s.gesloten) return;
    // Werkversie weg, huidige waarden opnieuw: een nieuwe sessie.
    sluitSessie(s);
    sessies = sessies.filter((x) => x !== s);
    synchroniseer();
    meld();
  }

  return {
    /** De selectie veranderde: { documentId, annotationId } of null. */
    toon(nieuw) {
      selectie = nieuw && nieuw.annotationId ? { documentId: nieuw.documentId ?? null, annotationId: nieuw.annotationId } : null;
      synchroniseer();
    },

    /** Het register veranderde (registreren, uitzetten van een extensie). */
    ververs: () => synchroniseer(),

    /** De open formulieren, voor de weergave. */
    sessies: () => sessies.map((s) => ({
      sleutel: s.sleutel, extensionId: s.entry.extId, panelId: s.entry.id, titel: titel(s),
      dirty: Boolean(s.draft), bezig: s.bezig, melding: s.melding, locked: s.instance.locked === true,
    })),

    /** Laat de extensie haar formulier in `container` tekenen (één keer per sessie). */
    mount(sleutel, container) {
      const s = sessies.find((x) => x.sleutel === sleutel);
      if (!s || s.gesloten || s.gemount) return false;
      s.gemount = true;
      try {
        const opruimen = s.entry.render(container, s.ctx);
        s.opruimen = typeof opruimen === 'function' ? opruimen : null;
      } catch (e) {
        console.warn(`[extensies] render of panel ${s.entry.extId}/${s.entry.id} threw`, e);
        s.melding = { soort: 'failed', tekst: String(e?.message ?? e) };
        meld();
      }
      return true;
    },

    pasToe(sleutel) {
      const s = sessies.find((x) => x.sleutel === sleutel);
      return s ? pasSessieToe(s) : Promise.resolve({ ok: false, code: 'gone' });
    },

    annuleer(sleutel) {
      const s = sessies.find((x) => x.sleutel === sleutel);
      if (s) annuleerSessie(s);
    },

    /** Alles opruimen (het paneel verdwijnt). */
    sluit() {
      selectie = null;
      for (const s of sessies) sluitSessie(s);
      const had = sessies.length > 0;
      sessies = [];
      if (had) meld();
    },

    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
}
