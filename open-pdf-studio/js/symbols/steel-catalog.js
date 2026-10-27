// Catalog-driven parametric steel profiles.
//
// Converts a downloaded `steel-sections` catalog (parametric.json from the
// online symbol library, see the library repo's docs/data-format.md) into
// parametric symbol templates that behave EXACTLY like the built-in NL
// staalprofielen (templates/staalprofiel.js):
//   * doorsnede  — fixed real b×h (or d×d) via the measure scale, NOT
//                  graphically resizable (fixedSize + realSizeMm)
//   * boven/zij  — line-form beam views: height locked to the profile
//                  dimension, length free (freeAxis 'x')
//   * maat       — switchable from the properties panel (dynamic block)
//
// Pure module (no Solid/Tauri/app-state imports) so it is node-testable:
// see scripts/test-steel-catalog.mjs. Registration + persistence glue lives
// in steel-catalog-store.js.

import {
  arcPts, roundedRectPts, iSectionPts, uSectionPts, scalePts,
  labelCmd, hartlijnCmds, steelSnapPoints, schaalOf,
  STEEL_COMMON_PARAMS, beamViewCmds,
} from './templates/staalprofiel.js';

export const STEEL_TEMPLATE_PREFIX = 'steel-';
export const STEEL_SHAPES = ['i', 'u', 'box', 'pipe', 'angle', 'tee'];

// Column layout per shape (designation + real mm dimensions; r = drawing
// fillet only). Mirrors the library's parametric-steel schema.
const SHAPE_COLUMNS = {
  i: 6, u: 6, tee: 6,   // [designation, h, b, tw, tf, r]
  box: 4, angle: 4,     // [designation, h, b, t]
  pipe: 3,              // [designation, d, t]
};

export function steelTemplateId(collectionId, familyId) {
  return `${STEEL_TEMPLATE_PREFIX}${collectionId}-${familyId}`;
}

// --- Parse / validate -------------------------------------------------------
// Returns the normalized catalog or null when this is not a steel-sections
// catalog (unknown parametric formats are skipped by the caller). Throws on
// a steel-sections catalog with broken content.
export function parseSteelSectionCatalog(raw) {
  if (!raw || raw.format !== 'steel-sections') return null;
  if (raw.formatVersion !== 1 || raw.units !== 'mm') {
    throw new Error('steel-sections: onbekende formatVersion/units');
  }
  if (!raw.label || typeof raw.label.en !== 'string') {
    throw new Error('steel-sections: label.en ontbreekt');
  }
  if (!Array.isArray(raw.families) || !raw.families.length) {
    throw new Error('steel-sections: families ontbreken');
  }
  const families = raw.families.map((f, i) => {
    const where = `steel-sections families[${i}]`;
    if (!f || typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(f.id)) {
      throw new Error(`${where}: ongeldige id`);
    }
    if (!f.name || typeof f.name.en !== 'string') throw new Error(`${where}: name.en ontbreekt`);
    const cols = SHAPE_COLUMNS[f.shape];
    if (!cols) throw new Error(`${where}: onbekende vorm "${f.shape}"`);
    if (!Array.isArray(f.sizes) || !f.sizes.length) throw new Error(`${where}: sizes ontbreken`);
    const sizes = f.sizes.map((row, j) => {
      if (!Array.isArray(row) || row.length !== cols
        || typeof row[0] !== 'string' || !row[0].trim()
        || row.slice(1).some(n => typeof n !== 'number' || !(n > 0))) {
        throw new Error(`${where}.sizes[${j}]: ongeldige rij`);
      }
      return row.slice();
    });
    const defaultSize = sizes.some(r => r[0] === f.defaultSize) ? f.defaultSize : sizes[0][0];
    return { id: f.id, name: { ...f.name }, shape: f.shape, defaultSize, sizes };
  });
  return { label: { ...raw.label }, families };
}

// --- Extra section contours (shapes the NL set does not have) --------------
// Same conventions as staalprofiel.js: one closed polyline in local coords,
// (0,0) = top-left of the B×H section.

function _anglePts(B, H, t) {
  // L-angle: vertical leg on the left (height H), horizontal leg at the
  // bottom (width B), thickness t.
  return [
    { x: 0, y: 0 }, { x: t, y: 0 }, { x: t, y: H - t },
    { x: B, y: H - t }, { x: B, y: H }, { x: 0, y: H },
  ];
}

function _teePts(B, H, tw, tf) {
  // T-section: flange on top (B×tf), web centred below (tw×(H−tf)).
  const xl = B / 2 - tw / 2;
  const xr = B / 2 + tw / 2;
  return [
    { x: 0, y: 0 }, { x: B, y: 0 }, { x: B, y: tf },
    { x: xr, y: tf }, { x: xr, y: H }, { x: xl, y: H },
    { x: xl, y: tf }, { x: 0, y: tf },
  ];
}

function _circlePts(cx, cy, r) {
  return arcPts(cx, cy, r, 0, 2 * Math.PI, 32);
}

// --- Per-shape behaviour ----------------------------------------------------
// realDims: outer sizes for realSizeMm; sectionCmds: filled cross-section;
// innerLines(dim, row, view): hidden/visible longitudinal lines for the
// line-form beam views (offsets from the top edge in real mm).

const SHAPE_IMPL = {
  i: {
    dims: (r) => ({ h: r[1], b: r[2] }),
    section(row, x0, y0, s) {
      const [, H, B, tw, tf, r] = row;
      return [{ kind: 'rings', loops: [scalePts(iSectionPts(B, H, tw, tf, r), x0, y0, s)], fill: true }];
    },
    boven: (row) => [
      { offMm: row[2] / 2 - row[3] / 2, dashed: true },
      { offMm: row[2] / 2 + row[3] / 2, dashed: true },
    ],
    zij: (row) => [
      { offMm: row[4], dashed: false },
      { offMm: row[1] - row[4], dashed: false },
    ],
  },
  u: {
    dims: (r) => ({ h: r[1], b: r[2] }),
    section(row, x0, y0, s) {
      const [, H, B, tw, tf, r] = row;
      return [{ kind: 'rings', loops: [scalePts(uSectionPts(B, H, tw, tf, r), x0, y0, s)], fill: true }];
    },
    // Web against one edge → visible top face, solid line.
    boven: (row) => [{ offMm: row[3], dashed: false }],
    zij: (row) => [
      { offMm: row[4], dashed: false },
      { offMm: row[1] - row[4], dashed: false },
    ],
  },
  tee: {
    dims: (r) => ({ h: r[1], b: r[2] }),
    section(row, x0, y0, s) {
      const [, H, B, tw, tf] = row;
      return [{ kind: 'rings', loops: [scalePts(_teePts(B, H, tw, tf), x0, y0, s)], fill: true }];
    },
    // Web hidden under the top flange → dashed.
    boven: (row) => [
      { offMm: row[2] / 2 - row[3] / 2, dashed: true },
      { offMm: row[2] / 2 + row[3] / 2, dashed: true },
    ],
    // Flange face visible at tf from the top.
    zij: (row) => [{ offMm: row[4], dashed: false }],
  },
  box: {
    dims: (r) => ({ h: r[1], b: r[2] }),
    section(row, x0, y0, s) {
      const [, H, B, t] = row;
      const ro = 2 * t, ri = t; // cold-formed corner radii, as NL koker
      return [{
        kind: 'rings',
        loops: [
          scalePts(roundedRectPts(0, 0, B, H, ro), x0, y0, s),
          scalePts(roundedRectPts(t, t, B - 2 * t, H - 2 * t, ri), x0, y0, s),
        ],
        fill: true,
      }];
    },
    boven: (row) => [{ offMm: row[3], dashed: true }, { offMm: row[2] - row[3], dashed: true }],
    zij: (row) => [{ offMm: row[3], dashed: true }, { offMm: row[1] - row[3], dashed: true }],
  },
  angle: {
    dims: (r) => ({ h: r[1], b: r[2] }),
    section(row, x0, y0, s) {
      const [, H, B, t] = row;
      return [{ kind: 'rings', loops: [scalePts(_anglePts(B, H, t), x0, y0, s)], fill: true }];
    },
    // Top view: vertical leg edge visible at t; side view: horizontal leg
    // face visible at H−t.
    boven: (row) => [{ offMm: row[3], dashed: false }],
    zij: (row) => [{ offMm: row[1] - row[3], dashed: false }],
  },
  pipe: {
    dims: (r) => ({ h: r[1], b: r[1] }),
    section(row, x0, y0, s) {
      const [, D, t] = row;
      return [{
        kind: 'rings',
        loops: [
          scalePts(_circlePts(D / 2, D / 2, D / 2), x0, y0, s),
          scalePts(_circlePts(D / 2, D / 2, D / 2 - t), x0, y0, s),
        ],
        fill: true,
      }];
    },
    boven: (row) => [{ offMm: row[2], dashed: true }, { offMm: row[1] - row[2], dashed: true }],
    zij: (row) => [{ offMm: row[2], dashed: true }, { offMm: row[1] - row[2], dashed: true }],
  },
};

function _pickName(nameObj, lang) {
  if (!nameObj) return '';
  if (typeof nameObj === 'string') return nameObj;
  const short = String(lang || 'en').slice(0, 2).toLowerCase();
  return nameObj[short] || nameObj.en || Object.values(nameObj)[0] || '';
}

// --- Catalog → templates ----------------------------------------------------
// One parametric template per family, same param set and view behaviour as
// the NL staalprofiel templates.
export function steelCatalogTemplates(collectionId, catalog, lang = 'nl') {
  const category = _pickName(catalog.label, lang);
  return catalog.families.map((family) => {
    const impl = SHAPE_IMPL[family.shape];
    const byName = new Map(family.sizes.map(row => [row[0], row]));
    const defaultMaat = family.defaultSize;
    return {
      id: steelTemplateId(collectionId, family.id),
      name: _pickName(family.name, lang),
      nameEn: family.name.en,
      category,
      // Families uit dezelfde catalogus wisselen onderling van type (#697).
      profielGroep: `${STEEL_TEMPLATE_PREFIX}${collectionId}`,
      defaultSize: { width: 60, height: 60 },
      // No graphic resize handles — size comes from maat × schaal (real mm).
      fixedSize: true,
      params: [
        {
          key: 'maat', label: 'Maat', labelEn: 'Size', type: 'enum',
          options: family.sizes.map(r => r[0]),
          default: defaultMaat,
        },
        ...STEEL_COMMON_PARAMS,
      ],
      realSizeMm(params) {
        const row = byName.get(params?.maat) || byName.get(defaultMaat);
        if (!row) return null;
        const f = schaalOf(params);
        const { h, b } = impl.dims(row);
        const az = params?.aanzicht || 'doorsnede';
        if (az === 'boven') return { width: null, height: b * f };
        if (az === 'zij') return { width: null, height: h * f };
        return { width: b * f, height: h * f };
      },
      freeAxis(params) {
        return (params?.aanzicht || 'doorsnede') !== 'doorsnede' ? 'x' : null;
      },
      snapPoints: steelSnapPoints,
      render(params, bbox) {
        const row = byName.get(params?.maat) || byName.get(defaultMaat);
        if (!row) return [];
        const maat = row[0];
        const { h, b } = impl.dims(row);
        const az = params?.aanzicht || 'doorsnede';
        if (az === 'boven' || az === 'zij') {
          const dim = az === 'boven' ? b : h;
          const cmds = beamViewCmds(bbox, dim, impl[az](row), params?.hartlijn !== false);
          if (params?.toonLabel) cmds.push(labelCmd(maat, bbox));
          return cmds;
        }
        const s = Math.min(bbox.width / b, bbox.height / h);
        const x0 = bbox.x + (bbox.width - b * s) / 2;
        const y0 = bbox.y + (bbox.height - h * s) / 2;
        const cmds = impl.section(row, x0, y0, s);
        if (params?.hartlijn !== false) cmds.push(...hartlijnCmds(bbox));
        if (params?.toonLabel) cmds.push(labelCmd(maat, bbox));
        return cmds;
      },
    };
  });
}

// --- Palette previews -------------------------------------------------------
// 64×64 filled cross-section of the family's default size (real proportions),
// self-contained SVG that passes the app's isSafeSymbolSvg check.
export function steelFamilyPreviewSvg(family) {
  const impl = SHAPE_IMPL[family.shape];
  const row = family.sizes.find(r => r[0] === family.defaultSize) || family.sizes[0];
  const { h, b } = impl.dims(row);
  const M = 8; // margin
  const s = Math.min((64 - 2 * M) / b, (64 - 2 * M) / h);
  const x0 = (64 - b * s) / 2;
  const y0 = (64 - h * s) / 2;
  const cmds = impl.section(row, x0, y0, s);
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  let path = '';
  for (const cmd of cmds) {
    for (const loop of cmd.loops || []) {
      path += loop.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + 'Z';
    }
  }
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${path}" fill="#000" fill-rule="evenodd" stroke="none"/></svg>`;
}

// --- Catalog → palette group ------------------------------------------------
// Same group form as collectionToGroup (data/symbolLibraryOnline.js), but the
// entries carry `parametricId` so the palette places editable parametric
// symbols instead of static stamps. The store persists this group via the
// custom-groups mechanism and persists the catalog itself so the templates
// can be re-registered after a restart.
export function steelCatalogToGroup(collectionId, meta, catalog, lang) {
  const name = _pickName((meta && meta.name) || catalog.label, lang) || collectionId;
  return {
    id: `lib-${collectionId}`,
    name,
    online: true,
    collectionId,
    steelCatalog: true,
    version: (meta && meta.version) || null,
    symbols: catalog.families.map(f => ({
      id: `lib-${collectionId}-param-${f.id}`,
      name: _pickName(f.name, lang),
      parametricId: steelTemplateId(collectionId, f.id),
      svg: steelFamilyPreviewSvg(f),
    })),
  };
}
