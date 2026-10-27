// Decodes a U3D model off the main thread and returns draw-ready data (see
// u3d-scene.js). A FlateDecode stream arrives still compressed and is
// inflated here too, so a large model does not hold up the page while it
// unpacks. Typed arrays are transferred, not copied.
import { readU3D } from './u3d-reader.js';
import { buildDrawData } from './u3d-scene.js';

/** Largest model stream accepted after inflating. */
const MAX_INFLATED = 512 * 1024 * 1024;

async function inflate(raw) {
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_INFLATED) {
      reader.cancel().catch(() => {});
      throw new Error('U3D: model stream too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

self.onmessage = async (e) => {
  const { id, bytes, deflated } = e.data;
  try {
    const data = deflated ? await inflate(bytes) : bytes;
    let last = -1;
    const scene = readU3D(data, (p) => {
      const pct = Math.floor(p * 100);
      if (pct !== last) { last = pct; self.postMessage({ id, progress: p }); }
    });
    const { transfer, ...draw } = buildDrawData(scene);
    self.postMessage({ id, done: true, ...draw }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
