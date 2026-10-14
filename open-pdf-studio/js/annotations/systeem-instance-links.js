// Koppelingen van extensies aan native systeem-instances (#574) — PUUR.
//
// Een extensie kan een systeemraster-instance aan zichzelf koppelen. De
// koppeling staat op de annotatie als
//   ann.extensionLinks = { '<extensie-id>': { revision: n, data: { … } } }
// en reist mee in de PDF (OPS_SgExtLinks, JSON). `data` is van de extensie
// (bijvoorbeeld een technisch projectsysteem); de host bewaakt alleen de vorm
// en de grootte. Een instance van een type van de extensie zelf
// ('ext:<id>#…') hoort ook bij die extensie, zonder koppeling.
//
// Daarnaast: de revisie van een instance (een vingerafdruk van geometrie,
// type, tag, vergrendeling en alle koppelingen), het toekennen van een type
// zoals het eigenschappenpaneel dat doet, en hoeveelheden die alleen uit de
// gedocumenteerde geometriesnapshot (systeem-geometrie.js) komen.
//
// Contract: docs/plugin-systeemtypen.md §16.

import { canoniek, hash53 } from './systeem-geometrie.js';
import { EXTENSIE_ID_RE } from './systeem-typen.js';

export const MAX_LINK_DATA = 16 * 1024;
export const MAX_LINKS = 8;

const isPlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

function isJson(v, gezien = new Set()) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object' || gezien.has(v)) return false;
  if (!Array.isArray(v) && !isPlatObject(v)) return false;
  gezien.add(v);
  const ok = (Array.isArray(v) ? v : Object.values(v)).every((k) => isJson(k, gezien));
  gezien.delete(v);
  return ok;
}

/** Is dit geldige koppelingsdata: een JSON-object van hooguit 16 KB? */
export function isGeldigeLinkData(data) {
  return isPlatObject(data) && isJson(data) && JSON.stringify(data).length <= MAX_LINK_DATA;
}

/**
 * Schone kopie van `extensionLinks`, of undefined als er niets geldigs is.
 * Ongeldige items (verkeerd id, revisie of data) vallen weg; hooguit 8,
 * gesorteerd op id.
 */
export function normaliseerLinks(raw) {
  if (!isPlatObject(raw)) return undefined;
  const uit = {};
  for (const id of Object.keys(raw).sort()) {
    const l = raw[id];
    if (!EXTENSIE_ID_RE.test(id) || !isPlatObject(l)) continue;
    if (!Number.isInteger(l.revision) || l.revision < 1) continue;
    if (!isGeldigeLinkData(l.data)) continue;
    uit[id] = { revision: l.revision, data: JSON.parse(JSON.stringify(l.data)) };
    if (Object.keys(uit).length >= MAX_LINKS) break;
  }
  return Object.keys(uit).length ? uit : undefined;
}

/** JSON voor OPS_SgExtLinks bij opslaan, of null zonder koppelingen. */
export function linksNaarJson(ann) {
  const links = normaliseerLinks(ann?.extensionLinks);
  return links ? JSON.stringify(links) : null;
}

/** De koppelingen uit OPS_SgExtLinks bij laden; undefined bij niets of onzin. */
export function linksUitJson(tekst) {
  if (typeof tekst !== 'string' || !tekst || tekst.length > MAX_LINKS * (MAX_LINK_DATA + 256)) return undefined;
  try {
    return normaliseerLinks(JSON.parse(tekst));
  } catch {
    return undefined;
  }
}

/** Is de instance gekoppeld aan deze extensie? */
export const isGekoppeld = (ann, extId) => Object.hasOwn(normaliseerLinks(ann?.extensionLinks) ?? {}, extId);

/** Heeft de instance een systeemtype van deze extensie ('ext:<id>#…')? */
export const heeftEigenType = (ann, extId) => typeof ann?.systeemTypeId === 'string'
  && ann.systeemTypeId.startsWith(`ext:${extId}#`);

/**
 * Revisie van een instance ('i1-…'): verandert als de geometrie-invoer
 * (geometrieRevisie, 'g1-…'), het type, de tag, de vergrendeling of een
 * koppeling van welke extensie dan ook verandert.
 */
export function instanceRevisie(ann, geometrieRevisie) {
  return `i1-${hash53(canoniek({
    g: geometrieRevisie ?? null,
    t: ann?.systeemTypeId || null,
    tag: ann?.tagTonen !== false,
    lock: ann?.locked === true,
    links: normaliseerLinks(ann?.extensionLinks) ?? null,
  }))}`;
}

/**
 * Ken een systeemtype toe aan een instance, zoals de typekeuze in het
 * eigenschappenpaneel: de verwijzing, en met een gevonden type ook de
 * IFC-categorie en het voorgedefinieerde type. Muteert `ann`.
 */
export function kenSysteemTypeToe(ann, typeId, typeDef) {
  ann.systeemTypeId = typeId || undefined;
  if (typeDef) {
    ann.ifcCategory = typeDef.ifcCategory;
    ann.ifcPredefinedType = typeDef.ifcPredefinedType;
  }
}

const r6 = (v) => {
  const n = Math.round(v * 1e6) / 1e6;
  return n === 0 ? 0 : n;
};

const tel = (lijst, sleutel) => {
  const uit = {};
  for (const x of lijst) {
    const k = String(sleutel(x) ?? '');
    uit[k] = (uit[k] ?? 0) + 1;
  }
  return uit;
};

/**
 * Hoeveelheden van een instance, alleen uit een geometriesnapshot (schema 1,
 * systeem-geometrie.js): oppervlakte en omtrek van de contour, panelen per
 * type (vol en randpaneel), componenten per symbool, sparingen per regime,
 * randlengte per profiel en stroken. Eenheden m² en m. Bij een onbevestigde
 * maat zijn er geen panelen en is `confirmed` false: nooit een verzonnen
 * aantal.
 */
export function systeemHoeveelheden(geo) {
  if (!geo || geo.schema !== 1) return null;
  const contour = Array.isArray(geo.contour) ? geo.contour : [];
  let omtrek = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    if (contour.length > 1) omtrek += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const panelen = Array.isArray(geo.panels) ? geo.panels : [];
  const componenten = Array.isArray(geo.components) ? geo.components : [];
  const sparingen = Array.isArray(geo.openings) ? geo.openings : [];
  const randen = Array.isArray(geo.edges) ? geo.edges : [];
  const stroken = Array.isArray(geo.strips) ? geo.strips : [];
  const randPerProfiel = {};
  for (const r of randen) {
    const k = String(r.profile ?? '');
    randPerProfiel[k] = r6((randPerProfiel[k] ?? 0) + (Number(r.length) || 0) / 1000);
  }
  return {
    schema: 1,
    annotationId: geo.annotationId ?? null,
    document: geo.document ? { ...geo.document } : null,
    type: geo.type ? { ...geo.type } : null,
    confirmed: geo.confirmed === true,
    unconfirmed: [...(geo.unconfirmed || [])],
    units: { area: 'm2', length: 'm' },
    area: r6((Number(geo.areaMm2) || 0) / 1e6),
    perimeter: r6(omtrek / 1000),
    panels: {
      total: panelen.length,
      full: panelen.filter((p) => p.edge !== true).length,
      edge: panelen.filter((p) => p.edge === true).length,
      byType: tel(panelen, (p) => p.panelType),
    },
    components: { total: componenten.length, bySymbol: tel(componenten, (c) => c.symbolId) },
    openings: { total: sparingen.length, byRegime: tel(sparingen, (s) => s.regime) },
    edges: { byProfile: randPerProfiel },
    strips: { total: stroken.length, fit: stroken.filter((s) => s.fit === true).length },
  };
}
