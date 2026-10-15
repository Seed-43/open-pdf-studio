// Decodes a U3D model off the main thread and returns draw-ready meshes:
// one entry per model node with its positions, its triangle indices sorted
// by material, and the material ranges. Typed arrays are transferred, not
// copied, so even a 1.5M-triangle model comes back quickly.
import { readU3D } from './u3d-reader.js';

function materialFor(scene, shaderName) {
  const matName = scene.shaders.get(shaderName);
  const m = matName && scene.materials.get(matName);
  if (!m) return { color: [0.7, 0.7, 0.7], opacity: 1 };
  const d = m.diffuse.some(v => v > 0) ? m.diffuse : m.ambient;
  return { color: d.slice(0, 3), opacity: m.opacity > 0 ? m.opacity : 1 };
}

self.onmessage = (e) => {
  const { id, bytes } = e.data;
  try {
    const scene = readU3D(bytes, (p) => self.postMessage({ id, progress: p }));
    const models = [];
    const transfer = [];
    for (const [name, model] of scene.models) {
      const mesh = scene.meshes.get(model.resource);
      if (!mesh || !mesh.indices || !mesh.indices.length) continue;
      // Sort faces by shading group so each material is one draw range.
      const nf = mesh.faceGroups.length;
      const order = Array.from({ length: nf }, (_, i) => i).sort((a, b) => mesh.faceGroups[a] - mesh.faceGroups[b]);
      const indices = new Uint32Array(nf * 3);
      const ranges = [];
      let cur = -1;
      order.forEach((f, k) => {
        const g = mesh.faceGroups[f];
        if (g !== cur) {
          const shaderName = model.shaders?.[g]?.[0] ?? model.shaders?.[0]?.[0];
          ranges.push({ start: k * 3, count: 0, material: materialFor(scene, shaderName) });
          cur = g;
        }
        ranges[ranges.length - 1].count += 3;
        indices[k * 3] = mesh.indices[f * 3];
        indices[k * 3 + 1] = mesh.indices[f * 3 + 1];
        indices[k * 3 + 2] = mesh.indices[f * 3 + 2];
      });
      models.push({
        name,
        parent: model.parents?.[0]?.name || '',
        matrix: model.parents?.[0]?.matrix || null,
        visible: model.visibility !== 0,
        positions: mesh.positions,
        indices,
        ranges,
      });
      transfer.push(mesh.positions.buffer, indices.buffer);
    }
    const groups = [...scene.groups].map(([name, g]) => ({
      name,
      parent: g.parents?.[0]?.name || '',
      matrix: g.parents?.[0]?.matrix || null,
    }));
    self.postMessage({ id, done: true, header: scene.header, groups, models }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
