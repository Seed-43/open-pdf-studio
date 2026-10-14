// De MCP-opdrachten voor systeemtypen (#567), zonder app-state: de regels
// voor app_list_system_types, app_register_system_type,
// app_update_system_type, app_open_system_type_editor en
// app_get_system_geometry. mcp-bridge.js geeft de registry, de native editor
// en de geometrie van het actieve document mee als host; deze functies
// controleren de argumenten, roepen de host aan en lezen het resultaat terug.
//
// Rust controleert het inputSchema niet: dit is de echte poort. Een
// MCP-client is altijd de eigenaar `mcp:<key>` en kan zich niet uitgeven voor
// een extensie. Fouten zijn { ok:false, code, error } met dezelfde codes als
// de plugin-API (plus not-stored); de teksten zijn Engels.
//
// Host: getSysteemTypenData(), systeemTypeSnapshot(id),
// alleSysteemTypeSnapshots(), registreerSysteemType(eigenaar, key, def, opts),
// werkEigenSysteemTypeBij(eigenaar, id, changes, opts),
// openEditor({ typeId }) → { opened, typeId },
// systeemInstanceGeometrie(annotationId, opts) → snapshot | null.

import { SysteemTypeFout } from './systeem-typen-contract.js';

const MCP = Object.freeze({ kind: 'mcp' });

function fout(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

// Een wijziging die niet uit de bibliotheek terug te lezen is, is mislukt:
// nooit ok:true zonder het type zoals het in de bibliotheek staat.
const NIET_BEWAARD = 'the system type was not stored in the library';

function controleer(args, toegestaan) {
  if (args === undefined || args === null) return null;
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const sleutel of Object.keys(args)) {
    if (!toegestaan.includes(sleutel)) return `unknown argument: ${sleutel}`;
  }
  return null;
}

/** Een SysteemTypeFout als MCP-antwoord; andere fouten gaan door. */
function alsAntwoord(e) {
  if (!(e instanceof SysteemTypeFout)) throw e;
  const extra = {};
  if (e.field !== undefined) extra.field = e.field;
  if (e.currentRevision !== undefined) extra.currentRevision = e.currentRevision;
  return fout(e.code, e.message, extra);
}

/** Opties voor de host: alleen wat gegeven is. */
function opties(args, namen) {
  const uit = {};
  for (const naam of namen) if (args[naam] !== undefined) uit[naam] = args[naam];
  return uit;
}

/** app_list_system_types — alle typen, of één op id. Leest alleen. */
export function mcpLijstSysteemTypen(args, host) {
  const probleem = controleer(args, ['id']);
  if (probleem) return fout('invalid-argument', probleem);
  const libraryRevision = host.getSysteemTypenData().revisie;
  if (args?.id === undefined) {
    return { ok: true, libraryRevision, types: host.alleSysteemTypeSnapshots() };
  }
  if (typeof args.id !== 'string' || !args.id) return fout('invalid-argument', 'id must be a non-empty string');
  const type = host.systeemTypeSnapshot(args.id);
  if (!type) return fout('not-found', `unknown system type: ${args.id}`);
  return { ok: true, libraryRevision, type };
}

/** app_register_system_type — registreren onder mcp:<key>, idempotent. */
export function mcpRegistreerSysteemType(args, host) {
  const probleem = controleer(args, ['key', 'definition', 'schema', 'restore']);
  if (probleem) return fout('invalid-argument', probleem);
  const a = args || {};
  if (a.definition === undefined) return fout('invalid-argument', 'missing definition: the system type definition object');
  try {
    const r = host.registreerSysteemType(MCP, a.key, a.definition, opties(a, ['schema', 'restore']));
    if (r.status === 'removed-by-user') return { ok: true, status: r.status, type: null };
    const type = r.type ? host.systeemTypeSnapshot(r.type.id) : null;
    if (!type || type.revision !== r.type.revision) return fout('not-stored', NIET_BEWAARD);
    return { ok: true, status: r.status, type };
  } catch (e) {
    return alsAntwoord(e);
  }
}

/** app_update_system_type — een MCP-type bijwerken met revisiecontrole. */
export function mcpWerkSysteemTypeBij(args, host) {
  const probleem = controleer(args, ['id', 'expectedRevision', 'changes', 'schema']);
  if (probleem) return fout('invalid-argument', probleem);
  const a = args || {};
  if (typeof a.id !== 'string' || !a.id) return fout('invalid-argument', 'id must be a non-empty string');
  if (a.changes === undefined) return fout('invalid-argument', 'missing changes: the fields to change');
  try {
    const r = host.werkEigenSysteemTypeBij(MCP, a.id, a.changes, opties(a, ['expectedRevision', 'schema']));
    const type = host.systeemTypeSnapshot(a.id);
    if (!type || type.revision !== r.type?.revision) return fout('not-stored', NIET_BEWAARD);
    return { ok: true, status: r.status, type };
  } catch (e) {
    return alsAntwoord(e);
  }
}

/** app_open_system_type_editor — de native editor met dit type geselecteerd.
 *  Keert meteen terug; verandert geen gegevens. */
export function mcpOpenSysteemTypeEditor(args, host) {
  const probleem = controleer(args, ['id']);
  if (probleem) return fout('invalid-argument', probleem);
  const id = args?.id;
  if (typeof id !== 'string' || !id) return fout('invalid-argument', 'missing id: the stable id of the system type');
  if (!host.systeemTypeSnapshot(id)) return fout('not-found', `unknown system type: ${id}`);
  const r = host.openEditor({ typeId: id });
  return { ok: true, opened: r?.opened === true, typeId: id };
}

/** app_get_system_geometry — de geometrie van één systeem in het actieve
 *  document (punt 7 van #567), met document- en typerevisie. Leest alleen. */
export function mcpSysteemGeometrie(args, host) {
  const probleem = controleer(args, ['annotationId', 'expectedDocumentRevision', 'expectedTypeRevision', 'schema']);
  if (probleem) return fout('invalid-argument', probleem);
  const a = args || {};
  if (typeof a.annotationId !== 'string' || !a.annotationId) {
    return fout('invalid-argument', 'missing annotationId: the id of a system annotation (type systeemraster) in the active document');
  }
  try {
    const geometry = host.systeemInstanceGeometrie(a.annotationId,
      opties(a, ['expectedDocumentRevision', 'expectedTypeRevision', 'schema']));
    if (!geometry) return fout('not-found', `no system with id ${a.annotationId} in the active document`);
    return { ok: true, geometry };
  } catch (e) {
    return alsAntwoord(e);
  }
}
