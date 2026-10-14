// U3D (ECMA-363) reader for the 3D models inside 3D PDFs.
//
// Decodes the blocks a typical CAD export writes: file header, modifier
// chains, group and model nodes, shading modifiers, lit texture shaders,
// materials, CLOD mesh declarations and base mesh continuation blocks.
// Progressive mesh blocks, textures, lights, view nodes and animation are
// skipped (a mesh without base data simply stays empty).
//
// The bit stream (ECMA-363 section 10): bits fill each byte from the low
// end; values are plain little-endian until the first compressed value in a
// block, after which everything, U8s included, goes through a Witten, Neal
// and Cleary style arithmetic decoder with 16-bit low/high.

const STATIC_FULL = 0x400;
const MAX_RANGE = STATIC_FULL + 0x3fff;
const ELEPHANT = 0x1fff;

const SWAP8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 1 << (7 - b);
  SWAP8[i] = r;
}

const f32View = new DataView(new ArrayBuffer(8));

class BitReader {
  constructor(bytes, bytePos = 0) {
    this.d = bytes;
    this.bit = bytePos * 8;
    this.ac = false;
    this.hist = new Map(); // context -> number[] (dynamic histogram)
  }

  rbit() {
    const i = this.bit++;
    const byte = i >>> 3;
    return byte < this.d.length ? (this.d[byte] >>> (i & 7)) & 1 : 0;
  }

  startAc() {
    this.ac = true;
    this.low = 0;
    this.high = 0xffff;
    this.code = 0;
    for (let k = 0; k < 16; k++) this.code = (this.code << 1) | this.rbit();
  }

  // Decode one symbol. `lookup(target)` returns [symbol, cumLow, cumHigh].
  decode(total, lookup) {
    const rng = this.high - this.low + 1;
    const target = Math.floor(((this.code - this.low + 1) * total - 1) / rng);
    const [sym, lo, hi] = lookup(target);
    this.high = this.low + Math.floor((rng * hi) / total) - 1;
    this.low = this.low + Math.floor((rng * lo) / total);
    for (;;) {
      if (this.high < 0x8000) {
        // nothing to subtract
      } else if (this.low >= 0x8000) {
        this.low -= 0x8000; this.high -= 0x8000; this.code -= 0x8000;
      } else if (this.low >= 0x4000 && this.high < 0xc000) {
        this.low -= 0x4000; this.high -= 0x4000; this.code -= 0x4000;
      } else {
        break;
      }
      this.low <<= 1;
      this.high = (this.high << 1) | 1;
      this.code = (this.code << 1) | this.rbit();
    }
    return sym;
  }

  decodeStatic(n) {
    return this.decode(n, (c) => [c, c, c + 1]);
  }

  // -- plain values ---------------------------------------------------------

  u8() {
    if (!this.ac) {
      let v = 0;
      for (let k = 0; k < 8; k++) v |= this.rbit() << k;
      return v;
    }
    return SWAP8[this.decodeStatic(256)];
  }

  u16() { return this.u8() | (this.u8() << 8); }

  u32() { return (this.u16() + this.u16() * 0x10000) >>> 0; }

  u64() { return this.u32() + this.u32() * 0x100000000; }

  f32() {
    f32View.setUint32(0, this.u32(), true);
    return f32View.getFloat32(0, true);
  }

  f64() {
    f32View.setUint32(0, this.u32(), true);
    f32View.setUint32(4, this.u32(), true);
    return f32View.getFloat64(0, true);
  }

  string() {
    const n = this.u16();
    const bytes = new Uint8Array(n);
    for (let k = 0; k < n; k++) bytes[k] = this.u8();
    return new TextDecoder('utf-8').decode(bytes);
  }

  // -- compressed values ----------------------------------------------------

  /** ReadCompressedU32: static, dynamic or plain depending on the context. */
  cu32(ctx) {
    if (!(ctx && ctx < MAX_RANGE)) return this.u32();
    if (!this.ac) this.startAc();
    if (ctx > STATIC_FULL) return this.decodeStatic(ctx - STATIC_FULL);
    let h = this.hist.get(ctx);
    if (!h) { h = [1]; h.total = 1; this.hist.set(ctx, h); }
    const sym = this.decode(h.total, (c) => {
      let acc = 0;
      for (let s = 0; s < h.length; s++) {
        const cnt = h[s];
        if (c < acc + cnt) return [s, acc, acc + cnt];
        acc += cnt;
      }
      throw new Error('U3D: bad cumulative frequency');
    });
    histAdd(h, sym);
    if (sym === 0) { // escape: the value follows as a U32
      const v = this.u32();
      histAdd(h, v + 1);
      return v;
    }
    return sym - 1;
  }

  /** Byte offset of the next whole byte. */
  bytePos() { return (this.bit + 7) >>> 3; }
}

/** Dynamic context update, as the reference IFXHistogramDynamic. */
function histAdd(h, sym) {
  if (sym > 0xffff) return;
  if (h.total >= ELEPHANT) {
    let t = 0;
    for (let i = 0; i < h.length; i++) { h[i] >>= 1; t += h[i]; }
    h[0] += 1;
    h.total = t + 1;
  }
  while (h.length <= sym) h.push(0);
  h[sym] += 1;
  h.total += 1;
}

// -- blocks -----------------------------------------------------------------

function* blocks(bytes, pos = 0, end = bytes.length) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 12 <= end) {
    const type = dv.getUint32(pos, true);
    const ds = dv.getUint32(pos + 4, true);
    const ms = dv.getUint32(pos + 8, true);
    yield [type, bytes.subarray(pos + 12, pos + 12 + ds)];
    pos += 12 + ds + ((4 - (ds % 4)) % 4) + ms + ((4 - (ms % 4)) % 4);
  }
}

function readParents(r) {
  const out = [];
  const n = r.u32();
  for (let k = 0; k < n; k++) {
    const name = r.string();
    const m = new Array(16);
    for (let i = 0; i < 16; i++) m[i] = r.f32();
    out.push({ name, matrix: m });
  }
  return out;
}

function readInner(scene, type, body) {
  const r = new BitReader(body);
  const name = r.string();
  if (type === 0xffffff21) {
    scene.groups.set(name, { parents: readParents(r) });
  } else if (type === 0xffffff22) {
    const parents = readParents(r);
    const prev = scene.models.get(name) || { shaders: [] };
    scene.models.set(name, { ...prev, parents, resource: r.string(), visibility: r.u32() });
  } else if (type === 0xffffff45) {
    r.u32(); // chain index
    r.u32(); // attributes
    const lists = [];
    const n = r.u32();
    for (let k = 0; k < n; k++) {
      const m = r.u32();
      const l = [];
      for (let j = 0; j < m; j++) l.push(r.string());
      lists.push(l);
    }
    const prev = scene.models.get(name) || { parents: [] };
    scene.models.set(name, { ...prev, shaders: lists });
  } else if (type === 0xffffff31) {
    r.u32(); // chain index
    const attrs = r.u32();
    const counts = [];
    for (let k = 0; k < 6; k++) counts.push(r.u32());
    const groups = [];
    const ng = r.u32();
    for (let k = 0; k < ng; k++) {
      const gattr = r.u32();
      const layers = r.u32();
      const dims = [];
      for (let j = 0; j < layers; j++) dims.push(r.u32());
      groups.push({ attrs: gattr, texDims: dims, orig: r.u32() });
    }
    const prev = scene.meshes.get(name) || {};
    scene.meshes.set(name, { ...prev, noNormals: !!(attrs & 1), groups });
  }
}

/**
 * Decode a U3D file. Returns
 * { header, groups: Map, models: Map, shaders: Map(name -> material),
 *   materials: Map, meshes: Map(resource -> { positions: Float32Array,
 *   indices: Uint32Array, faceGroups: Uint32Array, groups }) }.
 */
export function readU3D(bytes, onProgress) {
  const scene = {
    header: {}, groups: new Map(), models: new Map(), shaders: new Map(),
    materials: new Map(), meshes: new Map(),
  };
  const total = bytes.length;
  for (const [type, body] of blocks(bytes)) {
    if (type === 0x00443355) {
      const r = new BitReader(body);
      const version = r.u32();
      const profile = r.u32();
      const declSize = r.u32();
      const fileSize = r.u64();
      const encoding = r.u32();
      const unitsM = profile & 8 ? r.f64() : 1.0;
      scene.header = { version, profile, declSize, fileSize, encoding, unitsM };
    } else if (type === 0xffffff14) {
      const r = new BitReader(body);
      r.string();
      r.u32(); // chain type: 0 node, 1 resource
      const attrs = r.u32();
      if (attrs & 1) for (let k = 0; k < 4; k++) r.f32(); // bounding sphere
      if (attrs & 2) for (let k = 0; k < 6; k++) r.f32(); // bounding box
      let p = r.bytePos();
      p += (4 - (p % 4)) % 4;
      const count = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(p, true);
      let i = 0;
      for (const [it, ib] of blocks(body, p + 4)) {
        if (i++ >= count) break;
        readInner(scene, it, ib);
      }
    } else if (type === 0xffffff53) {
      const r = new BitReader(body);
      const name = r.string();
      r.u32(); r.f32(); r.u32(); r.u32(); r.u32(); r.u32(); r.u32();
      scene.shaders.set(name, r.string());
    } else if (type === 0xffffff54) {
      const r = new BitReader(body);
      const name = r.string();
      const attrs = r.u32();
      const v = [];
      for (let k = 0; k < 12; k++) v.push(r.f32());
      scene.materials.set(name, {
        attrs, ambient: v.slice(0, 3), diffuse: v.slice(3, 6), specular: v.slice(6, 9),
        emissive: v.slice(9, 12), reflectivity: r.f32(), opacity: r.f32(),
      });
    } else if (type === 0xffffff3b) {
      readBaseMesh(scene, body);
      if (onProgress) onProgress((body.byteOffset + body.byteLength) / total);
    }
  }
  return scene;
}

function readBaseMesh(scene, body) {
  const r = new BitReader(body);
  const name = r.string();
  r.u32(); // chain index
  const nf = r.u32(), npos = r.u32(), nnorm = r.u32(), ndiff = r.u32(), nspec = r.u32(), ntex = r.u32();
  const positions = new Float32Array(npos * 3);
  for (let k = 0; k < positions.length; k++) positions[k] = r.f32();
  for (let k = 0; k < nnorm * 3; k++) r.f32(); // normals: rebuilt by the viewer
  for (let k = 0; k < (ndiff + nspec + ntex) * 4; k++) r.f32();
  const decl = scene.meshes.get(name) || { groups: [] };
  const groups = decl.groups || [];
  const indices = new Uint32Array(nf * 3);
  const faceGroups = new Uint32Array(nf);
  const posCtx = STATIC_FULL + npos;
  for (let f = 0; f < nf; f++) {
    const g = r.cu32(1);
    faceGroups[f] = g;
    const grp = groups[g] || { attrs: 0, texDims: [] };
    for (let k = 0; k < 3; k++) {
      indices[f * 3 + k] = r.cu32(posCtx);
      if (nnorm) r.cu32(STATIC_FULL + nnorm);
      if ((grp.attrs & 1) && ndiff) r.cu32(STATIC_FULL + ndiff);
      if ((grp.attrs & 2) && nspec) r.cu32(STATIC_FULL + nspec);
      for (let l = 0; l < grp.texDims.length; l++) r.cu32(STATIC_FULL + ntex);
    }
  }
  scene.meshes.set(name, { ...decl, positions, indices, faceGroups });
}
