// Test helper: writes small U3D files and 3D PDFs from scratch, so the
// decoder tests need no third-party sample. The writer follows ECMA-363
// (block layout, bit order, the arithmetic coder with static and dynamic
// contexts) independently of u3d-reader.js; its dynamic histogram is a plain
// array, which also cross-checks the reader's Fenwick tree.
import { PDFDocument, PDFName, PDFString, PDFHexString, rgb } from 'pdf-lib';

const STATIC_FULL = 0x400;
const MAX_RANGE = STATIC_FULL + 0x3fff;
const ELEPHANT = 0x1fff;

const SWAP8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 1 << (7 - b);
  SWAP8[i] = r;
}

class NaiveHistogram {
  constructor() { this.c = [1]; this.total = 1; }
  range(sym) {
    let lo = 0;
    for (let s = 0; s < sym; s++) lo += this.c[s] || 0;
    return [lo, lo + (this.c[sym] || 0)];
  }
  add(sym) {
    if (sym > 0xffff) return;
    if (this.total >= ELEPHANT) {
      let t = 0;
      for (let i = 0; i < this.c.length; i++) { this.c[i] >>= 1; t += this.c[i]; }
      this.c[0] += 1;
      this.total = t + 1;
    }
    while (this.c.length <= sym) this.c.push(0);
    this.c[sym] += 1;
    this.total += 1;
  }
}

/** Bit writer for one block: plain values until the first compressed one. */
export class BitWriter {
  constructor() {
    this.bits = [];
    this.ac = false;
    this.hist = new Map();
  }

  bit(b) { this.bits.push(b & 1); }

  startAc() {
    this.ac = true;
    this.low = 0;
    this.high = 0xffff;
    this.pending = 0;
  }

  out(b) {
    this.bit(b);
    for (; this.pending > 0; this.pending--) this.bit(1 - b);
  }

  encode(lo, hi, total) {
    const rng = this.high - this.low + 1;
    this.high = this.low + Math.floor((rng * hi) / total) - 1;
    this.low = this.low + Math.floor((rng * lo) / total);
    for (;;) {
      if (this.high < 0x8000) {
        this.out(0);
      } else if (this.low >= 0x8000) {
        this.out(1);
        this.low -= 0x8000; this.high -= 0x8000;
      } else if (this.low >= 0x4000 && this.high < 0xc000) {
        this.pending++;
        this.low -= 0x4000; this.high -= 0x4000;
      } else {
        break;
      }
      this.low <<= 1;
      this.high = (this.high << 1) | 1;
    }
  }

  u8(v) {
    if (!this.ac) { for (let k = 0; k < 8; k++) this.bit(v >> k); return; }
    const s = SWAP8[v & 0xff];
    this.encode(s, s + 1, 256);
  }
  u16(v) { this.u8(v & 0xff); this.u8((v >> 8) & 0xff); }
  u32(v) { this.u16(v & 0xffff); this.u16(Math.floor(v / 0x10000) & 0xffff); }
  u64(v) { this.u32(v % 0x100000000); this.u32(Math.floor(v / 0x100000000)); }
  f32(v) { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v, true); this.u32(dv.getUint32(0, true)); }
  f64(v) { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, v, true); this.u32(dv.getUint32(0, true)); this.u32(dv.getUint32(4, true)); }
  string(s) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    for (const x of b) this.u8(x);
  }

  cu32(ctx, v) {
    if (!(ctx && ctx < MAX_RANGE)) { this.u32(v); return; }
    if (!this.ac) this.startAc();
    if (ctx > STATIC_FULL) {
      const n = ctx - STATIC_FULL;
      if (!(v >= 0 && v < n)) throw new Error(`value ${v} outside static range ${n}`);
      this.encode(v, v + 1, n);
      return;
    }
    let h = this.hist.get(ctx);
    if (!h) { h = new NaiveHistogram(); this.hist.set(ctx, h); }
    const sym = v + 1;
    if (sym <= 0xffff && (h.c[sym] || 0) > 0) {
      const [lo, hi] = h.range(sym);
      this.encode(lo, hi, h.total);
      h.add(sym);
    } else {
      const [lo, hi] = h.range(0);
      this.encode(lo, hi, h.total);
      h.add(0);
      this.u32(v);
      h.add(sym);
    }
  }

  /** The block's data bytes (the arithmetic coder flushed, padded to a byte). */
  bytes() {
    if (this.ac) {
      this.pending++;
      this.out(this.low < 0x4000 ? 0 : 1);
      this.ac = false;
    }
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
    return out;
  }
}

/** One block: type, data size, meta size, data, padding to 4 bytes. */
export function block(type, data) {
  const pad = (4 - (data.length % 4)) % 4;
  const out = new Uint8Array(12 + data.length + pad);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, type >>> 0, true);
  dv.setUint32(4, data.length, true);
  dv.setUint32(8, 0, true);
  out.set(data, 12);
  return out;
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function chain(name, chainType, inner) {
  const w = new BitWriter();
  w.string(name);
  w.u32(chainType);
  w.u32(0); // no bounds
  let head = w.bytes();
  const pad = (4 - (head.length % 4)) % 4;
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, inner.length, true);
  return block(0xffffff14, concat([head, new Uint8Array(pad), count, ...inner]));
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

function parents(w, list) {
  w.u32(list.length);
  for (const p of list) {
    w.string(p.name);
    for (const v of p.matrix || IDENTITY) w.f32(v);
  }
}

/**
 * A U3D file with a group "Building", a box mesh resource "BoxMesh" in two
 * shading groups (red and blue faces), model "Box" under Building and model
 * "Box2" that uses the same mesh and has two parents (Building and Annex),
 * so three box instances in all.
 * @param {{extraPositions?: number}} [opts] extraPositions adds unused
 *   positions to the mesh (enough of them switch the face indices from the
 *   static context to plain U32 values).
 */
export function buildBoxU3D(opts = {}) {
  const extra = opts.extraPositions || 0;
  const header = (() => {
    const w = new BitWriter();
    w.u32(0); // version
    w.u32(0); // profile
    w.u32(0); // declaration size (not checked by the reader)
    w.u64(0); // file size
    w.u32(106); // UTF-8
    return block(0x00443355, w.bytes());
  })();

  const groupNode = (() => {
    const w = new BitWriter();
    w.string('Building');
    parents(w, [{ name: '', matrix: IDENTITY }]);
    return block(0xffffff21, w.bytes());
  })();
  const annexNode = (() => {
    const w = new BitWriter();
    w.string('Annex');
    parents(w, [{ name: '', matrix: translate(0, 0, 5) }]);
    return block(0xffffff21, w.bytes());
  })();
  const model = (name, list) => {
    const w = new BitWriter();
    w.string(name);
    parents(w, list);
    w.string('BoxMesh');
    w.u32(3); // visible front and back
    return block(0xffffff22, w.bytes());
  };
  const shading = (name) => {
    const w = new BitWriter();
    w.string(name);
    w.u32(0); // chain index
    w.u32(0); // attributes
    w.u32(2); // shader lists
    w.u32(1); w.string('RedShader');
    w.u32(1); w.string('BlueShader');
    return block(0xffffff45, w.bytes());
  };

  const decl = (() => {
    const w = new BitWriter();
    w.string('BoxMesh');
    w.u32(0); // chain index
    w.u32(1); // attributes: no normals
    w.u32(12); w.u32(8 + extra); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
    w.u32(2); // shading groups
    for (let g = 0; g < 2; g++) { w.u32(0); w.u32(0); w.u32(g); }
    return block(0xffffff31, w.bytes());
  })();

  const shader = (name, material) => {
    const w = new BitWriter();
    w.string(name);
    w.u32(0); w.f32(0); w.u32(0); w.u32(0); w.u32(1); w.u32(0); w.u32(0);
    w.string(material);
    return block(0xffffff53, w.bytes());
  };
  const material = (name, rgb) => {
    const w = new BitWriter();
    w.string(name);
    w.u32(0x3f);
    for (const v of [0.1, 0.1, 0.1, ...rgb, 0, 0, 0, 0, 0, 0]) w.f32(v);
    w.f32(0); // reflectivity
    w.f32(1); // opacity
    return block(0xffffff54, w.bytes());
  };

  const P = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const baseMesh = (() => {
    const w = new BitWriter();
    w.string('BoxMesh');
    w.u32(0); // chain index
    w.u32(F.length); w.u32(P.length + extra); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
    for (const p of P) for (const v of p) w.f32(v);
    for (let k = 0; k < extra; k++) { w.f32(k); w.f32(0); w.f32(0); }
    F.forEach((f, i) => {
      w.cu32(1, i < 4 ? 0 : 1); // first four faces red, the rest blue
      for (const idx of f) w.cu32(STATIC_FULL + P.length + extra, idx);
    });
    return block(0xffffff3b, w.bytes());
  })();

  return concat([
    header,
    chain('Building', 0, [groupNode]),
    chain('Annex', 0, [annexNode]),
    chain('Box', 0, [model('Box', [{ name: 'Building', matrix: IDENTITY }]), shading('Box')]),
    chain('Box2', 0, [model('Box2', [{ name: 'Building', matrix: translate(3, 0, 0) }, { name: 'Annex', matrix: translate(0, 3, 0) }]), shading('Box2')]),
    chain('BoxMesh', 1, [decl]),
    shader('RedShader', 'Red'),
    shader('BlueShader', 'Blue'),
    material('Red', [1, 0, 0]),
    material('Blue', [0, 0, 1]),
    baseMesh,
  ]);
}

/**
 * A one-page PDF (A4 landscape) with a 3D annotation holding `model`
 * (FlateDecode), preset views and an optional /3DV entry.
 * @param {{model?: Uint8Array, subtype?: string, views?: object[], dv?: any,
 *          annot3DV?: any, rect?: number[], useRef?: boolean, title?: string}} opts
 *   views: [{ name, c2w, co, ortho, fov, ps }]
 */
export async function build3DPdf(opts = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const font = await pdf.embedFont('Helvetica');
  page.drawText(opts.title || 'Sheet A-101  3D model', { x: 40, y: 560, size: 12, font });
  page.drawRectangle({ x: 40, y: 40, width: 762, height: 500, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  const ctx = pdf.context;
  const views = (opts.views || []).map((v) => {
    const p = v.ortho
      ? ctx.obj({ Subtype: 'O', OS: 1 })
      : ctx.obj({ Subtype: 'P', FOV: v.fov ?? 30, ...(v.ps ? { PS: v.ps } : {}) });
    return ctx.register(ctx.obj({
      Type: '3DView',
      XN: PDFString.of(v.name),
      IN: PDFString.of(v.internalName || v.name),
      MS: 'M',
      C2W: v.c2w,
      CO: v.co ?? 0,
      P: p,
    }));
  });
  const streamDict = {
    Type: '3D',
    Subtype: opts.subtype || 'U3D',
    VA: views,
  };
  if (opts.dv !== undefined) streamDict.DV = opts.dv;
  const stream = ctx.flateStream(opts.model || new Uint8Array(0), streamDict);
  const streamRef = ctx.register(stream);
  const dd = opts.useRef ? ctx.register(ctx.obj({ Type: '3DRef', '3DD': streamRef })) : streamRef;
  const annot = {
    Type: 'Annot',
    Subtype: '3D',
    Rect: opts.rect || [40, 40, 802, 540],
    '3DD': dd,
  };
  if (opts.annot3DV !== undefined) annot['3DV'] = opts.annot3DV;
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj(annot))]));
  return pdf;
}

export { PDFHexString };
