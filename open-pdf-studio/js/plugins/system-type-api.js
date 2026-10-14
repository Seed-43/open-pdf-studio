/**
 * Systeemtypen in de plugin-API (#567).
 *
 * Dunne laag over de systeemtype-registry met een geïnjecteerde host, zelfde
 * patroon als annotation-batch.js: plugin-api.js geeft de echte registry, de
 * native tool-wissel en de native editor mee; tests hun eigen host. Contract,
 * foutcodes en levenscyclus: docs/plugin-systeemtypen.md.
 *
 * Host (alles synchroon):
 *   getSysteemTypenData(), systeemTypeSnapshot(id), alleSysteemTypeSnapshots(),
 *   registreerSysteemType(owner, key, definition, options),
 *   werkEigenSysteemTypeBij(owner, id, changes, options),
 *   kiesToolSysteemType(id, activeer) → boolean,
 *   wisToolSysteemTypeVanExtensie(extensionId),
 *   onSysteemTypenGewijzigd(listener) → unsubscribe,
 *   meldExtensieActief(extensionId) → release,
 *   systeemInstanceGeometrie(annotationId, options) → snapshot | null,
 *   setTool(name), openEditor({ typeId }) → { opened, typeId }.
 *
 * Na dispose() (_cleanup bij deactiveren) weigert de api elke wijziging, de
 * tool-keuze, het openen van de editor en nieuwe listeners met de code
 * 'disposed'; lezen blijft werken.
 */

import { SysteemTypeFout } from '../annotations/systeem-typen-contract.js';
import { EXTENSIE_ID_RE, TYPE_KEY_RE } from '../annotations/systeem-typen.js';

/** De native tool die een getypeerd systeem tekent ('systeemplafond' is
 *  historisch: het is de getypeerde variant en werkt voor elke categorie). */
const SYSTEEM_TOOL = 'systeemplafond';

function nietGevonden(id) {
  return new SysteemTypeFout('not-found', `unknown system type: ${id}`);
}

export function createSystemTypeApi(pluginId, host) {
  const eigenaar = { kind: 'extension', extensionId: pluginId };
  const geldigeEigenaar = typeof pluginId === 'string' && EXTENSIE_ID_RE.test(pluginId);
  // Geladen vanaf het aanmaken (vóór activate) tot dispose (_cleanup).
  const laatLos = geldigeEigenaar ? host.meldExtensieActief(pluginId) : () => {};
  const listeners = new Set();
  let stopRegistry = null;
  let opgeruimd = false;

  function bestaand(id) {
    const snapshot = typeof id === 'string' ? host.systeemTypeSnapshot(id) : null;
    if (!snapshot) throw nietGevonden(id);
    return snapshot;
  }

  // Een opgeruimde api (de extensie is gedeactiveerd) wijzigt niets meer:
  // "bijwerken via de API kan pas weer als de extensie terug is".
  function nogActief() {
    if (opgeruimd) {
      throw new SysteemTypeFout('disposed', `the system type API of ${JSON.stringify(pluginId)} was disposed: the extension is not active`);
    }
  }

  function zorgVoorAbonnement() {
    if (stopRegistry || opgeruimd) return;
    stopRegistry = host.onSysteemTypenGewijzigd((event) => {
      for (const listener of [...listeners]) {
        try {
          listener(JSON.parse(JSON.stringify(event)));
        } catch (error) {
          console.warn('[plugin] systemTypesChanged listener failed', error);
        }
      }
    });
  }

  return {
    /** Snapshots van alle typen (volgorde van de bibliotheek), of alleen de eigen typen. */
    listSystemTypes(options) {
      if (options !== undefined) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
          throw new SysteemTypeFout('invalid-argument', 'options must be an object');
        }
        for (const key of Object.keys(options)) {
          if (key !== 'owned') throw new SysteemTypeFout('invalid-argument', `unknown option: ${key}`);
        }
        if (options.owned !== undefined && typeof options.owned !== 'boolean') {
          throw new SysteemTypeFout('invalid-argument', 'owned must be a boolean');
        }
      }
      const all = host.alleSysteemTypeSnapshots();
      if (options?.owned !== true) return all;
      return all.filter(s => s.owner.kind === 'extension' && s.owner.extensionId === pluginId);
    },

    /** Eén losgekoppelde snapshot op stabiel id; null voor een onbekend of verwijderd id. */
    getSystemType(id) {
      return typeof id === 'string' ? host.systeemTypeSnapshot(id) : null;
    },

    /** Het stabiele id dat deze plugin voor `key` krijgt: 'ext:<pluginId>#<key>'. */
    systemTypeId(key) {
      if (!geldigeEigenaar) {
        throw new SysteemTypeFout('invalid-owner', `the extension id ${JSON.stringify(pluginId)} does not match the system type namespace grammar`);
      }
      if (typeof key !== 'string' || !TYPE_KEY_RE.test(key)) {
        throw new SysteemTypeFout('invalid-key', `invalid key: ${JSON.stringify(key)}`);
      }
      return `ext:${pluginId}#${key}`;
    },

    /** Registreer (idempotent) een eigen type → { status, type }. */
    registerSystemType(key, definition, options) {
      nogActief();
      return host.registreerSysteemType(eigenaar, key, definition, options);
    },

    /** Werk een eigen type bij met een revisiecontrole → { status, type }. */
    updateSystemType(id, changes, options) {
      nogActief();
      return host.werkEigenSysteemTypeBij(eigenaar, id, changes, options);
    },

    /** Laat de native systeemtool met dit type tekenen. De keuze geldt voor
     *  de tool-sessie die deze aanroep start; een tool-wissel of een native
     *  activering zet de tool terug op het standaardtype. `active` is false
     *  als de tool niet geactiveerd kon worden (dan is er geen keuze). */
    selectSystemTypeForTool(id) {
      nogActief();
      const snapshot = bestaand(id);
      const active = host.kiesToolSysteemType(snapshot.id, () => host.setTool(SYSTEEM_TOOL)) === true;
      return { tool: SYSTEEM_TOOL, typeId: snapshot.id, active };
    },

    /** Open de native systeemtypen-editor met de focus op dit type. Keert
     *  meteen terug; de gebruiker past toe of annuleert. */
    openSystemTypeEditor(id) {
      nogActief();
      const snapshot = bestaand(id);
      const r = host.openEditor({ typeId: snapshot.id });
      return { opened: r?.opened === true, typeId: snapshot.id };
    },

    /**
     * Losgekoppelde geometrie van een systeem-instance in het actieve
     * document (punt 7 van #567): millimeters in het eigen assenstelsel van
     * het systeem, met document- en typerevisie en de bevestiging van de
     * maten. null als er geen systeem met dat id is; een verouderde
     * `expectedDocumentRevision` of `expectedTypeRevision` geeft
     * stale-revision. Leest alleen.
     */
    getSystemInstanceGeometry(annotationId, options) {
      return host.systeemInstanceGeometrie(annotationId, options);
    },

    /** Aangeroepen na elke bevestigde wijziging van de bibliotheek; geeft de afmeldfunctie. */
    onSystemTypesChanged(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      nogActief();
      listeners.add(listener);
      zorgVoorAbonnement();
      return () => { listeners.delete(listener); };
    },

    /** Runtime opruimen (plugin _cleanup): listeners, de geladen-markering en
     *  een tool-keuze van deze extensie; bewaarde typen blijven altijd. */
    dispose() {
      if (opgeruimd) return;
      opgeruimd = true;
      stopRegistry?.();
      stopRegistry = null;
      listeners.clear();
      if (geldigeEigenaar) host.wisToolSysteemTypeVanExtensie(pluginId);
      laatLos();
    },
  };
}
