/**
 * Systeem-instances in de plugin-API (#574).
 *
 * Een extensie leest losgekoppelde snapshots van native systeem-instances
 * (annotaties van type 'systeemraster') in het actieve document, koppelt een
 * instance aan zichzelf met eigen technische gegevens, en wijzigt die
 * gegevens of de native typekeuze en tag met een revisiecontrole. Elke
 * wijziging loopt via de native validatie, is één undo-stap, tekent opnieuw
 * en ververst het eigenschappenpaneel. Hoeveelheden komen alleen uit de
 * gedocumenteerde geometriesnapshot.
 *
 * Dunne laag met een geïnjecteerde host, zelfde patroon als
 * system-type-api.js. Host (alles synchroon):
 *   actiefDocument() → doc | null,
 *   geometrieRevisie(ann) → 'g1-…',
 *   geometrie(annotationId, opties) → geometriesnapshot | null,
 *   typeSnapshot(id) → systeemtype-snapshot | null,
 *   typeDefinitie(id) → het type uit de bibliotheek (voor de IFC-velden, zoals
 *     de typekeuze in het eigenschappenpaneel), of null,
 *   wijzig(doc, ann, muteer) → voert muteer(ann) uit als één undo-stap,
 *     tekent opnieuw en ververst het paneel als ann geselecteerd is.
 *
 * Fouten: SysteemTypeFout met code invalid-argument, no-document, not-found,
 * stale-revision (met currentRevision), not-linked, locked, unknown-type,
 * limit-exceeded of disposed. Contract: docs/plugin-systeemtypen.md §16.
 */

import { SysteemTypeFout } from '../annotations/systeem-typen-contract.js';
import { EXTENSIE_ID_RE } from '../annotations/systeem-typen.js';
import {
  normaliseerLinks, isGeldigeLinkData, instanceRevisie, heeftEigenType, kenSysteemTypeToe,
  systeemHoeveelheden, MAX_LINKS, MAX_LINK_DATA,
} from '../annotations/systeem-instance-links.js';

const SYSTEEM = 'systeemraster';
const fout = (code, bericht, extra) => new SysteemTypeFout(code, bericht, extra);
const isPlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const kloon = (v) => JSON.parse(JSON.stringify(v));

function alleenVelden(obj, toegestaan, wat) {
  if (!isPlatObject(obj)) throw fout('invalid-argument', `${wat} must be an object`);
  for (const k of Object.keys(obj)) {
    if (!toegestaan.includes(k)) throw fout('invalid-argument', `${wat}: unknown field "${k}"`);
  }
}

/**
 * Het beeld van een instance voor één extensie: native velden, het type, de
 * eigen koppeling en welke andere extensies gekoppeld zijn (zonder hun data).
 */
export function instanceSnapshot(extId, doc, ann, host) {
  const links = normaliseerLinks(ann.extensionLinks) ?? {};
  const geometrieRevisie = host.geometrieRevisie(ann);
  const typeId = typeof ann.systeemTypeId === 'string' && ann.systeemTypeId ? ann.systeemTypeId : null;
  return {
    schema: 1,
    annotationId: ann.id,
    documentId: doc.id ?? null,
    page: ann.page ?? null,
    revision: instanceRevisie(ann, geometrieRevisie),
    geometryRevision: geometrieRevisie,
    locked: ann.locked === true,
    native: {
      systemTypeId: typeId,
      showTag: ann.tagTonen !== false,
      ifcCategory: ann.ifcCategory || null,
    },
    type: typeId ? host.typeSnapshot(typeId) : null,
    link: links[extId] ? kloon(links[extId]) : null,
    ownedType: heeftEigenType(ann, extId),
    linkedExtensions: Object.keys(links),
  };
}

export function createSystemInstanceApi(pluginId, host) {
  const geldig = typeof pluginId === 'string' && EXTENSIE_ID_RE.test(pluginId);
  let opgeruimd = false;

  function nogActief() {
    if (opgeruimd) throw fout('disposed', `the system instance API of ${JSON.stringify(pluginId)} was disposed: the extension is not active`);
    if (!geldig) throw fout('invalid-owner', `the extension id ${JSON.stringify(pluginId)} cannot own system instance links`);
  }

  function zoek(annotationId) {
    if (typeof annotationId !== 'string' || !annotationId) throw fout('invalid-argument', 'annotationId must be a non-empty string');
    const doc = host.actiefDocument();
    if (!doc) throw fout('no-document', 'no document is open');
    const ann = (doc.annotations || []).find((a) => a && a.id === annotationId && a.type === SYSTEEM);
    if (!ann) throw fout('not-found', `no system instance with id ${annotationId} in the active document`);
    return { doc, ann };
  }

  function controleerRevisie(doc, ann, verwacht) {
    if (typeof verwacht !== 'string' || !verwacht) {
      throw fout('invalid-argument', 'expectedRevision must be the revision of an earlier snapshot');
    }
    const huidig = instanceRevisie(ann, host.geometrieRevisie(ann));
    if (verwacht !== huidig) {
      throw fout('stale-revision', `stale instance revision: expected ${verwacht}, the current revision is ${huidig}`,
        { field: 'expectedRevision', currentRevision: huidig });
    }
  }

  function nietVergrendeld(ann) {
    if (ann.locked === true) throw fout('locked', 'the system instance is locked');
  }

  // Eén wijziging: één undo-stap, opnieuw tekenen, paneel verversen.
  function voerUit(doc, ann, muteer) {
    host.wijzig(doc, ann, muteer);
    return instanceSnapshot(pluginId, doc, ann, host);
  }

  function zetLink(ann, link) {
    const links = { ...(normaliseerLinks(ann.extensionLinks) ?? {}) };
    if (link) links[pluginId] = link;
    else delete links[pluginId];
    if (Object.keys(links).length) ann.extensionLinks = links;
    else delete ann.extensionLinks;
  }

  function controleerData(data) {
    if (!isGeldigeLinkData(data)) {
      throw fout('invalid-argument', `data must be a JSON object of at most ${MAX_LINK_DATA / 1024} KB`);
    }
  }

  return {
    /** Snapshot van een systeem-instance in het actieve document, of null. */
    getSystemInstance(annotationId) {
      if (typeof annotationId !== 'string' || !annotationId) return null;
      const doc = host.actiefDocument();
      const ann = (doc?.annotations || []).find((a) => a && a.id === annotationId && a.type === SYSTEEM);
      return ann ? instanceSnapshot(pluginId, doc, ann, host) : null;
    },

    /** Alle systeem-instances van het actieve document, kort. */
    listSystemInstances() {
      const doc = host.actiefDocument();
      if (!doc) return [];
      return (doc.annotations || []).filter((a) => a && a.type === SYSTEEM && typeof a.id === 'string').map((ann) => ({
        annotationId: ann.id,
        page: ann.page ?? null,
        revision: instanceRevisie(ann, host.geometrieRevisie(ann)),
        linked: Object.hasOwn(normaliseerLinks(ann.extensionLinks) ?? {}, pluginId),
        ownedType: heeftEigenType(ann, pluginId),
      }));
    },

    /** Koppel een instance aan deze extensie met eigen data. */
    linkSystemInstance(annotationId, options) {
      nogActief();
      alleenVelden(options, ['expectedRevision', 'data'], 'options');
      const data = options.data ?? {};
      controleerData(data);
      const { doc, ann } = zoek(annotationId);
      controleerRevisie(doc, ann, options.expectedRevision);
      nietVergrendeld(ann);
      const links = normaliseerLinks(ann.extensionLinks) ?? {};
      if (links[pluginId]) {
        return { status: 'unchanged', instance: instanceSnapshot(pluginId, doc, ann, host) };
      }
      if (Object.keys(links).length >= MAX_LINKS) {
        throw fout('limit-exceeded', `a system instance can be linked to at most ${MAX_LINKS} extensions`);
      }
      const instance = voerUit(doc, ann, (a) => zetLink(a, { revision: 1, data: kloon(data) }));
      return { status: 'linked', instance };
    },

    /**
     * Wijzig een instance van deze extensie (gekoppeld of met een eigen
     * type): de eigen data (in zijn geheel), het systeemtype (een bestaand
     * type, of null) en/of de tag.
     */
    updateSystemInstance(annotationId, changes) {
      nogActief();
      alleenVelden(changes, ['expectedRevision', 'data', 'systemTypeId', 'showTag'], 'changes');
      const { doc, ann } = zoek(annotationId);
      controleerRevisie(doc, ann, changes.expectedRevision);
      nietVergrendeld(ann);
      const links = normaliseerLinks(ann.extensionLinks) ?? {};
      // Gekoppeld, of een eigen type ('ext:<id>#…'): dan hoort de instance
      // bij de extensie; eigen data maakt de koppeling dan alsnog.
      if (!links[pluginId] && !heeftEigenType(ann, pluginId)) {
        throw fout('not-linked', `system instance ${annotationId} is not linked to ${pluginId}`);
      }
      const eigen = links[pluginId] ?? { revision: 0, data: null };
      if (changes.data !== undefined) controleerData(changes.data);
      let typeDef = null;
      if (changes.systemTypeId !== undefined && changes.systemTypeId !== null) {
        if (typeof changes.systemTypeId !== 'string' || !changes.systemTypeId) {
          throw fout('invalid-argument', 'systemTypeId must be the id of a system type, or null');
        }
        if (!host.typeSnapshot(changes.systemTypeId)) throw fout('unknown-type', `unknown system type: ${changes.systemTypeId}`);
        typeDef = host.typeDefinitie(changes.systemTypeId);
      }
      if (changes.showTag !== undefined && typeof changes.showTag !== 'boolean') {
        throw fout('invalid-argument', 'showTag must be a boolean');
      }
      const andereData = changes.data !== undefined && JSON.stringify(changes.data) !== JSON.stringify(eigen.data);
      const anderType = changes.systemTypeId !== undefined && (changes.systemTypeId || null) !== (ann.systeemTypeId || null);
      const andereTag = changes.showTag !== undefined && changes.showTag !== (ann.tagTonen !== false);
      if (!andereData && !anderType && !andereTag) {
        return { status: 'unchanged', instance: instanceSnapshot(pluginId, doc, ann, host) };
      }
      const instance = voerUit(doc, ann, (a) => {
        if (andereData) zetLink(a, { revision: eigen.revision + 1, data: kloon(changes.data) });
        if (anderType) kenSysteemTypeToe(a, changes.systemTypeId || undefined, typeDef);
        if (andereTag) a.tagTonen = changes.showTag;
        a.modifiedAt = new Date().toISOString();
      });
      return { status: 'updated', instance };
    },

    /** Maak de koppeling van deze extensie los. */
    unlinkSystemInstance(annotationId, options) {
      nogActief();
      alleenVelden(options, ['expectedRevision'], 'options');
      const { doc, ann } = zoek(annotationId);
      controleerRevisie(doc, ann, options.expectedRevision);
      nietVergrendeld(ann);
      if (!(normaliseerLinks(ann.extensionLinks) ?? {})[pluginId]) {
        return { status: 'unchanged', instance: instanceSnapshot(pluginId, doc, ann, host) };
      }
      const instance = voerUit(doc, ann, (a) => zetLink(a, null));
      return { status: 'unlinked', instance };
    },

    /**
     * Hoeveelheden uit de geometriesnapshot (m², m, aantallen). Met
     * expectedRevision wordt een verouderde instance geweigerd.
     */
    getSystemInstanceQuantities(annotationId, options) {
      if (options !== undefined) alleenVelden(options, ['expectedRevision'], 'options');
      const { doc, ann } = zoek(annotationId);
      if (options?.expectedRevision !== undefined) controleerRevisie(doc, ann, options.expectedRevision);
      return systeemHoeveelheden(host.geometrie(annotationId));
    },

    dispose() {
      opgeruimd = true;
    },
  };
}
