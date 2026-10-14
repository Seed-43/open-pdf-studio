// Systeemtype-registry — dunne, state-gebonden brug rond de pure
// systeem-typen-module. Zelfde patroon (en zelfde persistentie-mechanisme:
// app-preferences) als de tekeningtype-registry in annotations/drafting-rules.js.
//
// Sinds #567 loopt ELKE bevestigde wijziging door commitSysteemTypen —
// extensie (plugin-API), MCP, de native editor, het eigenschappenpaneel en een
// PDF die een nieuw type meebrengt. De commit verhoogt de bibliotheekrevisie,
// vraagt opslaan en hertekenen aan en stuurt daarna precies één melding
// (onSysteemTypenGewijzigd). Lezen, migreren, afwijzen en uitkomsten zonder
// wijziging melden niets. Contract: docs/plugin-systeemtypen.md.
//
// Importdiscipline: alleen core/state (licht) en pure modules; preferences en
// rendering lazy — deze module wordt door rendering/saver/stores gebruikt en
// mag geen cyclus vormen.
import { state, getActiveDocument } from '../core/state.js';
import {
  migrateSysteemTypen, findSysteemType, mergeSysteemType, updateSysteemTypeIn,
} from './systeem-typen.js';
import { planRegistratie, planBijwerking, planEditorToepassen, publiekeSnapshot } from './systeem-typen-contract.js';

// De laatst gecontroleerde bibliotheek (zoals de store hem teruggeeft): zolang
// de preferences diezelfde referentie hebben, hoeft er niet opnieuw
// gemigreerd te worden. Wordt de bibliotheek vervangen (preferences geladen),
// dan wijkt de referentie af en volgt een nieuwe controle.
let _gecontroleerd = null;

/** Actuele (gemigreerde) systeemtype-data; seedt de defaults bij eerste
 *  gebruik en schrijft migraties terug in de preferences — zonder opslaan
 *  en zonder melding (lezen is geen wijziging). */
export function getSysteemTypenData() {
  const cur = state.preferences?.systeemTypen;
  if (cur && cur === _gecontroleerd) return cur;
  const next = migrateSysteemTypen(cur);
  if (!state.preferences) return next;
  if (next !== cur) state.preferences.systeemTypen = next;
  _gecontroleerd = state.preferences.systeemTypen;
  return _gecontroleerd;
}

/** Systeemtype op id, of null. */
export function getSysteemTypeById(id) {
  return findSysteemType(getSysteemTypenData(), id);
}

// ── geladen extensies (owner.loaded in de snapshots) ───────────────────────
// Een extensie telt als geladen zolang er een plugin-API voor haar id actief
// is: van het aanmaken (vóór activate) tot _cleanup. De plugin-API meldt dat
// via meldExtensieActief; zo hoeft deze module de plugin-manager niet te
// importeren.
const _actieveExtensies = new Map();

/** Markeer een extensie als geladen; geeft de functie die dat weer opheft
 *  (twee keer aanroepen telt één keer). */
export function meldExtensieActief(extensionId) {
  _actieveExtensies.set(extensionId, (_actieveExtensies.get(extensionId) || 0) + 1);
  let los = false;
  return () => {
    if (los) return;
    los = true;
    const n = (_actieveExtensies.get(extensionId) || 1) - 1;
    if (n > 0) _actieveExtensies.set(extensionId, n);
    else _actieveExtensies.delete(extensionId);
  };
}

/** Is er voor dit extensie-id een actieve plugin-API? */
export function isExtensieGeladen(extensionId) {
  return _actieveExtensies.has(extensionId);
}

// ── snapshots ──────────────────────────────────────────────────────────────

const _snapshot = (t) => publiekeSnapshot(t, { isExtensionLoaded: isExtensieGeladen });

/** Losgekoppelde, gevalideerde snapshot van één type, of null. */
export function systeemTypeSnapshot(id) {
  const t = typeof id === 'string' ? getSysteemTypeById(id) : null;
  return t ? _snapshot(t) : null;
}

/** Snapshots van alle typen, in de volgorde van de bibliotheek. */
export function alleSysteemTypeSnapshots() {
  return getSysteemTypenData().typen.map(_snapshot);
}

// ── commit en meldingen ────────────────────────────────────────────────────

const _luisteraars = new Set();

/** Luister naar bevestigde wijzigingen; geeft de afmeldfunctie terug. */
export function onSysteemTypenGewijzigd(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  _luisteraars.add(listener);
  return () => { _luisteraars.delete(listener); };
}

function _vraagOpslaan() {
  import('../core/preferences.js')
    .then(m => m.savePreferences && m.savePreferences())
    .catch(e => console.warn('[systeemtypen] opslaan van de preferences mislukt', e));
}

function _vraagHertekenen() {
  import('./rendering.js')
    .then((m) => {
      const doc = getActiveDocument();
      if (doc?.viewMode === 'continuous') m.redrawContinuous();
      else m.redrawAnnotations();
      // Het eigenschappenpaneel toont typewaarden van een systeem. Alleen die
      // velden worden ververst, en alleen als het paneel één systeem toont:
      // geen nieuwe selectie, geen selectiemelding en geen inbreuk op een
      // meervoudige selectie (zie storeVerversSysteemType).
      import('../solid/stores/propertiesStore.js')
        .then(p => p.storeVerversSysteemType && p.storeVerversSysteemType())
        .catch(e => console.warn('[systeemtypen] paneel verversen mislukt', e));
    })
    .catch(e => console.warn('[systeemtypen] hertekenen mislukt', e));
}

// Meldingen gaan in volgorde van de commits. Commit een listener zelf (een
// extensie die op een wijziging reageert), dan wacht de melding daarvan tot
// de lopende melding bij álle listeners is afgeleverd; anders zou een latere
// listener revisie n+1 vóór revisie n zien.
const _wachtrij = [];
let _bezigMetMelden = false;

function _meld(melding) {
  _wachtrij.push(melding);
  if (_bezigMetMelden) return;
  _bezigMetMelden = true;
  try {
    while (_wachtrij.length) {
      const volgende = _wachtrij.shift();
      for (const listener of [..._luisteraars]) {
        try {
          listener(JSON.parse(JSON.stringify(volgende)));
        } catch (e) {
          console.warn('[systeemtypen] listener mislukt', e);
        }
      }
    }
  } finally {
    _bezigMetMelden = false;
  }
}

/**
 * De ene commit (§7): bibliotheekrevisie +1 en de nieuwe stand in de
 * preferences, opslaan en hertekenen aanvragen, daarna synchroon één
 * melding met alle `wijzigingen` ({ id, change, revision, previousRevision }).
 * De melding beschrijft de stand van deze commit; commit een listener zelf,
 * dan volgt die melding na deze (in volgorde, zie _meld).
 * `bron`: 'extension' | 'mcp' | 'editor' | 'properties-panel' | 'document'.
 */
export function commitSysteemTypen(next, wijzigingen = [], bron = 'editor', { sourceExtensionId } = {}) {
  const vorige = getSysteemTypenData();
  const bibliotheek = { ...next, revisie: (Number(vorige?.revisie) || 0) + 1 };
  if (state.preferences) {
    state.preferences.systeemTypen = bibliotheek;
    _gecontroleerd = state.preferences.systeemTypen;
  }
  _vraagOpslaan();
  _vraagHertekenen();
  if (!wijzigingen.length || _luisteraars.size === 0) return;
  const data = getSysteemTypenData();
  const melding = {
    libraryRevision: data.revisie,
    source: bron,
    ...(bron === 'extension' && sourceExtensionId ? { sourceExtensionId } : {}),
    changes: wijzigingen.map((w) => {
      const t = w.change === 'removed' ? null : findSysteemType(data, w.id);
      return {
        id: w.id,
        change: w.change,
        revision: w.change === 'removed' ? null : w.revision,
        previousRevision: w.change === 'added' ? null : w.previousRevision,
        type: t ? _snapshot(t) : null,
      };
    }),
  };
  _meld(melding);
}

/** Compatibiliteit: schrijf een complete bibliotheek weg als bewerking in de
 *  editor (alleen het verschil telt). Niemand roept dit nog rechtstreeks aan;
 *  gebruik commitSysteemTypen. */
export function saveSysteemTypen(next) {
  if (!next) return;
  const huidig = getSysteemTypenData();
  const plan = planEditorToepassen(huidig, migrateSysteemTypen(next), huidig, []);
  if (plan.wijzigingen.length) commitSysteemTypen(plan.data, plan.wijzigingen, 'editor');
}

// ── wijzigingen per bron ───────────────────────────────────────────────────

/** Registreer een uit een PDF meegereisd type-snapshot. Een bestaand id wint,
 *  stil en zonder melding; een nieuw id gaat door de commit (bron document).
 *  Een grafsteen voor dat id vervalt: het document heeft het type nodig. */
export function ensureSysteemType(def) {
  const cur = getSysteemTypenData();
  const next = mergeSysteemType(cur, def);
  if (next === cur) return;
  const nieuw = next.typen.find(t => !findSysteemType(cur, t.id));
  commitSysteemTypen(next, nieuw
    ? [{ id: nieuw.id, change: 'added', revision: nieuw.revisie, previousRevision: null }]
    : [], 'document');
}

/** Werk een type bij vanuit het eigenschappenpaneel; alle instanties die
 *  ernaar verwijzen tekenen na de redraw met de nieuwe definitie. Bij een
 *  type met eigenaar geldt dit als gebruikersbewerking. */
export function updateSysteemType(id, patch) {
  const cur = getSysteemTypenData();
  const next = updateSysteemTypeIn(cur, id, patch);
  if (next === cur) return;
  const voor = findSysteemType(cur, id);
  const na = findSysteemType(next, id);
  commitSysteemTypen(next, [{ id, change: 'updated', revision: na.revisie, previousRevision: voor.revisie }],
    'properties-panel');
}

function _bronVan(eigenaar) {
  return eigenaar?.kind === 'extension'
    ? { bron: 'extension', extra: { sourceExtensionId: eigenaar.extensionId } }
    : { bron: 'mcp', extra: {} };
}

/** Registreer een type van een extensie of MCP (§6.1). Gooit bij een
 *  ongeldige aanroep (niets veranderd); geeft { status, type: snapshot|null }. */
export function registreerSysteemType(eigenaar, key, definitie, opties) {
  const plan = planRegistratie(getSysteemTypenData(), eigenaar, key, definitie, opties);
  if (plan.wijziging) {
    const { bron, extra } = _bronVan(eigenaar);
    commitSysteemTypen(plan.data, [plan.wijziging], bron, extra);
  }
  return { status: plan.status, type: plan.type ? systeemTypeSnapshot(plan.id) : null };
}

/** Werk een eigen type bij met een revisiecontrole (§6.3). Gooit bij een
 *  afwijzing; geeft { status, type: snapshot }. */
export function werkEigenSysteemTypeBij(eigenaar, id, changes, opties) {
  const plan = planBijwerking(getSysteemTypenData(), eigenaar, id, changes, opties);
  if (plan.wijziging) {
    const { bron, extra } = _bronVan(eigenaar);
    commitSysteemTypen(plan.data, [plan.wijziging], bron, extra);
  }
  return { status: plan.status, type: systeemTypeSnapshot(plan.id) };
}

// ── tool-selectie (runtime, niet bewaard) ──────────────────────────────────
// De selectie geldt alleen voor de TOOL-SESSIE die api.selectSystemTypeForTool
// start. zetToolSysteemType zet naast de selectie een eenmalige claim; de
// eerstvolgende activering van de systeemplafond-tool (de setTool van
// selectSystemTypeForTool zelf) neemt die claim. Elke andere activering
// (het lint, de bibliotheek, app_set_tool) en elke deactivering zet de tool
// terug op het standaardtype. De tool meldt beide via toolSysteemGeactiveerd
// en toolSysteemGedeactiveerd (systeemraster-tool.js, levenscyclus van
// tools/manager.js).

let _toolSysteemTypeId = null;
let _toolClaim = null;

/** Kies het type voor de eerstvolgende activering van de native
 *  systeemplafond-tool (null = standaard, en wist een openstaande claim). */
export function zetToolSysteemType(id) {
  _toolSysteemTypeId = typeof id === 'string' && id ? id : null;
  _toolClaim = _toolSysteemTypeId;
}

/** Het via de tool-selectie gekozen type-id, of null. */
export function getToolSysteemTypeId() {
  return _toolSysteemTypeId;
}

/** De systeemplafond-tool wordt geactiveerd: een openstaande claim blijft
 *  gelden (de sessie van selectSystemTypeForTool), anders de standaard. */
export function toolSysteemGeactiveerd() {
  if (_toolClaim !== null) {
    _toolClaim = null;
    return;
  }
  _toolSysteemTypeId = null;
}

/** De systeemplafond-tool wordt verlaten: de selectie vervalt. */
export function toolSysteemGedeactiveerd() {
  _toolClaim = null;
  _toolSysteemTypeId = null;
}

/**
 * Kies `id` voor de tool-sessie die `activeer()` start (de tool-wissel).
 * Activeert de tool niet (bijvoorbeeld een alleen-lezen PDF/A), dan blijft er
 * geen selectie of claim hangen. @returns {boolean} of de selectie actief is.
 */
export function kiesToolSysteemType(id, activeer) {
  zetToolSysteemType(id);
  try {
    activeer();
  } finally {
    if (_toolClaim !== null) zetToolSysteemType(null);
  }
  return _toolSysteemTypeId !== null && _toolSysteemTypeId === id;
}

/** Wis de selectie als die van deze extensie is (bij haar _cleanup). */
export function wisToolSysteemTypeVanExtensie(extensionId) {
  if (typeof _toolSysteemTypeId === 'string' && _toolSysteemTypeId.startsWith(`ext:${extensionId}#`)) {
    zetToolSysteemType(null);
  }
}
