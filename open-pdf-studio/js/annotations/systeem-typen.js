// Systeemtypen — PURE datamodel- en migratie-module (geen UI-, DOM- of
// app-state-imports; los testbaar onder node --test).
//
// Een SYSTEEMTYPE is een benoemde, HERBRUIKBARE definitie van een
// vlakvullend systeem (systeemplafond, bandraster, platenveld, later
// wanden): celmaat, randprofiel en IFC-mapping. Zelfde ontwerpkeuzes als
// de tekeningtype-regelsets (js/drafting/tekeningtype.js):
//
//  1. TYPE ≠ INSTANCE. De getekende annotatie (instance) verwijst met
//     `systeemTypeId` naar de definitie en draagt zelf alleen
//     instantie-eigen data: contour, rasteroorsprong, rasterhoek en
//     paneel-OVERRIDES. Type bewerken → alle instanties veranderen mee.
//  2. STABIELE ID'S. Referentie op `id`, nooit op naam.
//  3. GEVERSIONEERDE DATA MET MIGRATIEKETEN (version + MIGRATIONS).
//  4. GENERIEK. 'plafond' is geen speciaal geval in de kernlogica: de
//     categorie en IFC-mapping zijn DATA op het type; latere categorieën
//     (wand, vloer) zijn gewoon nieuwe typen.
//
// Persistentie: de bibliotheek leeft in de app-preferences (zelfde
// mechanisme als tekeningtypen, zie systeem-typen-registry.js) én elke
// opgeslagen instantie draagt een JSON-SNAPSHOT van zijn type
// (OPS_SgTypeDef), zodat een PDF op een andere machine zijn typen
// meebrengt (de loader registreert onbekende typen bij).
//
// Versie 2 (#567): de bibliotheek heeft een `revisie` (+1 per commit) en
// grafstenen (`verwijderd`) voor eigendomstypen die de gebruiker verwijderde;
// elk type heeft een `revisie` (+1 per inhoudelijke wijziging) en, bij typen
// met een eigenaar (id `ext:…` of `mcp:…`), een `eigenaarRevisie`. FYSIEKE
// MATEN (celmaat, strookbreedte, sparingsregels) krijgen bij het normaliseren
// geen standaardwaarde meer: ontbreekt er een, dan is hij ONBEVESTIGD. Het
// publieke contract staat in systeem-typen-contract.js en in
// docs/plugin-systeemtypen.md.

/** Huidige versie van de opgeslagen systeemtype-data. */
export const SYSTEEMTYPE_VERSION = 2;

/** Randprofielen die een type kan voorschrijven (spiegel van
 *  SYSTEEM_EDGE_PROFIELEN in systeemraster.js — hier herhaald zodat deze
 *  module zelfstandig blijft). */
const EDGE_PROFIELEN = ['geen', 'hoeklijn', 'schaduwvoeg'];

/** Nieuw stabiel systeemtype-id. */
export function newSysteemTypeId() {
  return 'st-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── eigendom in het id ─────────────────────────────────────────────────────

/** Grammatica van een extensie-id (het manifest.id van de plugin). */
export const EXTENSIE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
/** Grammatica van de key die een eigenaar zelf kiest (kleine letters, zodat
 *  er geen hoofdlettergevoelige dubbelingen ontstaan). */
export const TYPE_KEY_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/**
 * Eigenaar van een type, afgeleid uit het id zelf: `ext:<extensionId>#<key>`
 * is van die extensie, `mcp:<key>` van MCP, al het andere (ook een kapot
 * `ext:`-id) van de app — dat kan alleen de gebruiker wijzigen.
 */
export function eigenaarVanId(id) {
  if (typeof id !== 'string') return { kind: 'app' };
  let m = /^ext:([^#]+)#(.+)$/.exec(id);
  if (m && EXTENSIE_ID_RE.test(m[1]) && TYPE_KEY_RE.test(m[2])) {
    return { kind: 'extension', extensionId: m[1], key: m[2] };
  }
  m = /^mcp:(.+)$/.exec(id);
  if (m && TYPE_KEY_RE.test(m[1])) return { kind: 'mcp', key: m[1] };
  return { kind: 'app' };
}

/** Heeft dit id een eigenaar buiten de app (extensie of MCP)? */
export function heeftEigenaar(id) {
  return eigenaarVanId(id).kind !== 'app';
}

/** Door de gebruiker bewerkt: een type met eigenaar waarvan de revisie
 *  verder is dan wat de eigenaar zelf schreef (ontbrekend telt als 0). Er is
 *  bewust geen los vlagveld dat van de revisies kan afwijken. */
export function isDoorGebruikerBewerkt(t) {
  if (!t || !heeftEigenaar(t.id)) return false;
  const rev = Number.isInteger(t.revisie) && t.revisie >= 1 ? t.revisie : 1;
  const eig = Number.isInteger(t.eigenaarRevisie) ? t.eigenaarRevisie : 0;
  return rev > eig;
}

// ── fysieke maten ──────────────────────────────────────────────────────────

/** Vereiste maten per layout: raster = celmaat in twee richtingen; strook =
 *  strookbreedte plus celmaat Y (die de strook-layout nog gebruikt voor de
 *  randindeling en de index). */
export function vereisteMaten(layout) {
  return layout === 'strook' ? ['strookBreedteMm', 'celYMm'] : ['celXMm', 'celYMm'];
}

const geldigeMaat = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Ontbrekende (onbevestigde) fysieke maten van een type: eerst de vereiste
 *  maten van de layout, dan de twee drempels van de sparingsregels. Een
 *  aanwezige maar ongeldige waarde is geen onbevestigde maat (dat is een
 *  probleem, zie publiekeSnapshot in systeem-typen-contract.js). */
export function onbevestigdeMaten(t) {
  if (!t) return [];
  const uit = vereisteMaten(t.layout).filter(veld => !(veld in t) || t[veld] === undefined);
  const regels = t.sparingRegels && typeof t.sparingRegels === 'object' ? t.sparingRegels : {};
  for (const veld of ['kleineSparingMaxMm', 'raveelVanafMm']) {
    if (!(veld in regels) || regels[veld] === undefined) uit.push(`sparingRegels.${veld}`);
  }
  return uit;
}

/** Ingebouwde render-stijlen voor paneeltypes (spiegel van
 *  SYSTEEM_PANEEL_TYPES in systeemraster.js). */
const RENDER_STIJLEN = ['tegel', 'ventilatie', 'licht'];

/** Standaard-assortiment paneeltypes van een systeemtype. Het assortiment
 *  is DATA op het type: elk paneeltype = { id, naam, renderStijl }, zodat
 *  typen hun eigen paneel-aanbod hebben (bewerkbaar in de typebeheer-
 *  dialoog) en paneel-overrides op id verwijzen. */
export function createDefaultPaneelTypen() {
  return [
    { id: 'tegel', naam: 'Plafondtegel', renderStijl: 'tegel' },
    { id: 'ventilatie', naam: 'Ventilatiepaneel', renderStijl: 'ventilatie' },
    { id: 'licht', naam: 'Lichtpaneel', renderStijl: 'licht' },
  ];
}

/** Nieuw stabiel paneeltype-id. */
export function newPaneelTypeId() {
  return 'pt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Genormaliseerd assortiment: geldige entries, 'tegel' altijd aanwezig
// (dat is de default/reset-waarde van elke cel).
function _normalizePaneelTypen(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) continue;
    if (out.some(q => q.id === p.id)) continue;
    out.push({
      id: p.id,
      naam: String(p.naam || p.id),
      renderStijl: RENDER_STIJLEN.includes(p.renderStijl) ? p.renderStijl : 'tegel',
    });
  }
  if (out.length === 0) return createDefaultPaneelTypen();
  if (!out.some(p => p.id === 'tegel')) {
    out.unshift({ id: 'tegel', naam: 'Plafondtegel', renderStijl: 'tegel' });
  }
  return out;
}

/**
 * Genormaliseerd type-object (puur): rommel eruit, weergavekeuzes ingevuld,
 * maar GEEN fysieke maat verzonnen. Een ontbrekende of ongeldige celmaat,
 * strookbreedte of sparingsdrempel blijft weg en is daarmee onbevestigd
 * (zie onbevestigdeMaten). Tolerant voor bestaande opslag en PDF-snapshots;
 * het strenge contract voor extensies en MCP staat in
 * systeem-typen-contract.js.
 */
export function normalizeSysteemType(t) {
  if (!t || typeof t !== 'object' || !t.id) return null;
  const maat = (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const id = String(t.id);
  const uit = {
    id,
    naam: String(t.naam || t.id),
    // Categorie is DATA (plafond/vloer/wand/…): kernlogica switcht er niet op.
    categorie: String(t.categorie || 'plafond'),
    ifcCategory: String(t.ifcCategory || 'IfcCovering'),
  };
  if (t.ifcPredefinedType) uit.ifcPredefinedType = String(t.ifcPredefinedType);
  // LAYOUT-VORM: 'raster' (cellen in twee richtingen) of 'strook'
  // (stroken van strookBreedteMm die in ÉÉN richting — de rasterhoek —
  // over de volledige overspanning lopen; kanaalplaatvloer).
  uit.layout = t.layout === 'strook' ? 'strook' : 'raster';
  for (const veld of ['celXMm', 'celYMm', 'strookBreedteMm']) {
    const v = maat(t[veld]);
    if (v !== undefined) uit[veld] = v;
  }
  uit.edgeProfiel = EDGE_PROFIELEN.includes(t.edgeProfiel) ? t.edgeProfiel : 'geen';
  // SPARINGSREGELS (data op het type): t/m kleineSparingMaxMm = gewoon
  // gat; vanaf raveelVanafMm = raveelijzer (strook-layout); ertussen =
  // gat met verzwaarde randlijn. Alleen de gegeven drempels blijven staan.
  if (t.sparingRegels && typeof t.sparingRegels === 'object') {
    const regels = {};
    for (const veld of ['kleineSparingMaxMm', 'raveelVanafMm']) {
      const v = maat(t.sparingRegels[veld]);
      if (v !== undefined) regels[veld] = v;
    }
    if (Object.keys(regels).length > 0) uit.sparingRegels = regels;
  }
  // Paneel-assortiment van dit type (paneeltype-id's waar overrides naar
  // verwijzen); 'tegel' is altijd aanwezig.
  uit.paneelTypen = _normalizePaneelTypen(t.paneelTypen);
  // Gereserveerd voor gelaagde systemen. Schema 1 kent één impliciete laag;
  // een niet-lege lijst uit opslag of een PDF blijft ongemoeid bewaard.
  uit.lagen = Array.isArray(t.lagen) ? t.lagen : [];
  // Metadata: revisie (≥ 1) en, alleen bij een eigenaar, de revisie waarop
  // die eigenaar de definitie het laatst schreef (≤ revisie).
  uit.revisie = Number.isInteger(t.revisie) && t.revisie >= 1 ? t.revisie : 1;
  if (heeftEigenaar(id) && Number.isInteger(t.eigenaarRevisie)
      && t.eigenaarRevisie >= 1 && t.eigenaarRevisie <= uit.revisie) {
    uit.eigenaarRevisie = t.eigenaarRevisie;
  }
  return uit;
}

/** De definitie van een type zonder metadata (revisie, eigenaarRevisie):
 *  wat inhoudelijk vergeleken wordt. Puur; geeft een nieuw object. */
export function systeemTypeDefinitie(t) {
  const norm = normalizeSysteemType(t);
  if (!norm) return null;
  delete norm.revisie;
  delete norm.eigenaarRevisie;
  return norm;
}

// JSON met gesorteerde sleutels: volgorde-onafhankelijk vergelijken.
function _canoniek(v) {
  if (Array.isArray(v)) return `[${v.map(_canoniek).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${_canoniek(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Zijn twee typen inhoudelijk gelijk (genormaliseerd, zonder metadata)? */
export function systeemTypeDefinitieGelijk(a, b) {
  const da = systeemTypeDefinitie(a), db = systeemTypeDefinitie(b);
  if (!da || !db) return da === db;
  return _canoniek(da) === _canoniek(db);
}

/** Meegeleverde standaardtypen. Alle fysieke maten staan er expliciet in
 *  (strookbreedte en sparingsregels waren in versie 1 impliciet). */
export function createDefaultSysteemTypen() {
  const regels = () => ({ kleineSparingMaxMm: 400, raveelVanafMm: 800 });
  return {
    version: SYSTEEMTYPE_VERSION,
    revisie: 0,
    verwijderd: [],
    typen: [
      normalizeSysteemType({
        id: 'st-plafond-600x600', naam: 'Systeemplafond 600x600',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 600, celYMm: 600, edgeProfiel: 'geen',
        strookBreedteMm: 1200, sparingRegels: regels(),
      }),
      normalizeSysteemType({
        id: 'st-plafond-600x1200', naam: 'Systeemplafond 600x1200',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 600, celYMm: 1200, edgeProfiel: 'geen',
        strookBreedteMm: 1200, sparingRegels: regels(),
      }),
      normalizeSysteemType({
        id: 'st-bandraster-300x1200', naam: 'Bandraster 300x1200',
        categorie: 'plafond', ifcCategory: 'IfcCovering', ifcPredefinedType: 'CEILING',
        celXMm: 300, celYMm: 1200, edgeProfiel: 'geen',
        strookBreedteMm: 1200, sparingRegels: regels(),
      }),
      normalizeSysteemType({
        id: 'st-stelcon-2000x2000', naam: 'Stelconplaten 2000x2000',
        categorie: 'vloer', ifcCategory: 'IfcCovering', ifcPredefinedType: 'FLOORING',
        celXMm: 2000, celYMm: 2000, edgeProfiel: 'geen',
        strookBreedteMm: 1200, sparingRegels: regels(),
      }),
      // Kanaalplaatvloer: STROOK-layout — stroken van 1200 mm die in één
      // richting (de rasterhoek) over de volledige overspanning lopen;
      // sparingsregels volgens de gangbare praktijk (t/m 400 mm gewoon
      // gat, vanaf 800 mm raveelijzer).
      normalizeSysteemType({
        id: 'st-kanaalplaat-1200', naam: 'Kanaalplaatvloer 1200',
        categorie: 'vloer', ifcCategory: 'IfcSlab', ifcPredefinedType: 'FLOOR',
        layout: 'strook', strookBreedteMm: 1200,
        celXMm: 1200, celYMm: 1200, edgeProfiel: 'geen',
        sparingRegels: regels(),
      }),
    ],
  };
}

// MIGRATIONS[n] migreert data van versie n naar n+1 (zelfde skelet als
// tekeningtype.js — latere versies breken oude opgeslagen typen nooit).
const MIGRATIONS = {
  // 1 → 2: bibliotheekrevisie, grafstenen en een revisie per type. Opgeslagen
  // v1-data ging altijd door de oude normalisatie en heeft dus alle maten.
  1: (data) => ({
    ...data,
    version: 2,
    revisie: 0,
    verwijderd: [],
    typen: data.typen.map(t => (t && typeof t === 'object' ? { ...t, revisie: 1 } : t)),
  }),
};

// Grafstenen: [{ id, revisie }] van eigendomstypen die de gebruiker
// verwijderde (registreren maakt ze dan niet stil opnieuw aan).
function _normalizeVerwijderd(lijst) {
  const uit = [];
  for (const g of Array.isArray(lijst) ? lijst : []) {
    if (!g || typeof g.id !== 'string' || !g.id || uit.some(x => x.id === g.id)) continue;
    uit.push({ id: g.id, revisie: Number.isInteger(g.revisie) && g.revisie >= 1 ? g.revisie : 1 });
  }
  return uit;
}

/**
 * Normaliseer/migreer opgeslagen systeemtype-data. Ontbrekend/onbruikbaar →
 * verse defaults; nieuwer dan deze build kent → ongemoeid terug. Het
 * resultaat is altijd genormaliseerd (nooit ruwe invoer met onbekende
 * velden); bij dubbele id's blijft het eerste exemplaar. Is de invoer al
 * precies de genormaliseerde vorm, dan komt dezelfde referentie terug, zodat
 * aanroepers "niets veranderd" aan de referentie kunnen zien. Puur.
 */
export function migrateSysteemTypen(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.typen)) {
    return createDefaultSysteemTypen();
  }
  let d = data;
  let v = Number(d.version) || 1;
  if (v > SYSTEEMTYPE_VERSION) return d;
  while (v < SYSTEEMTYPE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    d = step(d);
    v = Number(d.version) || v + 1;
  }
  const typen = [];
  for (const t of d.typen) {
    const norm = normalizeSysteemType(t);
    if (norm && !typen.some(x => x.id === norm.id)) typen.push(norm);
  }
  if (typen.length === 0) return createDefaultSysteemTypen();
  const uit = {
    version: SYSTEEMTYPE_VERSION,
    revisie: Number.isInteger(d.revisie) && d.revisie >= 0 ? d.revisie : 0,
    verwijderd: _normalizeVerwijderd(d.verwijderd),
    typen,
  };
  return _canoniek(uit) === _canoniek(data) ? data : uit;
}

/**
 * De revisie waarmee een type terugkomt: revisies lopen per id door, ook als
 * het type verwijderd werd. Staat er een grafsteen voor `id`, dan is het
 * resultaat minstens grafsteen.revisie + 1, anders `minimum`. Zo blijft een
 * snapshot van vóór het verwijderen verouderd (geen ABA). Puur.
 */
export function revisieNaGrafsteen(verwijderd, id, minimum = 1) {
  const g = Array.isArray(verwijderd) ? verwijderd.find(x => x && x.id === id) : null;
  const na = g && Number.isInteger(g.revisie) ? g.revisie + 1 : 1;
  return Math.max(minimum, na);
}

/** Type op id uit een datastructuur, of null. */
export function findSysteemType(data, id) {
  if (!id || !data || !Array.isArray(data.typen)) return null;
  return data.typen.find(t => t && t.id === id) || null;
}

/**
 * Voeg een type(-snapshot) toe of vervang niets als het id al bestaat
 * (bestaande lokale definitie wint — de gebruiker kan hem bewust bewerkt
 * hebben). Puur: geeft nieuwe data terug (of dezelfde referentie als er
 * niets te doen is). Gebruikt door de loader voor PDF-meegereisde typen.
 * Een grafsteen voor dat id vervalt: het document heeft het type nodig. Het
 * type komt dan ná de revisie van de grafsteen terug (revisies lopen per id
 * door); de afstand tussen revisie en eigenaarRevisie uit de snapshot blijft
 * gelijk, zodat "door de gebruiker bewerkt" niet verandert.
 */
export function mergeSysteemType(data, def) {
  const d = migrateSysteemTypen(data);
  const norm = normalizeSysteemType(def);
  if (!norm) return d;
  if (findSysteemType(d, norm.id)) return d;
  const revisie = revisieNaGrafsteen(d.verwijderd, norm.id, norm.revisie);
  if (revisie !== norm.revisie) {
    if (norm.eigenaarRevisie !== undefined) norm.eigenaarRevisie += revisie - norm.revisie;
    norm.revisie = revisie;
  }
  return {
    ...d,
    verwijderd: (d.verwijderd || []).filter(g => g.id !== norm.id),
    typen: [...d.typen, norm],
  };
}

/**
 * Werk een bestaand type bij (puur): geeft nieuwe data terug. Onbekend id of
 * geen inhoudelijke wijziging → dezelfde data. `patch` wordt genormaliseerd
 * over het bestaande type; metadata in de patch telt niet. Een wijziging
 * verhoogt de revisie, niet de eigenaarRevisie: bij een type met eigenaar is
 * het daarna een gebruikersbewerking.
 */
export function updateSysteemTypeIn(data, id, patch) {
  const d = migrateSysteemTypen(data);
  const idx = d.typen.findIndex(t => t && t.id === id);
  if (idx < 0) return d;
  const huidig = d.typen[idx];
  const next = normalizeSysteemType({
    ...huidig, ...patch, id,
    revisie: huidig.revisie, eigenaarRevisie: huidig.eigenaarRevisie,
  });
  if (systeemTypeDefinitieGelijk(next, huidig)) return d;
  next.revisie = huidig.revisie + 1;
  const typen = d.typen.slice();
  typen[idx] = next;
  return { ...d, typen };
}

/** Diepe kopie van een type onder een nieuw stabiel id/naam (puur) —
 *  zelfde patroon als duplicateRegelset in drafting/tekeningtype.js. De
 *  kopie is van de gebruiker: een `st-`-id, revisie 1, geen eigenaar. Zonder
 *  bron is er niets bevestigd (geen maten). */
export function duplicateSysteemType(t, naam) {
  const copy = normalizeSysteemType(t) || normalizeSysteemType({ id: 'st-x' });
  copy.id = newSysteemTypeId();
  copy.naam = String(naam || `${t?.naam || 'Systeemtype'} (kopie)`);
  copy.revisie = 1;
  delete copy.eigenaarRevisie;
  return copy;
}

/** Verwijder een type (puur). Het laatste type kan niet weg (er moet altijd
 *  iets te kiezen blijven) — dan komt dezelfde data terug. */
export function removeSysteemTypeFrom(data, id) {
  const d = migrateSysteemTypen(data);
  if (!findSysteemType(d, id) || d.typen.length <= 1) return d;
  return { ...d, typen: d.typen.filter(t => t.id !== id) };
}

/** Aantal instanties (systeemraster-annotaties) dat naar een type verwijst.
 *  Puur: werkt op een platte annotatielijst (aanroeper levert alle docs). */
export function typeUsageCount(annotations, id) {
  if (!id) return 0;
  let n = 0;
  for (const a of annotations || []) {
    if (a && a.type === 'systeemraster' && a.systeemTypeId === id) n++;
  }
  return n;
}

/** Zet alle instanties met type `fromId` om naar type `toDef` (muteert de
 *  annotaties: verwijzing + IFC-mapping volgen het nieuwe type; contour,
 *  oorsprong, hoek en paneel-overrides blijven staan). @returns aantal. */
export function reassignSysteemType(annotations, fromId, toDef) {
  const doel = normalizeSysteemType(toDef);
  if (!fromId || !doel) return 0;
  let n = 0;
  for (const a of annotations || []) {
    if (a && a.type === 'systeemraster' && a.systeemTypeId === fromId) {
      a.systeemTypeId = doel.id;
      a.ifcCategory = doel.ifcCategory;
      a.ifcPredefinedType = doel.ifcPredefinedType;
      a.modifiedAt = new Date().toISOString();
      n++;
    }
  }
  return n;
}

/**
 * Het type dat de native systeemplafond-tool tekent: het via de tool-selectie
 * gekozen type (api.selectSystemTypeForTool), anders het standaardplafond,
 * anders het eerste type van de bibliotheek. Puur.
 */
export function kiesToolType(data, toolTypeId) {
  const typen = (data && Array.isArray(data.typen)) ? data.typen : [];
  return (toolTypeId && typen.find(t => t && t.id === toolTypeId))
    || typen.find(t => t && t.id === 'st-plafond-600x600')
    || typen[0] || null;
}

/**
 * Instance-velden die een nieuw getekend systeem van zijn type overneemt:
 * de verwijzing, de IFC-mapping en de plaatmaat (bij de strook-layout is de
 * plaatbreedte de strookbreedte). Een onbevestigde maat blijft weg: er komt
 * geen standaardmaat op de instance. Puur.
 */
export function typeInstanceVelden(st) {
  if (!st) return {};
  const uit = { systeemTypeId: st.id, ifcCategory: st.ifcCategory };
  if (st.ifcPredefinedType) uit.ifcPredefinedType = st.ifcPredefinedType;
  const breedte = st.layout === 'strook' ? st.strookBreedteMm : st.celXMm;
  if (geldigeMaat(breedte)) uit.plaatBreedteMm = breedte;
  if (geldigeMaat(st.celYMm)) uit.plaatHoogteMm = st.celYMm;
  return uit;
}

/**
 * Het IFC-predefined type van een geladen systeem-instance (loader). Met een
 * gevonden type is het TYPE leidend: zijn predefined type, anders de kopie die
 * de instance zelf bewaarde (OPS_IfcPredefined) — nooit een verzonnen
 * 'CEILING', ook al draagt elke getypeerde instance `system.type: 'plafond'`
 * (dat is het datamodel, geen categorie). Alleen een instance zonder type
 * (legacy) krijgt bij het plafondmodel nog 'CEILING'. Puur.
 */
export function ifcPredefinedNaLaden({ typeDef, bewaard, sysType }) {
  if (typeDef) return typeDef.ifcPredefinedType || bewaard || undefined;
  return bewaard || (sysType === 'plafond' ? 'CEILING' : undefined);
}

/** Type → JSON-snapshot (voor OPS_SgTypeDef) en terug. De snapshot draagt
 *  de metadata (revisie, eigenaarRevisie) mee; een oude snapshot zonder
 *  metadata laadt met revisie 1. */
export function systeemTypeToJson(t) {
  const norm = normalizeSysteemType(t);
  return norm ? JSON.stringify(norm) : null;
}
export function systeemTypeFromJson(json) {
  if (typeof json !== 'string' || !json) return null;
  try { return normalizeSysteemType(JSON.parse(json)); } catch (_) { return null; }
}
