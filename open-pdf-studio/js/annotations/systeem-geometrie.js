// Documentgebonden geometrie van een systeem-instance (#567, punt 7) — PUUR
// (geen app-state, UI of DOM). De app-laag (systeem-geometrie-app.js) zoekt
// de annotatie, de schaal op die plek en het type op; de plugin-API
// (getSystemInstanceGeometry) en MCP (app_get_system_geometry) geven het
// resultaat door.
//
// Kern (zie docs/plugin-systeemtypen.md §12a):
//  - Eén bron van waarheid: de snapshot komt uit buildSysteemraster, dezelfde
//    geometrie als het tekenen, de preview en de PDF-appearance. Panelen,
//    geknipte randpanelen, sparingen, raveels, randsegmenten en
//    componentposities worden alleen omgerekend, nooit opnieuw berekend.
//  - Assenstelsel 'system': werkelijke millimeters (via de tekenschaal op die
//    plek), oorsprong in de minimumhoek van de contour-AABB in rasterruimte,
//    x en y langs de rasterrichtingen. `placement` zet het stelsel terug op
//    de pagina (paginapunten, y omlaag):
//      pagina = origin + k · (x·cos θ − y·sin θ, x·sin θ + y·cos θ).
//    Zoom en weergaverotatie zijn geen invoer: annotaties leven in
//    paginaruimte.
//  - Bevestiging: `confirmed` is alleen true als geen enkele gebruikte
//    fysieke maat onbevestigd is (ook de schaal) en geen gebruikte
//    typewaarde schema 1 overtreedt. Een onbevestigde maat krijgt nooit een
//    standaardwaarde.
//  - Revisies: `document.revision` is een vingerafdruk van alles waar de
//    geometrie van de instance van afhangt (contour, oorsprong, hoek,
//    overrides, sparingen, typeverwijzing, schaal); `type.revision` is de
//    revisie van het type. Een verouderde verwachte revisie geeft
//    stale-revision.
//  - Losgekoppeld: een verse kopie zonder PDF-bytes, preferences of UI-data.

import {
  buildSysteemraster, rotToRaster, rotToWorld, resolveSysteemrasterParams, systeemrasterContour,
  resolveSysteem, normaliseSparing, PX_PER_MM_1_100,
} from './systeemraster.js';
import { onbevestigdeMaten, vereisteMaten } from './systeem-typen.js';
import { SysteemTypeFout, valideerSchema, publiekeSnapshot } from './systeem-typen-contract.js';

/** Versie van de vorm van de geometriesnapshot. */
export const GEOMETRIE_SCHEMA = 1;

const isPlatObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Millimeters (en paginapunten) op 3 decimalen: stabiele JSON, geen -0.
const r3 = (v) => {
  const n = Math.round(v * 1000) / 1000;
  return n === 0 ? 0 : n;
};

// JSON met gesorteerde sleutels: volgorde-onafhankelijke vingerafdruk.
// Ook gebruikt voor de instancerevisie (systeem-instance-links.js, #574).
export function canoniek(v) {
  if (Array.isArray(v)) return `[${v.map(canoniek).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canoniek(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

// 53-bits hash (cyrb53): genoeg om wijzigingen te herkennen; geen beveiliging.
export function hash53(tekst) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const effectieveSchaal = (pxPerMm) => (Number(pxPerMm) > 0 ? Number(pxPerMm) : PX_PER_MM_1_100);
const schaalBekend = (pxPerMm) => Number(pxPerMm) > 0;

// Sparingen zoals ze bewaard zijn (zonder de willekeurige id die de
// normalisatie aan een sparing zonder id geeft): voor een stabiele
// vingerafdruk en voor de id's in de snapshot.
function bewaardeSparingen(ann) {
  const lijst = Array.isArray(ann?.sparingen) ? ann.sparingen : [];
  return lijst.filter(s => normaliseSparing(s)).map(s => ({
    id: typeof s.id === 'string' && s.id ? s.id : null,
    xMm: Number(s.xMm), yMm: Number(s.yMm), bMm: Number(s.bMm), hMm: Number(s.hMm),
  }));
}

/**
 * Documentrevisie van een instance: een vingerafdruk ('g1-…') van alles waar
 * de geometrie van afhangt — pagina, contour (met bogen), systeem-overrides,
 * sparingen, rasterparameters, plaatmaat van de instance, typeverwijzing en
 * de tekenschaal op die plek. Kleur, selectie en andere weergavevelden tellen
 * niet mee. Puur.
 */
export function documentRevisie(ann, pxPerMm) {
  const params = resolveSysteemrasterParams(ann);
  delete params.tagTonen;
  delete params.tagFontSize;
  const invoer = {
    page: ann?.page ?? null,
    contour: systeemrasterContour(ann) || [],
    systeem: resolveSysteem(ann),
    sparingen: bewaardeSparingen(ann),
    params,
    plaat: [ann?.plaatBreedteMm ?? null, ann?.plaatHoogteMm ?? null],
    typeId: ann?.systeemTypeId || null,
    schaal: [effectieveSchaal(pxPerMm), schaalBekend(pxPerMm)],
  };
  return `g1-${hash53(canoniek(invoer))}`;
}

/** Controleer de opties { expectedDocumentRevision?, expectedTypeRevision?,
 *  schema? }; geeft een kopie (elke optie één keer gelezen). */
export function controleerGeometrieOpties(invoer) {
  if (invoer === undefined) return {};
  if (!isPlatObject(invoer)) {
    throw new SysteemTypeFout('invalid-argument', 'options must be an object with expectedDocumentRevision, expectedTypeRevision, schema');
  }
  for (const sleutel of Object.keys(invoer)) {
    if (!['expectedDocumentRevision', 'expectedTypeRevision', 'schema'].includes(sleutel)) {
      throw new SysteemTypeFout('invalid-argument', `unknown option: ${sleutel}`);
    }
  }
  const opties = { ...invoer };
  valideerSchema(opties.schema);
  if (opties.expectedDocumentRevision !== undefined
      && (typeof opties.expectedDocumentRevision !== 'string' || !opties.expectedDocumentRevision)) {
    throw new SysteemTypeFout('invalid-argument', 'expectedDocumentRevision must be the document.revision string of an earlier snapshot');
  }
  if (opties.expectedTypeRevision !== undefined
      && (!Number.isInteger(opties.expectedTypeRevision) || opties.expectedTypeRevision < 1)) {
    throw new SysteemTypeFout('invalid-argument', 'expectedTypeRevision must be an integer of at least 1');
  }
  return opties;
}

// Sutherland–Hodgman: de polygoon `pts` geknipt op de (convexe) rechthoek.
// Bij een concave contour die een cel in stukken deelt, hangen de stukken
// aan elkaar met randen zonder oppervlak; de oppervlakte klopt altijd.
function knipOpRechthoek(pts, x0, y0, x1, y1) {
  const randen = [
    [p => p.x >= x0, (a, b) => ({ x: x0, y: a.y + (x0 - a.x) * (b.y - a.y) / (b.x - a.x) })],
    [p => p.x <= x1, (a, b) => ({ x: x1, y: a.y + (x1 - a.x) * (b.y - a.y) / (b.x - a.x) })],
    [p => p.y >= y0, (a, b) => ({ x: a.x + (y0 - a.y) * (b.x - a.x) / (b.y - a.y), y: y0 })],
    [p => p.y <= y1, (a, b) => ({ x: a.x + (y1 - a.y) * (b.x - a.x) / (b.y - a.y), y: y1 })],
  ];
  let uit = pts;
  for (const [binnen, snij] of randen) {
    const lijst = uit;
    uit = [];
    for (let i = 0; i < lijst.length; i++) {
      const cur = lijst[i], prev = lijst[(i + lijst.length - 1) % lijst.length];
      if (binnen(cur)) {
        if (!binnen(prev)) uit.push(snij(prev, cur));
        uit.push(cur);
      } else if (binnen(prev)) {
        uit.push(snij(prev, cur));
      }
    }
    if (uit.length === 0) break;
  }
  return uit;
}

// Opeenvolgende gelijke punten weg (na afronden), ook laatste == eerste.
function zonderDubbelen(pts) {
  const uit = [];
  for (const p of pts) {
    const v = uit[uit.length - 1];
    if (!v || v.x !== p.x || v.y !== p.y) uit.push(p);
  }
  while (uit.length > 1 && uit[0].x === uit[uit.length - 1].x && uit[0].y === uit[uit.length - 1].y) uit.pop();
  return uit;
}

function oppervlak(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Welke gebruikte fysieke maten ontbreken, en welke gebruikte typewaarden
// overtreden schema 1? Sparingsregels tellen alleen mee als er sparingen zijn.
function bevestiging(ann, typeDef, geom, pxPerMm) {
  const onbevestigd = [];
  const problemen = [];
  const heeftSparingen = geom.sparingen.length > 0;
  if (typeDef) {
    onbevestigd.push(...geom.onbevestigd);
    if (heeftSparingen) {
      onbevestigd.push(...onbevestigdeMaten(typeDef).filter(v => v.startsWith('sparingRegels.')));
    }
    const gebruikt = [...vereisteMaten(geom.layout), ...(heeftSparingen ? ['sparingRegels'] : [])];
    for (const p of publiekeSnapshot(typeDef).problems) {
      const veld = gebruikt.find(v => p.field === v || p.field.startsWith(`${v}.`));
      if (veld && !problemen.includes(veld)) problemen.push(veld);
    }
  } else {
    const geldig = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!geldig(ann.plaatBreedteMm)) onbevestigd.push('plaatBreedteMm');
    if (!geldig(ann.plaatHoogteMm)) onbevestigd.push('plaatHoogteMm');
    // Zonder type gelden standaard-sparingsregels: niet door iemand bevestigd.
    if (heeftSparingen) onbevestigd.push('sparingRegels.kleineSparingMaxMm', 'sparingRegels.raveelVanafMm');
  }
  if (!schaalBekend(pxPerMm)) onbevestigd.push('scale');
  return { onbevestigd, problemen };
}

/**
 * De geometriesnapshot van één systeem-instance (§12a).
 * @param {object} p
 * @param {string|null} p.documentId  id van het document van de instance
 * @param {object} p.ann              de systeemraster-annotatie
 * @param {number} p.pxPerMm          tekenschaal op die plek (0 = onbekend)
 * @param {object|null} p.typeDef     het type uit de bibliotheek, of null
 * @param {object} [p.opties]         { expectedDocumentRevision?, expectedTypeRevision?, schema? }
 * @returns {object|null} null als de instance geen geldige contour heeft.
 * Gooit SysteemTypeFout: invalid-argument, unsupported-version, stale-revision
 * (met field en currentRevision).
 */
export function systeemGeometrie({ documentId = null, ann, pxPerMm, typeDef = null, opties } = {}) {
  const opt = controleerGeometrieOpties(opties);
  const revisie = documentRevisie(ann, pxPerMm);
  if (opt.expectedDocumentRevision !== undefined && opt.expectedDocumentRevision !== revisie) {
    throw new SysteemTypeFout('stale-revision',
      `stale document revision: expected ${opt.expectedDocumentRevision}, the current revision is ${revisie}`,
      { field: 'expectedDocumentRevision', currentRevision: revisie });
  }
  const typeRevisie = typeDef ? (Number.isInteger(typeDef.revisie) && typeDef.revisie >= 1 ? typeDef.revisie : 1) : null;
  if (opt.expectedTypeRevision !== undefined && opt.expectedTypeRevision !== typeRevisie) {
    throw new SysteemTypeFout('stale-revision',
      `stale type revision: expected ${opt.expectedTypeRevision}, the current revision is ${typeRevisie}`,
      { field: 'expectedTypeRevision', currentRevision: typeRevisie });
  }

  const k = effectieveSchaal(pxPerMm);
  const geom = buildSysteemraster(ann, { pxPerMm: k, typeDef });
  if (!geom) return null;
  const box = geom.rasterAabb;
  // Rasterruimte (app-px) → systeemstelsel (mm); wereld eerst naar rasterruimte.
  const mm = (q) => ({ x: r3((q.x - box.x) / k), y: r3((q.y - box.y) / k) });
  const uitWereld = (p) => mm(rotToRaster(geom.rot, p));
  const mmX = (x) => r3((x - box.x) / k);
  const mmY = (y) => r3((y - box.y) / k);
  const segmenten = (segs, naar) => segs.map(s => ({ from: naar(s.a), to: naar(s.b) }));
  const bevestigd = geom.onbevestigd.length === 0;

  const contour = geom.contour.map(uitWereld);
  const panels = geom.panels.map((p) => {
    const omtrek = p.rand
      ? knipOpRechthoek(geom.contourR, p.x, p.y, p.x + p.w, p.y + p.h)
      : [{ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y }, { x: p.x + p.w, y: p.y + p.h }, { x: p.x, y: p.y + p.h }];
    return {
      ix: p.ix,
      iy: p.iy,
      panelType: p.type,
      renderStyle: p.stijl,
      component: p.component
        ? { symbolId: p.component.symbolId, ...(p.component.naam ? { naam: p.component.naam } : {}) }
        : null,
      edge: p.rand === true,
      x: mmX(p.x),
      y: mmY(p.y),
      width: r3(p.w / k),
      height: r3(p.h / k),
      outline: zonderDubbelen(omtrek.map(mm)),
    };
  });
  const components = panels.filter(p => p.component).map(p => ({
    ix: p.ix, iy: p.iy, ...p.component, center: { x: r3(p.x + p.width / 2), y: r3(p.y + p.height / 2) },
  }));

  const bewaard = bewaardeSparingen(ann);
  const openingId = (sparingId) => {
    const i = geom.sparingen.findIndex(s => s.id === sparingId);
    return i >= 0 ? bewaard[i]?.id ?? null : null;
  };
  const { onbevestigd, problemen } = bevestiging(ann, typeDef, geom, pxPerMm);
  const params = geom.params;

  return JSON.parse(JSON.stringify({
    schema: GEOMETRIE_SCHEMA,
    annotationId: typeof ann.id === 'string' ? ann.id : null,
    document: { id: documentId ?? null, revision: revisie },
    page: ann.page ?? null,
    type: typeDef ? { id: typeDef.id, revision: typeRevisie } : null,
    units: 'mm',
    coordinateSpace: 'system',
    placement: {
      page: ann.page ?? null,
      origin: (() => {
        const o = rotToWorld(geom.rot, { x: box.x, y: box.y });
        return { x: r3(o.x), y: r3(o.y) };
      })(),
      angleDeg: geom.rot ? geom.rot.deg : 0,
      pagePointsPerMm: k,
      scaleKnown: schaalBekend(pxPerMm),
    },
    confirmed: onbevestigd.length === 0 && problemen.length === 0,
    unconfirmed: onbevestigd,
    problems: problemen,
    layout: geom.layout,
    bounds: { width: r3(box.width / k), height: r3(box.height / k) },
    // Uit de onafgeronde contour: het afronden van de punten zou optellen.
    areaMm2: r3(oppervlak(geom.contourR) / (k * k)),
    contour,
    grid: {
      origin: mm(geom.origin),
      cellWidth: bevestigd ? r3(geom.cellW / k) : (params.plaatBreedteMm ?? null),
      cellHeight: bevestigd ? r3(geom.cellH / k) : (params.plaatHoogteMm ?? null),
    },
    lines: {
      vertical: geom.linesV.map(l => ({ x: mmX(l.x), segments: segmenten(l.segs, mmY) })),
      horizontal: geom.linesH.map(l => ({ y: mmY(l.y), segments: segmenten(l.segs, mmX) })),
    },
    panels,
    components,
    strips: geom.stroken.map(s => ({
      index: s.index, x0: mmX(s.x0), x1: mmX(s.x1), width: r3(s.breedteMm), length: r3(s.lengteMm), fit: s.pas === true,
    })),
    fitLines: geom.pasLijnen.map(l => ({ x: mmX(l.x), segments: segmenten(l.segs, mmY) })),
    openings: geom.sparingen.map((s, i) => ({
      id: bewaard[i]?.id ?? null,
      x: r3(s.xMm), y: r3(s.yMm), width: r3(s.bMm), height: r3(s.hMm), regime: s.regime,
    })),
    trimmers: geom.raveels.map(t => ({ openingId: openingId(t.sparingId), y: mmY(t.y), x1: mmX(t.x1), x2: mmX(t.x2) })),
    edges: geom.edgeSegs.map(s => ({
      segment: s.seg,
      profile: s.profiel,
      length: r3(s.lengthMm),
      points: s.pts.map(uitWereld),
      insetPoints: s.insetPts ? s.insetPts.map(uitWereld) : null,
    })),
    // Randstukken per zijde (mm; 0 = volle plaat op de rand) — alleen met een
    // indeling: zonder bevestigde celmaat is er geen randstuk.
    edgePieces: bevestigd
      ? {
        left: r3(geom.randMm.links), right: r3(geom.randMm.rechts),
        top: r3(geom.randMm.boven), bottom: r3(geom.randMm.onder),
      }
      : null,
  }));
}
