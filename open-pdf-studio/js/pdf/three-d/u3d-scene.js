// Turns a decoded U3D scene (u3d-reader.js) into draw-ready data: one entry
// per mesh resource with its positions and its triangle indices ordered by
// shading group, and one entry per model node instance that points at a
// resource and names a material per group. Several model nodes may share a
// resource, and a node with several parents is drawn once under each, so
// geometry is never duplicated. Kept free of worker and three.js code so
// the unit tests can run it in Node.

const GREY = { color: [0.7, 0.7, 0.7], opacity: 1 };

function materialFor(scene, shaderName) {
  const matName = scene.shaders.get(shaderName);
  const m = matName && scene.materials.get(matName);
  if (!m) return GREY;
  const d = m.diffuse.some(v => v > 0) ? m.diffuse : m.ambient;
  const opacity = m.opacity > 0 && m.opacity <= 1 ? m.opacity : 1;
  return { color: d.slice(0, 3).map(v => Math.min(1, Math.max(0, v))), opacity };
}

/** Faces of one resource ordered by shading group (a stable counting sort). */
export function orderByGroup(indices, faceGroups) {
  const nf = faceGroups.length;
  const keys = [...new Set(faceGroups)].sort((a, b) => a - b);
  const slot = new Map(keys.map((g, i) => [g, i]));
  const counts = new Uint32Array(keys.length);
  for (let f = 0; f < nf; f++) counts[slot.get(faceGroups[f])]++;
  const starts = new Uint32Array(keys.length);
  for (let i = 1; i < keys.length; i++) starts[i] = starts[i - 1] + counts[i - 1];
  const next = starts.slice();
  const out = new Uint32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const k = next[slot.get(faceGroups[f])]++ * 3;
    out[k] = indices[f * 3];
    out[k + 1] = indices[f * 3 + 1];
    out[k + 2] = indices[f * 3 + 2];
  }
  const ranges = keys.map((group, i) => ({ start: starts[i] * 3, count: counts[i] * 3, group }));
  return { indices: out, ranges };
}

/**
 * @returns {{ header, groups: {name, parent, matrix}[],
 *   resources: {positions: Float32Array, indices: Uint32Array, ranges: {start, count, group}[]}[],
 *   models: {name, parent, matrix, visible, resource: number, materials: object[]}[],
 *   triangles: number, skipped: number, transfer: ArrayBuffer[] }}
 */
export function buildDrawData(scene) {
  const resources = [];
  const resourceIndex = new Map();
  const models = [];
  const transfer = [];
  let triangles = 0;
  for (const [name, model] of scene.models) {
    const mesh = scene.meshes.get(model.resource);
    if (!mesh || !mesh.indices || !mesh.indices.length) continue;
    let ri = resourceIndex.get(model.resource);
    if (ri === undefined) {
      const { indices, ranges } = orderByGroup(mesh.indices, mesh.faceGroups);
      ri = resources.length;
      resources.push({ positions: mesh.positions, indices, ranges });
      resourceIndex.set(model.resource, ri);
      transfer.push(mesh.positions.buffer, indices.buffer);
    }
    const res = resources[ri];
    const shaders = model.shaders || [];
    const materials = res.ranges.map(r => materialFor(scene, shaders[r.group]?.[0] ?? shaders[0]?.[0]));
    const parents = model.parents?.length ? model.parents : [{ name: '', matrix: null }];
    for (const p of parents) {
      models.push({
        name,
        parent: p.name || '',
        matrix: p.matrix || null,
        visible: model.visibility !== 0,
        resource: ri,
        materials,
      });
      triangles += res.indices.length / 3;
    }
  }
  const parentOf = new Map([...scene.groups].map(([name, g]) => [name, g.parents?.[0]?.name || '']));
  // A parent chain that loops (damaged or hostile data) hangs off the root.
  const verdict = new Map(); // name -> true (loops) | false
  const loops = (name) => {
    const path = [];
    const onPath = new Set();
    let n = name, result = false;
    while (n && scene.groups.has(n) && !verdict.has(n)) {
      if (onPath.has(n)) { result = true; break; }
      onPath.add(n);
      path.push(n);
      n = parentOf.get(n);
    }
    if (!result && verdict.has(n)) result = verdict.get(n);
    for (const p of path) verdict.set(p, result);
    return result;
  };
  const groups = [...scene.groups].map(([name, g]) => ({
    name,
    parent: loops(name) ? '' : parentOf.get(name),
    matrix: g.parents?.[0]?.matrix || null,
  }));
  return { header: scene.header, groups, resources, models, triangles, skipped: scene.skipped || 0, transfer };
}
