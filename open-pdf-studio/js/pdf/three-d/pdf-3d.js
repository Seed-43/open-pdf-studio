// Find 3D annotations (/Subtype /3D, ISO 32000-1 section 13.6) in a PDF and
// pull out their model stream and preset views. PDF.js does not render 3D
// artwork (it only draws the /AP poster), so the app reads these itself and
// shows them in its own WebGL viewer.
import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';

/** Page key of a 3D markup page (see snapshot-page.js). */
export const SNAPSHOT_KEY = 'OPS_3DSnapshot';

function lookup(ctx, obj) {
  return obj instanceof PDFRef ? ctx.lookup(obj) : obj;
}

function text(v) {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  if (v instanceof PDFName) return v.decodeText();
  return v == null ? '' : String(v);
}

function numbers(arr) {
  if (!(arr instanceof PDFArray)) return null;
  const out = arr.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : NaN));
  return out.every(Number.isFinite) ? out : null;
}

function num(ctx, v, fallback) {
  const n = lookup(ctx, v);
  return n instanceof PDFNumber && Number.isFinite(n.asNumber()) ? n.asNumber() : fallback;
}

/** The 3D stream of a /3DD entry: either the stream itself or a 3D reference
 *  dictionary (/Type /3DRef) pointing at it. */
function streamOf(ctx, dd) {
  let s = lookup(ctx, dd);
  if (s instanceof PDFDict && !(s instanceof PDFRawStream)) {
    const inner = s.get(PDFName.of('3DD'));
    if (inner) s = lookup(ctx, inner);
  }
  return s instanceof PDFRawStream ? s : null;
}

/**
 * One 3D view dictionary (/Type /3DView) as plain data:
 * { name, internalName, c2w (12 numbers or null), co, ortho, fov, fovBinding }.
 * fov is in degrees and measured along fovBinding: 'W' (default), 'H',
 * 'Min' or 'Max' of the annotation's rectangle (/PS, ISO 32000-1 table 304).
 */
export function readView(ctx, v, fallbackName) {
  const c2w = numbers(lookup(ctx, v.get(PDFName.of('C2W'))));
  const p = lookup(ctx, v.get(PDFName.of('P')));
  let fov = 30, ortho = false, fovBinding = 'W';
  if (p instanceof PDFDict) {
    ortho = text(lookup(ctx, p.get(PDFName.of('Subtype')))) === 'O';
    const f = num(ctx, p.get(PDFName.of('FOV')), 30);
    if (f > 0 && f < 180) fov = f;
    const ps = lookup(ctx, p.get(PDFName.of('PS')));
    if (ps instanceof PDFName && ['W', 'H', 'Min', 'Max'].includes(ps.decodeText())) fovBinding = ps.decodeText();
  }
  const internalName = text(lookup(ctx, v.get(PDFName.of('IN'))));
  const co = num(ctx, v.get(PDFName.of('CO')), 0);
  return {
    name: text(lookup(ctx, v.get(PDFName.of('XN')))) || internalName || fallbackName,
    internalName,
    c2w: c2w && c2w.length >= 12 ? c2w.slice(0, 12) : null,
    co: co > 0 ? co : 0,
    ortho,
    fov,
    fovBinding,
  };
}

function readViews(ctx, dict) {
  const va = lookup(ctx, dict.get(PDFName.of('VA')));
  if (!(va instanceof PDFArray)) return [];
  const views = [];
  for (const item of va.asArray()) {
    const v = lookup(ctx, item);
    if (!(v instanceof PDFDict)) continue;
    views.push(readView(ctx, v, `View ${views.length + 1}`));
  }
  return views;
}

/**
 * Index into `views` of a /3DV (annotation) or /DV (stream) entry: a view
 * dictionary, an index, a view's internal name, or /F, /L (first, last);
 * /D on the annotation means the stream's own default. -1 when unset.
 */
function viewIndex(ctx, entry, views, raw) {
  const v = lookup(ctx, entry);
  if (v instanceof PDFNumber) return Math.trunc(v.asNumber());
  if (v instanceof PDFName) {
    const n = v.decodeText();
    if (n === 'F') return 0;
    if (n === 'L') return views.length - 1;
    return -1; // /D and unknown names: the stream default decides
  }
  if (v instanceof PDFString || v instanceof PDFHexString) {
    const want = v.decodeText();
    return views.findIndex(x => x.internalName === want);
  }
  if (v instanceof PDFDict) {
    const at = raw.findIndex(d => d === v);
    if (at >= 0) return at;
    views.push(readView(ctx, v, `View ${views.length + 1}`));
    return views.length - 1;
  }
  return -1;
}

/** Whether a stream is plain FlateDecode, which the worker can inflate. */
function plainFlate(ctx, dict) {
  const f = lookup(ctx, dict.get(PDFName.of('Filter')));
  if (dict.get(PDFName.of('DecodeParms'))) return false;
  if (f instanceof PDFName) return f.decodeText() === 'FlateDecode';
  if (f instanceof PDFArray && f.size() === 1) {
    const only = lookup(ctx, f.get(0));
    return only instanceof PDFName && only.decodeText() === 'FlateDecode';
  }
  return false;
}

/**
 * Scan a pdf-lib document for 3D annotations. Returns
 * [{ page (1-based), rect [x1,y1,x2,y2] | null, subtype ('U3D' | 'PRC' | ...),
 *    views, defaultView, getBytes() -> Uint8Array,
 *    getSource(canInflate) -> { bytes, deflated } }].
 * getSource hands out the stream still compressed when it is plain
 * FlateDecode and the caller can inflate it elsewhere (the worker).
 */
export function find3DAnnotations(pdfLibDoc) {
  const ctx = pdfLibDoc.context;
  const out = [];
  pdfLibDoc.getPages().forEach((page, i) => {
    const annots = lookup(ctx, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) return;
    for (const a of annots.asArray()) {
      const annot = lookup(ctx, a);
      if (!(annot instanceof PDFDict)) continue;
      if (text(annot.get(PDFName.of('Subtype'))) !== '3D') continue;
      const stream = streamOf(ctx, annot.get(PDFName.of('3DD')));
      if (!stream) continue;
      const va = lookup(ctx, stream.dict.get(PDFName.of('VA')));
      const raw = va instanceof PDFArray ? va.asArray().map(x => lookup(ctx, x)).filter(x => x instanceof PDFDict) : [];
      const views = readViews(ctx, stream.dict);
      let defaultView = viewIndex(ctx, annot.get(PDFName.of('3DV')), views, raw);
      if (defaultView < 0) defaultView = viewIndex(ctx, stream.dict.get(PDFName.of('DV')), views, raw);
      const rect = numbers(lookup(ctx, annot.get(PDFName.of('Rect'))));
      out.push({
        page: i + 1,
        rect: rect && rect.length === 4 ? rect : null,
        subtype: text(lookup(ctx, stream.dict.get(PDFName.of('Subtype')))),
        views,
        defaultView: Math.max(0, Math.min(defaultView, views.length - 1)),
        getBytes: () => decodePDFRawStream(stream).decode(),
        getSource: (canInflate) => (canInflate && plainFlate(ctx, stream.dict)
          ? { bytes: stream.contents.slice(), deflated: true }
          : { bytes: decodePDFRawStream(stream).decode().slice(), deflated: false }),
      });
    }
  });
  return out;
}

const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The /OPS_3DSnapshot record of a page, checked field by field: the value
 * comes from the file and may have been written by anyone. null when the
 * record is missing or not ours.
 */
export function parseSnapshotRecord(json, pageCount) {
  let data;
  try { data = JSON.parse(json); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const sourcePage = Math.trunc(finite(data.sourcePage, 1));
  const c2w = Array.isArray(data.c2w) && data.c2w.length === 12 && data.c2w.every(v => typeof v === 'number' && Number.isFinite(v))
    ? data.c2w : null;
  return {
    sourcePage: sourcePage >= 1 && sourcePage <= pageCount ? sourcePage : 1,
    name: typeof data.name === 'string' ? data.name.slice(0, 200) : '',
    c2w,
    co: Math.max(0, finite(data.co)),
    fov: finite(data.fov, 30),
    ortho: data.ortho === true,
    hidden: Array.isArray(data.hidden) ? data.hidden.filter(s => typeof s === 'string').slice(0, 100000) : [],
  };
}

/**
 * Pages made by the 3D markup snapshot (snapshot-page.js):
 * [{ page, sourcePage, name, c2w, co, fov, ortho, hidden }].
 */
export function findThreeDSnapshots(pdfLibDoc) {
  const out = [];
  const pages = pdfLibDoc.getPages();
  pages.forEach((page, i) => {
    const raw = lookup(pdfLibDoc.context, page.node.get(PDFName.of(SNAPSHOT_KEY)));
    if (!(raw instanceof PDFString || raw instanceof PDFHexString)) return;
    const rec = parseSnapshotRecord(raw.decodeText(), pages.length);
    if (rec) out.push({ ...rec, page: i + 1 });
  });
  return out;
}
