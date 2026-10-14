// Het publieke contract voor systeemtypen (#567) — PUUR (geen app-state, UI
// of DOM). De plugin-API (js/plugins/system-type-api.js), MCP
// (systeem-typen-mcp.js) en de native editor gebruiken allemaal deze regels;
// de registry (systeem-typen-registry.js) voert de plannen uit.
//
// Kern (zie docs/plugin-systeemtypen.md):
//  - EIGENDOM zit in het id: `ext:<extensionId>#<key>` (extensie),
//    `mcp:<key>` (MCP), al het andere is van de app en alleen door de
//    gebruiker te wijzigen.
//  - De INGANG is streng: alleen de velden van schema 1, elk veld gecontroleerd,
//    onbekende velden geweigerd (ook genest). De native normalisatie blijft
//    tolerant voor bestaande opslag en PDF-snapshots.
//  - Elke afwijzing is ATOMAIR: eerst alles controleren, dan pas een nieuw
//    plan; bij een fout blijft de invoer onaangeroerd.
//  - Uitkomsten die geen fout zijn (unchanged, kept-user-edit, …) komen als
//    `status` terug. Foutteksten zijn Engels: ze gaan naar extensies en MCP.

import {
  EXTENSIE_ID_RE, TYPE_KEY_RE, eigenaarVanId, heeftEigenaar, isDoorGebruikerBewerkt,
  normalizeSysteemType, findSysteemType, systeemTypeDefinitie, systeemTypeDefinitieGelijk,
  onbevestigdeMaten, revisieNaGrafsteen,
} from './systeem-typen.js';
import { assertSerializable } from '../plugins/annotation-batch.js';

export { eigenaarVanId };

/** Versie van het contractschema. */
export const SYSTEEMTYPE_SCHEMA = 1;

/** Afwijzing van het contract: `name` 'SystemTypeError', een `code` uit de
 *  tabel in §4.4, optioneel `field` en (bij stale-revision) `currentRevision`. */
export class SysteemTypeFout extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'SystemTypeError';
    this.code = code;
    if (extra.field !== undefined) this.field = extra.field;
    if (extra.currentRevision !== undefined) this.currentRevision = extra.currentRevision;
  }
}

const fout = (code, message, extra) => new SysteemTypeFout(code, message, extra);

// ── de velden van schema 1 (§4.3) ──────────────────────────────────────────

const VELDEN = ['naam', 'categorie', 'layout', 'ifcCategory', 'ifcPredefinedType', 'celXMm', 'celYMm',
  'strookBreedteMm', 'edgeProfiel', 'sparingRegels', 'paneelTypen', 'lagen'];
const VERPLICHT = ['naam', 'categorie', 'layout'];
const ALLEEN_LEZEN = ['id', 'revisie', 'eigenaarRevisie', 'revision', 'ownerRevision', 'owner',
  'userEdited', 'schema', 'definition', 'unconfirmed', 'problems'];
const CATEGORIEEN = ['plafond', 'vloer', 'wand', 'overig'];
const LAYOUTS = ['raster', 'strook'];
const IFC_CATEGORIEEN = ['IfcCovering', 'IfcWall', 'IfcSlab', 'IfcPlate'];
const IFC_PREDEFINED = ['CEILING', 'FLOORING', 'FLOOR', 'CLADDING', 'ROOFING'];
const EDGE_PROFIELEN = ['geen', 'hoeklijn', 'schaduwvoeg'];
const RENDER_STIJLEN = ['tegel', 'ventilatie', 'licht'];
const MAAT = { min: 50, max: 20000 };       // SYSTEEMRASTER_PLAAT_RANGE
const DREMPEL = { min: 10, max: 20000 };
const PANEEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LAGEN_MELDING = 'layered system types are not supported by schema 1 (one implicit layer)';

const isPlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

function tekst(waarde, veld) {
  if (typeof waarde !== 'string') throw fout('invalid-field', `${veld} must be a string`, { field: veld });
  const t = waarde.trim();
  if (t.length < 1 || t.length > 200) {
    throw fout('invalid-field', `${veld} must be 1-200 characters`, { field: veld });
  }
  return t;
}

function keuze(lijst) {
  return (waarde, veld) => {
    if (!lijst.includes(waarde)) {
      throw fout('invalid-field', `${veld} must be one of ${lijst.join(', ')}`, { field: veld });
    }
    return waarde;
  };
}

function getal(bereik) {
  return (waarde, veld) => {
    if (typeof waarde !== 'number' || !Number.isFinite(waarde) || waarde < bereik.min || waarde > bereik.max) {
      throw fout('invalid-field', `${veld} must be a number from ${bereik.min} to ${bereik.max} (mm)`, { field: veld });
    }
    return waarde;
  };
}

function sparingRegels(waarde, veld) {
  if (!isPlatObject(waarde)) throw fout('invalid-field', `${veld} must be an object`, { field: veld });
  const uit = {};
  for (const sleutel of Object.keys(waarde)) {
    if (sleutel !== 'kleineSparingMaxMm' && sleutel !== 'raveelVanafMm') {
      throw fout('unknown-field', `unknown field: ${veld}.${sleutel}`, { field: `${veld}.${sleutel}` });
    }
    if (waarde[sleutel] === undefined) continue;
    uit[sleutel] = getal(DREMPEL)(waarde[sleutel], `${veld}.${sleutel}`);
  }
  if (Object.keys(uit).length === 0) {
    throw fout('invalid-field', `${veld} must contain kleineSparingMaxMm and/or raveelVanafMm`, { field: veld });
  }
  if ('kleineSparingMaxMm' in uit && 'raveelVanafMm' in uit && uit.kleineSparingMaxMm > uit.raveelVanafMm) {
    throw fout('invalid-field', `${veld}.kleineSparingMaxMm must not exceed ${veld}.raveelVanafMm`, { field: veld });
  }
  return uit;
}

// De grens geldt voor het OPGESLAGEN assortiment: de normalisatie vult
// 'tegel' aan als het ontbreekt, dus zonder 'tegel' mogen er 49 zijn.
const MAX_PANEELTYPEN = 50;

function paneelTypen(waarde, veld) {
  const metTegel = Array.isArray(waarde) && waarde.some(p => isPlatObject(p) && p.id === 'tegel');
  const max = metTegel ? MAX_PANEELTYPEN : MAX_PANEELTYPEN - 1;
  if (!Array.isArray(waarde) || waarde.length < 1 || waarde.length > max) {
    throw fout('invalid-field',
      `${veld} must be an array of 1-${MAX_PANEELTYPEN} panel types, counting 'tegel' (added when it is missing)`,
      { field: veld });
  }
  const ids = new Set();
  return waarde.map((p, i) => {
    const pad = `${veld}[${i}]`;
    if (!isPlatObject(p)) throw fout('invalid-field', `${pad} must be an object`, { field: pad });
    for (const sleutel of Object.keys(p)) {
      if (!['id', 'naam', 'renderStijl'].includes(sleutel)) {
        throw fout('unknown-field', `unknown field: ${pad}.${sleutel}`, { field: `${pad}.${sleutel}` });
      }
    }
    for (const sleutel of ['id', 'naam', 'renderStijl']) {
      if (p[sleutel] === undefined || p[sleutel] === null) {
        throw fout('missing-field', `missing field: ${pad}.${sleutel}`, { field: `${pad}.${sleutel}` });
      }
    }
    if (typeof p.id !== 'string' || !PANEEL_ID_RE.test(p.id)) {
      throw fout('invalid-field', `${pad}.id must match ${PANEEL_ID_RE}`, { field: `${pad}.id` });
    }
    if (ids.has(p.id)) throw fout('invalid-field', `duplicate panel type id: ${p.id}`, { field: `${pad}.id` });
    ids.add(p.id);
    return {
      id: p.id,
      naam: tekst(p.naam, `${pad}.naam`),
      renderStijl: keuze(RENDER_STIJLEN)(p.renderStijl, `${pad}.renderStijl`),
    };
  });
}

function lagen(waarde, veld) {
  if (!Array.isArray(waarde)) throw fout('invalid-field', `${veld} must be an array`, { field: veld });
  if (waarde.length > 0) throw fout('unsupported-field', LAGEN_MELDING, { field: veld });
  return [];
}

const CONTROLE = {
  naam: tekst,
  categorie: keuze(CATEGORIEEN),
  layout: keuze(LAYOUTS),
  ifcCategory: keuze(IFC_CATEGORIEEN),
  ifcPredefinedType: keuze(IFC_PREDEFINED),
  celXMm: getal(MAAT),
  celYMm: getal(MAAT),
  strookBreedteMm: getal(MAAT),
  edgeProfiel: keuze(EDGE_PROFIELEN),
  sparingRegels,
  paneelTypen,
  lagen,
};

/**
 * Controleer een definitie (modus 'registreren') of een set wijzigingen
 * (modus 'bijwerken') tegen schema 1. Geeft de opgeschoonde velden terug;
 * bij registreren zonder null-waarden (null = niet gegeven), bij bijwerken
 * met null (= optioneel veld weghalen). Gooit een SysteemTypeFout.
 */
export function valideerDefinitie(invoer, modus = 'registreren') {
  const wat = modus === 'bijwerken' ? 'changes' : 'definition';
  if (!isPlatObject(invoer)) throw fout('invalid-argument', `${wat} must be a plain object`);
  for (const veld of Object.keys(invoer)) {
    if (ALLEEN_LEZEN.includes(veld)) throw fout('readonly-field', `${veld} is read-only`, { field: veld });
    if (!VELDEN.includes(veld)) throw fout('unknown-field', `unknown field: ${veld}`, { field: veld });
  }
  try {
    assertSerializable(invoer, wat);
  } catch (e) {
    const pad = String(e.message).split(' ')[0];
    const veld = pad.startsWith(`${wat}.`) ? pad.slice(wat.length + 1) : undefined;
    throw fout('invalid-field', String(e.message), { field: veld });
  }
  // Losgekoppelde kopie: elke waarde wordt hier precies één keer gelezen, en
  // gecontroleerd wordt precies wat bewaard wordt (een getter kan na de
  // controle geen andere waarde meer teruggeven).
  const def = JSON.parse(JSON.stringify(invoer));
  const uit = {};
  for (const veld of VELDEN) {
    if (!(veld in def) || def[veld] === undefined) continue;
    if (def[veld] === null) {
      if (VERPLICHT.includes(veld)) throw fout('invalid-field', `${veld} is required and cannot be null`, { field: veld });
      if (modus === 'bijwerken') uit[veld] = null;
      continue;
    }
    uit[veld] = CONTROLE[veld](def[veld], veld);
  }
  if (modus !== 'bijwerken') {
    for (const veld of VERPLICHT) {
      if (!(veld in uit)) throw fout('missing-field', `missing field: ${veld}`, { field: veld });
    }
  }
  return uit;
}

/** `schema` mag ontbreken of 1 zijn. */
export function valideerSchema(schema) {
  if (schema !== undefined && schema !== SYSTEEMTYPE_SCHEMA) {
    throw fout('unsupported-version', `unsupported schema: ${JSON.stringify(schema)} (this app supports schema ${SYSTEEMTYPE_SCHEMA})`);
  }
}

function controleerOpties(invoer, toegestaan, verplicht = false) {
  if (invoer === undefined && !verplicht) return {};
  if (!isPlatObject(invoer)) throw fout('invalid-argument', `options must be an object with ${toegestaan.join(', ')}`);
  for (const sleutel of Object.keys(invoer)) {
    if (!toegestaan.includes(sleutel)) throw fout('invalid-argument', `unknown option: ${sleutel}`);
  }
  // Kopie: elke optie wordt één keer gelezen (zie valideerDefinitie).
  const opties = { ...invoer };
  valideerSchema(opties.schema);
  return opties;
}

// ── eigendom (§3) ──────────────────────────────────────────────────────────

/** Het stabiele id voor een eigenaar ({kind:'extension', extensionId} of
 *  {kind:'mcp'}) en een key. Gooit invalid-owner of invalid-key. */
export function typeIdVoor(eigenaar, key) {
  if (!eigenaar || typeof eigenaar !== 'object' || !['extension', 'mcp'].includes(eigenaar.kind)) {
    throw fout('invalid-owner', 'system types can only be owned by an extension or by MCP');
  }
  if (eigenaar.kind === 'extension'
      && (typeof eigenaar.extensionId !== 'string' || !EXTENSIE_ID_RE.test(eigenaar.extensionId))) {
    throw fout('invalid-owner', `the extension id ${JSON.stringify(eigenaar.extensionId)} does not match the system type namespace grammar`);
  }
  if (typeof key !== 'string' || !TYPE_KEY_RE.test(key)) {
    throw fout('invalid-key', `invalid key: ${JSON.stringify(key)} (1-64 lowercase letters, digits, dot, underscore or hyphen; starts and ends with a letter or digit)`);
  }
  return eigenaar.kind === 'extension' ? `ext:${eigenaar.extensionId}#${key}` : `mcp:${key}`;
}

function eigenaarTekst(eig) {
  if (eig.kind === 'extension') return `extension ${eig.extensionId}`;
  if (eig.kind === 'mcp') return 'MCP';
  return 'the app (only the user can change it)';
}

function zelfdeEigenaar(eig, aanroeper) {
  if (eig.kind !== aanroeper.kind) return false;
  return eig.kind !== 'extension' || eig.extensionId === aanroeper.extensionId;
}

// ── registreren en bijwerken (§6) ──────────────────────────────────────────

/**
 * Plan een registratie (§6.1). Geeft { status, id, data, type, wijziging }:
 * `data` is nieuwe data bij created/updated, anders dezelfde referentie;
 * `wijziging` is { id, change, revision, previousRevision } of null.
 * Gooit een SysteemTypeFout bij een ongeldige aanroep (data onaangeroerd).
 */
export function planRegistratie(data, eigenaar, key, definitie, opties) {
  const id = typeIdVoor(eigenaar, key);
  const opt = controleerOpties(opties, ['schema', 'restore']);
  if (opt.restore !== undefined && typeof opt.restore !== 'boolean') {
    throw fout('invalid-argument', 'restore must be a boolean');
  }
  const def = valideerDefinitie(definitie, 'registreren');
  const verwijderd = Array.isArray(data.verwijderd) ? data.verwijderd : [];
  const bestaand = findSysteemType(data, id);
  if (!bestaand && verwijderd.some(g => g.id === id)) {
    if (opt.restore !== true) return { status: 'removed-by-user', id, data, type: null, wijziging: null };
  }
  if (!bestaand) {
    // Revisies lopen per id door: na een grafsteen begint het type ná de
    // revisie waarop het verwijderd werd, zodat een snapshot van vóór het
    // verwijderen verouderd blijft (geen ABA). Het is de eigen definitie van
    // de eigenaar: eigenaarRevisie = revisie.
    const revisie = revisieNaGrafsteen(verwijderd, id, 1);
    const type = normalizeSysteemType({ ...def, id, revisie, eigenaarRevisie: revisie });
    return {
      status: 'created',
      id,
      data: { ...data, verwijderd: verwijderd.filter(g => g.id !== id), typen: [...data.typen, type] },
      type,
      wijziging: { id, change: 'added', revision: revisie, previousRevision: null },
    };
  }
  const kandidaat = normalizeSysteemType({ ...def, id });
  if (systeemTypeDefinitieGelijk(kandidaat, bestaand)) {
    return { status: 'unchanged', id, data, type: bestaand, wijziging: null };
  }
  if (isDoorGebruikerBewerkt(bestaand)) {
    return { status: 'kept-user-edit', id, data, type: bestaand, wijziging: null };
  }
  const revisie = bestaand.revisie + 1;
  const type = normalizeSysteemType({ ...def, id, revisie, eigenaarRevisie: revisie });
  return {
    status: 'updated',
    id,
    data: { ...data, typen: data.typen.map(t => (t.id === id ? type : t)) },
    type,
    wijziging: { id, change: 'updated', revision: revisie, previousRevision: bestaand.revisie },
  };
}

/**
 * Plan het bijwerken van een eigen type (§6.3). Geeft { status, id, data,
 * type, wijziging } met status 'updated' of 'unchanged'. Gooit not-found,
 * not-owner, stale-revision (met currentRevision) of een veldfout.
 */
export function planBijwerking(data, eigenaar, id, changes, opties) {
  if (!eigenaar || !['extension', 'mcp'].includes(eigenaar.kind)
      || (eigenaar.kind === 'extension' && !EXTENSIE_ID_RE.test(String(eigenaar.extensionId)))) {
    throw fout('invalid-owner', 'system types can only be changed by their extension or by MCP');
  }
  const opt = controleerOpties(opties, ['expectedRevision', 'schema'], true);
  if (!isPlatObject(changes)) throw fout('invalid-argument', 'changes must be a plain object');
  const huidig = typeof id === 'string' ? findSysteemType(data, id) : null;
  if (!huidig) throw fout('not-found', `unknown system type: ${id}`);
  const eig = eigenaarVanId(id);
  if (!zelfdeEigenaar(eig, eigenaar)) {
    throw fout('not-owner', `system type ${id} is owned by ${eigenaarTekst(eig)}, not by ${eigenaarTekst(eigenaar)}`);
  }
  if (!Number.isInteger(opt.expectedRevision) || opt.expectedRevision < 1) {
    throw fout('invalid-argument', 'expectedRevision must be an integer of at least 1');
  }
  if (opt.expectedRevision !== huidig.revisie) {
    throw fout('stale-revision', `stale revision: expected ${opt.expectedRevision}, the current revision is ${huidig.revisie}`,
      { currentRevision: huidig.revisie });
  }
  // Alleen de GEGEVEN velden worden gecontroleerd en vervangen; de rest komt
  // ongewijzigd uit de opslag — ook een waarde die schema 1 niet doorstaat
  // (een bewerking van de gebruiker, een oude PDF-snapshot) en een niet-lege
  // `lagen`. Niets verdwijnt stil; de snapshot blijft zulke waarden in
  // `problems` melden.
  const wijz = valideerDefinitie(changes, 'bijwerken');
  const samen = kloon(systeemTypeDefinitie(huidig));
  for (const [veld, waarde] of Object.entries(wijz)) {
    if (waarde === null) delete samen[veld];
    else samen[veld] = waarde;
  }
  const kandidaat = normalizeSysteemType({ ...samen, id });
  if (systeemTypeDefinitieGelijk(kandidaat, huidig)) {
    return { status: 'unchanged', id, data, type: huidig, wijziging: null };
  }
  const revisie = huidig.revisie + 1;
  const type = normalizeSysteemType({ ...samen, id, revisie, eigenaarRevisie: revisie });
  return {
    status: 'updated',
    id,
    data: { ...data, typen: data.typen.map(t => (t.id === id ? type : t)) },
    type,
    wijziging: { id, change: 'updated', revision: revisie, previousRevision: huidig.revisie },
  };
}

// ── snapshots (§4.2) ───────────────────────────────────────────────────────

// De gevalideerde schema-1-velden van een opgeslagen type, plus de
// opgeslagen waarden die de controle niet doorstaan.
function snapshotDefinitie(t) {
  const definitie = {};
  const problemen = [];
  for (const veld of VELDEN) {
    if (!(veld in t) || t[veld] === undefined || t[veld] === null) continue;
    try {
      definitie[veld] = CONTROLE[veld](t[veld], veld);
    } catch (e) {
      if (!(e instanceof SysteemTypeFout)) throw e;
      problemen.push({ field: e.field || veld, code: e.code, message: e.message });
    }
  }
  definitie.lagen = [];
  return { definitie, problemen };
}

/**
 * Losgekoppelde, gevalideerde snapshot van een opgeslagen type (§4.2).
 * `isExtensionLoaded(id)` zegt of de eigenaar-extensie nu geladen is.
 */
export function publiekeSnapshot(type, { isExtensionLoaded } = {}) {
  const eig = eigenaarVanId(type.id);
  const owner = eig.kind === 'extension'
    ? { ...eig, loaded: typeof isExtensionLoaded === 'function' && isExtensionLoaded(eig.extensionId) === true }
    : eig;
  const revisie = Number.isInteger(type.revisie) && type.revisie >= 1 ? type.revisie : 1;
  const { definitie, problemen } = snapshotDefinitie(type);
  return JSON.parse(JSON.stringify({
    id: type.id,
    schema: SYSTEEMTYPE_SCHEMA,
    owner,
    revision: revisie,
    ownerRevision: eig.kind === 'app' ? null : (Number.isInteger(type.eigenaarRevisie) ? type.eigenaarRevisie : 0),
    userEdited: eig.kind === 'app' ? null : isDoorGebruikerBewerkt(type),
    definition: definitie,
    unconfirmed: onbevestigdeMaten(type),
    problems: problemen,
  }));
}

// ── de native editor (§9) ──────────────────────────────────────────────────

const kloon = (x) => JSON.parse(JSON.stringify(x));

/**
 * Plan voor Toepassen in de editor (§9.2): alleen het VERSCHIL tussen de
 * werkkopie en de basis (de registrystand bij openen of de vorige
 * Toepassen) wordt over de huidige registry gelegd. Een type dat de
 * gebruiker wijzigde krijgt de versie uit de werkkopie (revisie = huidige
 * revisie + 1, eigenaarRevisie blijft — dus een gebruikersbewerking);
 * onaangeraakte typen houden de huidige registryversie; nieuwe typen komen
 * erbij met revisie 1; verwijderde eigendomstypen krijgen een grafsteen.
 * De omzettingen uit de wachtrij voert de aanroeper uit vóór de commit.
 * @returns {{data, wijzigingen, omzettingen}} — zonder verschil dezelfde data.
 */
export function planEditorToepassen(basis, werk, huidig, wachtrij = []) {
  const bMap = new Map((basis?.typen || []).map(t => [t.id, t]));
  const wMap = new Map((werk?.typen || []).map(t => [t.id, t]));
  const hIds = new Set(huidig.typen.map(t => t.id));
  const omzettingen = (Array.isArray(wachtrij) ? wachtrij : [])
    .filter(o => o && o.vanId && o.naarId)
    .map(o => ({ vanId: o.vanId, naarId: o.naarId }));
  const wijzigingen = [];
  const typen = [];
  let verwijderd = Array.isArray(huidig.verwijderd) ? huidig.verwijderd.slice() : [];

  for (const h of huidig.typen) {
    const b = bMap.get(h.id);
    const w = wMap.get(h.id);
    if (b && !w) {
      // Door de gebruiker verwijderd.
      wijzigingen.push({ id: h.id, change: 'removed', revision: null, previousRevision: h.revisie });
      if (heeftEigenaar(h.id)) {
        verwijderd = verwijderd.filter(g => g.id !== h.id);
        verwijderd.push({ id: h.id, revisie: h.revisie });
      }
      continue;
    }
    if (w && !systeemTypeDefinitieGelijk(w, b || h)) {
      // Door de gebruiker gewijzigd: de werkkopie wint.
      const nieuw = normalizeSysteemType({ ...kloon(w), id: h.id, revisie: h.revisie + 1, eigenaarRevisie: h.eigenaarRevisie });
      typen.push(nieuw);
      wijzigingen.push({ id: h.id, change: 'updated', revision: nieuw.revisie, previousRevision: h.revisie });
      continue;
    }
    typen.push(h);
  }
  for (const w of werk?.typen || []) {
    if (hIds.has(w.id)) continue;
    const b = bMap.get(w.id);
    if (b && systeemTypeDefinitieGelijk(w, b)) continue; // elders verdwenen en niet bewerkt
    // Revisies lopen per id door, ook voorbij een grafsteen (geen ABA).
    const revisie = Math.max(b ? b.revisie + 1 : 1, revisieNaGrafsteen(huidig.verwijderd, w.id, 1));
    const nieuw = normalizeSysteemType({ ...kloon(w), revisie, eigenaarRevisie: undefined });
    typen.push(nieuw);
    verwijderd = verwijderd.filter(g => g.id !== w.id);
    wijzigingen.push({ id: w.id, change: 'added', revision: nieuw.revisie, previousRevision: null });
  }
  if (wijzigingen.length === 0 || typen.length === 0) {
    return { data: huidig, wijzigingen: [], omzettingen };
  }
  return { data: { ...huidig, verwijderd, typen }, wijzigingen, omzettingen };
}

/**
 * Controle van een bewerking in de native editor (§9.3): dezelfde grenzen
 * voor de fysieke maten als het contract — celmaat en strookbreedte 50–20000
 * mm, sparingsdrempels 10–20000 mm en klein ≤ raveel. Een leeg veld
 * (undefined) mag: de maat wordt onbevestigd. Andere velden kiest de
 * gebruiker uit lijsten. @returns {{veld, melding}|null} (melding in het
 * Nederlands, voor de dialoog).
 */
export function controleerEditorInvoer(patch) {
  const buiten = (v, b) => typeof v !== 'number' || !Number.isFinite(v) || v < b.min || v > b.max;
  for (const [veld, label] of [['celXMm', 'Celmaat X'], ['celYMm', 'Celmaat Y'], ['strookBreedteMm', 'Strookbreedte']]) {
    if (!patch || !(veld in patch) || patch[veld] === undefined) continue;
    if (buiten(patch[veld], MAAT)) {
      return { veld, melding: `${label} moet tussen ${MAAT.min} en ${MAAT.max} mm liggen.` };
    }
  }
  const regels = patch?.sparingRegels;
  if (regels && typeof regels === 'object') {
    const labels = { kleineSparingMaxMm: 'Klein t/m', raveelVanafMm: 'Raveel vanaf' };
    for (const veld of Object.keys(labels)) {
      if (regels[veld] === undefined) continue;
      if (buiten(regels[veld], DREMPEL)) {
        return { veld: `sparingRegels.${veld}`, melding: `${labels[veld]} moet tussen ${DREMPEL.min} en ${DREMPEL.max} mm liggen.` };
      }
    }
    if (regels.kleineSparingMaxMm !== undefined && regels.raveelVanafMm !== undefined
        && regels.kleineSparingMaxMm > regels.raveelVanafMm) {
      return { veld: 'sparingRegels', melding: 'De drempel voor een kleine sparing mag niet groter zijn dan die voor een raveel.' };
    }
  }
  return null;
}

/** Aantal systemen dat na het uitvoeren van de omzet-wachtrij naar `id`
 *  verwijst — zodat een omzetdoel als "in gebruik" telt vóór Toepassen. */
export function gebruikNaWachtrij(annotations, wachtrij, id) {
  if (!id) return 0;
  let n = 0;
  for (const a of annotations || []) {
    if (!a || a.type !== 'systeemraster') continue;
    let tid = a.systeemTypeId;
    for (const o of wachtrij || []) if (tid === o.vanId) tid = o.naarId;
    if (tid === id) n++;
  }
  return n;
}

/** Beginselectie van de editor: het gevraagde type, anders het eerste. */
export function beginSelectie(werk, typeId) {
  const typen = werk?.typen || [];
  if (typeId && typen.some(t => t.id === typeId)) return typeId;
  return typen[0]?.id || '';
}

/**
 * Focus op een type in een geopende editor (§9.1). Staat het in de
 * werkkopie: alleen de selectie. Is het na het openen geregistreerd: de
 * huidige registryversie komt (ongewijzigd) in basis én werkkopie. Onbekend,
 * of door de gebruiker in de werkkopie verwijderd: null (niets doen).
 */
export function focusOpType({ basis, werk, huidig, typeId }) {
  if (!typeId) return null;
  if (werk.typen.some(t => t.id === typeId)) return { basis, werk, selectedId: typeId };
  if (basis.typen.some(t => t.id === typeId)) return null;
  const t = findSysteemType(huidig, typeId);
  if (!t) return null;
  return {
    basis: { ...basis, typen: [...basis.typen, kloon(t)] },
    werk: { ...werk, typen: [...werk.typen, kloon(t)] },
    selectedId: typeId,
  };
}

/** Eigenaarlabel achter de naam in de typenlijst. */
export function eigenaarLabel(type, isGeladen) {
  const eig = eigenaarVanId(type?.id);
  if (eig.kind === 'extension') {
    const geladen = typeof isGeladen === 'function' && isGeladen(eig.extensionId);
    return ` (extensie ${eig.extensionId}${geladen ? '' : ', niet geladen'})`;
  }
  return eig.kind === 'mcp' ? ' (MCP)' : '';
}

/** Alleen-lezen regel bij een geselecteerd type met eigenaar, of null. */
export function beheerdDoorTekst(type) {
  const eig = eigenaarVanId(type?.id);
  if (eig.kind === 'app') return null;
  const wie = eig.kind === 'extension' ? `extensie ${eig.extensionId}` : 'MCP';
  return `Beheerd door ${wie}; wijzigingen hier gelden als gebruikersbewerking`;
}
