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
//
// The input comes from the PDF and is untrusted. Every count is checked
// against the bits left in its block before anything is allocated, reading
// past the end of a block throws, the arithmetic decoder rejects states a
// valid stream cannot reach, and the total number of triangles is capped.
// A block that fails is skipped (counted in scene.skipped); a mesh whose
// faces break off keeps the faces read so far. The rest of the file loads.

const STATIC_FULL = 0x400;
const MAX_RANGE = STATIC_FULL + 0x3fff;
const ELEPHANT = 0x1fff;
const MAX_SYMBOL = 0xffff;

/** Bits the arithmetic decoder may legitimately read past a block's end. */
const OVERRUN_BITS = 64;
/** Triangles in one file, all meshes together (about 0.6 GB while decoding). */
export const MAX_TRIANGLES = 16_000_000;

const SWAP8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 1 << (7 - b);
  SWAP8[i] = r;
}

const f32View = new DataView(new ArrayBuffer(8));
const utf8 = new TextDecoder('utf-8');

export class U3DError extends Error {
  constructor(message) {
    super(`U3D: ${message}`);
    this.name = 'U3DError';
  }
}

/**
 * Dynamic context (the reference IFXHistogramDynamic): symbol counts with a
 * Fenwick tree over them, so finding a symbol by cumulative count and adding
 * one stay O(log n) even when a stream escapes to many distinct values. The
 * arrays grow with the highest symbol seen (at most 0x10000 entries).
 */
export class DynamicHistogram {
  constructor() {
    this.size = 16; // power of two
    this.counts = new Uint32Array(this.size);
    this.tree = new Uint32Array(this.size + 1);
    this.total = 0;
    this.top = 0; // highest symbol with a count
    this.addRaw(0, 1);
  }

  grow(sym) {
    let size = this.size;
    while (size <= sym) size *= 2;
    const counts = new Uint32Array(size);
    counts.set(this.counts);
    this.size = size;
    this.counts = counts;
    this.rebuild();
  }

  rebuild() {
    const n = this.size, tree = new Uint32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      tree[i] += this.counts[i - 1];
      const j = i + (i & -i);
      if (j <= n) tree[j] += tree[i];
    }
    this.tree = tree;
  }

  addRaw(sym, n) {
    if (sym >= this.size) this.grow(sym);
    this.counts[sym] += n;
    this.total += n;
    if (sym > this.top) this.top = sym;
    for (let i = sym + 1; i <= this.size; i += i & -i) this.tree[i] += n;
  }

  /** Symbol whose cumulative range holds `target`: [sym, low, high]. */
  find(target) {
    if (!(target >= 0 && target < this.total)) throw new U3DError('bad cumulative frequency');
    let pos = 0, rem = target;
    for (let step = this.size; step; step >>= 1) {
      const next = pos + step;
      if (next <= this.size && this.tree[next] <= rem) {
        pos = next;
        rem -= this.tree[next];
      }
    }
    // pos = the symbols whose whole range lies below target
    const low = target - rem;
    return [pos, low, low + this.counts[pos]];
  }

  add(sym) {
    if (sym > MAX_SYMBOL) return;
    if (this.total >= ELEPHANT) {
      let total = 0;
      for (let i = 0; i <= this.top; i++) total += (this.counts[i] >>= 1);
      this.counts[0] += 1;
      this.total = total + 1;
      this.rebuild();
    }
    this.addRaw(sym, 1);
  }
}

class BitReader {
  constructor(bytes, bytePos = 0) {
    this.d = bytes;
    this.bit = bytePos * 8;
    this.limit = bytes.length * 8 + OVERRUN_BITS;
    this.ac = false;
    this.hist = new Map(); // context -> DynamicHistogram
  }

  rbit() {
    const i = this.bit++;
    if (i >= this.limit) throw new U3DError('block ends early');
    const byte = i >>> 3;
    return byte < this.d.length ? (this.d[byte] >>> (i & 7)) & 1 : 0;
  }

  /** Bits left in the block. */
  left() { return Math.max(0, this.d.length * 8 - this.bit); }

  /**
   * A count read from the stream, checked against the bits that are left:
   * `n` items of at least `bitsEach` bits each must still fit in the block.
   */
  count(n, bitsEach) {
    if (n * bitsEach > this.left() + OVERRUN_BITS) throw new U3DError('count larger than the block');
    return n;
  }

  startAc() {
    this.ac = true;
    this.low = 0;
    this.high = 0xffff;
    this.code = 0;
    for (let k = 0; k < 16; k++) this.code = (this.code << 1) | this.rbit();
  }

  // Decode one symbol. `lookup(target)` returns [symbol, cumLow, cumHigh].
  // A target outside [0, total) or an empty interval only comes from damaged
  // data; letting either through could run the renormalisation loop forever.
  decode(total, lookup) {
    const rng = this.high - this.low + 1;
    const target = Math.floor(((this.code - this.low + 1) * total - 1) / rng);
    if (!(target >= 0 && target < total)) throw new U3DError('corrupt compressed data');
    const [sym, lo, hi] = lookup(target);
    this.high = this.low + Math.floor((rng * hi) / total) - 1;
    this.low = this.low + Math.floor((rng * lo) / total);
    if (this.high < this.low) throw new U3DError('corrupt compressed data');
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
    const n = this.count(this.u16(), 8);
    const bytes = new Uint8Array(n);
    for (let k = 0; k < n; k++) bytes[k] = this.u8();
    return utf8.decode(bytes);
  }

  // -- compressed values ----------------------------------------------------

  /** ReadCompressedU32: static, dynamic or plain depending on the context. */
  cu32(ctx) {
    if (!(ctx && ctx < MAX_RANGE)) return this.u32();
    if (!this.ac) this.startAc();
    if (ctx > STATIC_FULL) return this.decodeStatic(ctx - STATIC_FULL);
    let h = this.hist.get(ctx);
    if (!h) { h = new DynamicHistogram(); this.hist.set(ctx, h); }
    const sym = this.decode(h.total, (c) => h.find(c));
    h.add(sym);
    if (sym === 0) { // escape: the value follows as a U32
      const v = this.u32();
      h.add(v + 1);
      return v;
    }
    return sym - 1;
  }

  /** Byte offset of the next whole byte. */
  bytePos() { return (this.bit + 7) >>> 3; }
}

// -- blocks -----------------------------------------------------------------

function* blocks(bytes, pos = 0, end = bytes.length) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 12 <= end) {
    const type = dv.getUint32(pos, true);
    const ds = dv.getUint32(pos + 4, true);
    const ms = dv.getUint32(pos + 8, true);
    yield [type, bytes.subarray(pos + 12, Math.min(end, pos + 12 + ds))];
    pos += 12 + ds + ((4 - (ds % 4)) % 4) + ms + ((4 - (ms % 4)) % 4);
  }
}

function readParents(r) {
  const out = [];
  const n = r.count(r.u32(), 16 + 16 * 32);
  for (let k = 0; k < n; k++) {
    const name = r.string();
    const m = new Array(16);
    for (let i = 0; i < 16; i++) m[i] = r.f32();
    out.push({ name, matrix: m.every(Number.isFinite) ? m : null });
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
    const n = r.count(r.u32(), 32);
    for (let k = 0; k < n; k++) {
      const m = r.count(r.u32(), 16);
      const l = [];
      for (let j = 0; j < m; j++) l.push(r.string());
      lists.push(l);
    }
    const prev = scene.models.get(name) || { parents: [] };
    scene.models.set(name, { ...prev, shaders: lists });
  } else if (type === 0xffffff31) {
    r.u32(); // chain index
    const attrs = r.u32();
    for (let k = 0; k < 6; k++) r.u32(); // maximum counts
    const groups = [];
    const ng = r.count(r.u32(), 96);
    for (let k = 0; k < ng; k++) {
      const gattr = r.u32();
      const layers = r.count(r.u32(), 32);
      const dims = [];
      for (let j = 0; j < layers; j++) dims.push(r.u32());
      groups.push({ attrs: gattr, texDims: dims, orig: r.u32() });
    }
    const prev = scene.meshes.get(name) || {};
    scene.meshes.set(name, { ...prev, noNormals: !!(attrs & 1), groups });
  }
}

function readBlock(scene, type, body) {
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
    if (p + 4 > body.length) throw new U3DError('modifier chain ends early');
    const count = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(p, true);
    let i = 0;
    for (const [it, ib] of blocks(body, p + 4)) {
      if (i++ >= count) break;
      try {
        readInner(scene, it, ib);
      } catch (e) {
        if (!(e instanceof U3DError)) throw e;
        scene.skipped++;
      }
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
    const reflectivity = r.f32(), opacity = r.f32();
    const colour = (a) => (a.every(Number.isFinite) ? a : [0.7, 0.7, 0.7]);
    scene.materials.set(name, {
      attrs, ambient: colour(v.slice(0, 3)), diffuse: colour(v.slice(3, 6)), specular: colour(v.slice(6, 9)),
      emissive: colour(v.slice(9, 12)), reflectivity, opacity: Number.isFinite(opacity) ? opacity : 1,
    });
  } else if (type === 0xffffff3b) {
    readBaseMesh(scene, body);
  }
}

/**
 * Decode a U3D file. Returns
 * { header, groups: Map, models: Map, shaders: Map(name -> material),
 *   materials: Map, meshes: Map(resource -> { positions: Float32Array,
 *   indices: Uint32Array, faceGroups: Uint32Array, groups }),
 *   triangles, skipped }.
 * Throws a U3DError when the data is not a U3D file at all.
 */
export function readU3D(bytes, onProgress) {
  if (!(bytes instanceof Uint8Array)) throw new U3DError('no data');
  if (bytes.length < 12 || bytes[0] !== 0x55 || bytes[1] !== 0x33 || bytes[2] !== 0x44 || bytes[3] !== 0x00) {
    throw new U3DError('not a U3D file');
  }
  const scene = {
    header: {}, groups: new Map(), models: new Map(), shaders: new Map(),
    materials: new Map(), meshes: new Map(), triangles: 0, skipped: 0,
  };
  for (const [type, body] of blocks(bytes)) {
    try {
      readBlock(scene, type, body);
    } catch (e) {
      if (!(e instanceof U3DError)) throw e;
      scene.skipped++;
    }
    if (type === 0xffffff3b && onProgress) {
      onProgress((body.byteOffset - bytes.byteOffset + body.byteLength) / bytes.length);
    }
  }
  return scene;
}

function readBaseMesh(scene, body) {
  const r = new BitReader(body);
  const name = r.string();
  r.u32(); // chain index
  const nf = r.u32(), npos = r.u32(), nnorm = r.u32(), ndiff = r.u32(), nspec = r.u32(), ntex = r.u32();
  // Positions and normals are 3 F32 each, colours and texture coordinates 4,
  // all read before the first compressed value: 32 bits per number.
  r.count((npos + nnorm) * 3 + (ndiff + nspec + ntex) * 4, 32);
  const positions = new Float32Array(npos * 3);
  for (let k = 0; k < positions.length; k++) {
    const v = r.f32();
    positions[k] = Number.isFinite(v) ? v : 0;
  }
  for (let k = 0; k < nnorm * 3; k++) r.f32(); // normals: rebuilt by the viewer
  for (let k = 0; k < (ndiff + nspec + ntex) * 4; k++) r.f32();
  const decl = scene.meshes.get(name) || { groups: [] };
  const groups = decl.groups || [];
  // Fewer than three positions make no visible triangle; with one position
  // the indices would cost no bits at all, so the face count would not be
  // bounded by the data. With two or more positions every index costs at
  // least one bit, three per face.
  const nfaces = npos >= 3 ? r.count(nf, 3) : 0;
  if (scene.triangles + nfaces > MAX_TRIANGLES) throw new U3DError('model too large');
  let indices = new Uint32Array(nfaces * 3);
  let faceGroups = new Uint32Array(nfaces);
  const posCtx = STATIC_FULL + npos;
  let f = 0;
  try {
    for (; f < nfaces; f++) {
      const g = r.cu32(1);
      const grp = groups[g] || { attrs: 0, texDims: [] };
      for (let k = 0; k < 3; k++) {
        const idx = r.cu32(posCtx);
        if (idx >= npos) throw new U3DError('position index out of range');
        indices[f * 3 + k] = idx;
        if (nnorm) r.cu32(STATIC_FULL + nnorm);
        if ((grp.attrs & 1) && ndiff) r.cu32(STATIC_FULL + ndiff);
        if ((grp.attrs & 2) && nspec) r.cu32(STATIC_FULL + nspec);
        for (let l = 0; l < grp.texDims.length; l++) r.cu32(STATIC_FULL + ntex);
      }
      faceGroups[f] = g;
    }
  } catch (e) {
    if (!(e instanceof U3DError)) throw e;
    // Keep the faces that were read in full.
    scene.skipped++;
    indices = indices.slice(0, f * 3);
    faceGroups = faceGroups.slice(0, f);
  }
  scene.triangles += f;
  scene.meshes.set(name, { ...decl, positions, indices, faceGroups });
}
