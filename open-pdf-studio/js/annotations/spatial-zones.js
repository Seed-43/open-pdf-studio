// Data-only location rules. Coordinates are unrotated page coordinates in points.

const EPSILON = 1e-7;
const MAX_ID = 100;

export function zoneDefinition(value) {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > MAX_ID
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return null;
  return {
    version: 1,
    id: value.id,
    name: value.name.trim(),
    parentId: typeof value.parentId === 'string' ? value.parentId.slice(0, MAX_ID) : '',
  };
}

export function zonePolygon(ann) {
  if (['polygon', 'measureArea', 'filledArea'].includes(ann?.type) && Array.isArray(ann.points)
      && !ann.arcFlags?.some(Boolean) && !ann.holes?.length) {
    const valid = ann.points.length >= 3 && ann.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return valid ? ann.points : null;
  }
  if (ann?.type !== 'box' || ann.rotation) return null;
  const { x, y, width: w, height: h } = ann;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

function area(points) {
  const twice = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  return Math.abs(twice) / 2;
}

export function containsPoint(points, p) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    const onEdge = Math.abs(cross) < EPSILON
      && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
      && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
    if (onEdge) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const INVALID = { valid: false, path: '', depth: 0 };

export function collectZones(annotations) {
  const candidates = (annotations || [])
    .map((ann) => ({ ann, zone: zoneDefinition(ann.spatialZone), polygon: zonePolygon(ann) }))
    .filter((z) => z.zone && z.polygon && area(z.polygon) > 0);
  const byId = new Map();
  const duplicates = new Set();
  for (const z of candidates) {
    if (byId.has(z.zone.id)) duplicates.add(z.zone.id);
    byId.set(z.zone.id, z);
  }
  return candidates.map((z) => {
    const chain = [];
    const seen = new Set();
    let cur = z;
    while (cur) {
      if (seen.has(cur.zone.id) || duplicates.has(cur.zone.id)) return { ...z, ...INVALID };
      seen.add(cur.zone.id);
      chain.unshift(cur.zone.name);
      if (cur.zone.parentId && !byId.has(cur.zone.parentId)) return { ...z, ...INVALID };
      cur = byId.get(cur.zone.parentId);
    }
    return { ...z, valid: true, path: chain.join(' / '), depth: chain.length, area: area(z.polygon) };
  });
}

export function locationFor(ann, zones, bounds) {
  if (typeof ann.locationOverride === 'string') return { path: ann.locationOverride, source: 'manual', zoneId: null };
  if (!bounds) return { path: '', source: 'none', zoneId: null };
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const hits = zones
    .filter((z) => z.valid
      && z.ann !== ann && (!ann.id || z.ann.id !== ann.id)
      && z.ann.page === ann.page
      && containsPoint(z.polygon, center))
    .sort((a, b) => b.depth - a.depth
      || a.area - b.area
      || (a.zone.id < b.zone.id ? -1 : a.zone.id > b.zone.id ? 1 : 0));
  const hit = hits[0];
  return { path: hit?.path || '', source: hit ? 'computed' : 'none', zoneId: hit?.zone.id || null };
}

// A pasted subtree has its own identities; parents outside the selection detach.
export function relinkCopiedZones(sources, copies) {
  const ids = new Map();
  for (let i = 0; i < sources.length; i++) {
    const z = zoneDefinition(sources[i].spatialZone);
    if (z && copies[i]) ids.set(z.id, `zone_${copies[i].id}`);
  }
  for (let i = 0; i < sources.length; i++) {
    const z = zoneDefinition(sources[i].spatialZone);
    if (z && copies[i]) copies[i].spatialZone = { ...z, id: ids.get(z.id), parentId: ids.get(z.parentId) || '' };
  }
  return copies;
}

/**
 * Zones that arrive with copied pages (merge, insert, paste/duplicate): a
 * zone whose id is already in `taken` gets a fresh id. Returns the renamed
 * ids (old -> new); `taken` then holds every id of these zones. Children in
 * the same copy follow their renamed parent (see relinkedZone); a parent
 * outside the copy keeps its link.
 * @param {Array<object|null>} zones  zone definitions of one copy
 * @param {Set<string>} taken  zone ids in use, updated in place
 * @returns {Map<string, string>}
 */
export function relinkZoneIds(zones, taken) {
  const renamed = new Map();
  const own = new Set();
  const incoming = new Set(zones.filter(Boolean).map((zone) => zone.id));
  for (const zone of zones) {
    if (!zone || renamed.has(zone.id) || own.has(zone.id)) continue;
    if (!taken.has(zone.id)) {
      own.add(zone.id);
      continue;
    }
    const base = zone.id.slice(0, MAX_ID - 8);
    let n = 2;
    let id = `${base}_${n}`;
    while (taken.has(id) || own.has(id) || incoming.has(id)) id = `${base}_${++n}`;
    renamed.set(zone.id, id);
    own.add(id);
  }
  for (const id of own) taken.add(id);
  return renamed;
}

/** A zone with the ids from relinkZoneIds applied. */
export function relinkedZone(zone, renamed) {
  return {
    ...zone,
    id: renamed.get(zone.id) || zone.id,
    parentId: renamed.get(zone.parentId) || zone.parentId,
  };
}
