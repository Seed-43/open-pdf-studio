// Find 3D annotations (/Subtype /3D, ISO 32000-1 section 13.6) in a PDF and
// pull out their model stream and preset views. PDF.js does not render 3D
// artwork (it only draws the /AP poster), so the app reads these itself and
// shows them in its own WebGL viewer.
import { PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';

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
  return arr.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : Number(n)));
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

// Custom key on a /3DView dictionary holding this app's markups for that
// view as JSON: { markups: [...], hidden: [node names] }. Other viewers
// ignore it and still get the camera (/C2W, /CO, /P) as a named view.
export const SAVED_VIEW_KEY = 'OPS_Markups';

function readViews(ctx, dict) {
  const va = lookup(ctx, dict.get(PDFName.of('VA')));
  if (!(va instanceof PDFArray)) return [];
  const views = [];
  for (const item of va.asArray()) {
    const v = lookup(ctx, item);
    if (!(v instanceof PDFDict)) continue;
    const c2w = numbers(lookup(ctx, v.get(PDFName.of('C2W'))));
    const co = lookup(ctx, v.get(PDFName.of('CO')));
    const p = lookup(ctx, v.get(PDFName.of('P')));
    let fov = 30, ortho = false;
    if (p instanceof PDFDict) {
      const sub = text(p.get(PDFName.of('Subtype')));
      ortho = sub === 'O';
      const f = lookup(ctx, p.get(PDFName.of('FOV')));
      if (f instanceof PDFNumber) fov = f.asNumber();
    }
    const view = {
      name: text(lookup(ctx, v.get(PDFName.of('XN')))) || text(lookup(ctx, v.get(PDFName.of('IN')))) || `View ${views.length + 1}`,
      c2w,
      co: co instanceof PDFNumber ? co.asNumber() : 0,
      fov,
      ortho,
    };
    // Saved markup view written by this app: markups and hidden nodes.
    const extra = lookup(ctx, v.get(PDFName.of(SAVED_VIEW_KEY)));
    if (extra) {
      try {
        const data = JSON.parse(text(extra));
        view.saved = true;
        view.markups = Array.isArray(data.markups) ? data.markups : [];
        view.hidden = Array.isArray(data.hidden) ? data.hidden : [];
      } catch (_) { /* unreadable: treat as a plain view */ }
    }
    views.push(view);
  }
  return views;
}

/**
 * Scan a pdf-lib document for 3D annotations. Returns
 * [{ page (1-based), rect [x1,y1,x2,y2], subtype ('U3D' | 'PRC' | ...),
 *    views, defaultView, getBytes() -> Uint8Array }].
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
      const allViews = readViews(ctx, stream.dict);
      const views = allViews.filter(v => !v.saved);
      const savedViews = allViews.filter(v => v.saved);
      const dv = lookup(ctx, annot.get(PDFName.of('3DV')));
      let defaultView = 0;
      if (dv instanceof PDFNumber) defaultView = dv.asNumber();
      else {
        const sdv = lookup(ctx, stream.dict.get(PDFName.of('DV')));
        if (sdv instanceof PDFNumber) defaultView = sdv.asNumber();
      }
      out.push({
        page: i + 1,
        rect: numbers(lookup(ctx, annot.get(PDFName.of('Rect')))),
        subtype: text(stream.dict.get(PDFName.of('Subtype'))),
        views,
        savedViews,
        defaultView: Math.max(0, Math.min(defaultView, views.length - 1)),
        getBytes: () => decodePDFRawStream(stream).decode(),
      });
    }
  });
  return out;
}

/**
 * Write saved markup views back into the 3D streams of a pdf-lib document
 * (called on save). Each 3D annotation in `threeD` with `savedViewsDirty`
 * gets its /VA rebuilt: the original views first, then one /3DView per
 * saved view with the camera and this app's markups under SAVED_VIEW_KEY.
 * Annotations are matched by page and /Rect.
 */
export function writeSavedViews(pdfLibDoc, threeD) {
  const dirty = (threeD || []).filter(a => a.savedViewsDirty);
  if (!dirty.length) return;
  const ctx = pdfLibDoc.context;
  const pages = pdfLibDoc.getPages();
  for (const a of dirty) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const annots = lookup(ctx, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (const ref of annots.asArray()) {
      const annot = lookup(ctx, ref);
      if (!(annot instanceof PDFDict) || text(annot.get(PDFName.of('Subtype'))) !== '3D') continue;
      const rect = numbers(lookup(ctx, annot.get(PDFName.of('Rect'))));
      if (!rect || !a.rect || rect.some((n, i) => Math.abs(n - a.rect[i]) > 0.01)) continue;
      const stream = streamOf(ctx, annot.get(PDFName.of('3DD')));
      if (!stream) continue;
      const va = lookup(ctx, stream.dict.get(PDFName.of('VA')));
      const kept = va instanceof PDFArray
        ? va.asArray().filter(item => {
          const v = lookup(ctx, item);
          return !(v instanceof PDFDict && v.get(PDFName.of(SAVED_VIEW_KEY)));
        })
        : [];
      const added = (a.savedViews || []).map(v => ctx.obj({
        Type: PDFName.of('3DView'),
        XN: PDFHexString.fromText(v.name),
        IN: PDFHexString.fromText(v.name),
        MS: PDFName.of('M'),
        C2W: v.c2w.map(n => PDFNumber.of(n)),
        CO: PDFNumber.of(v.co || 0),
        P: ctx.obj({ Subtype: PDFName.of('P'), FOV: PDFNumber.of(v.fov || 30), PS: PDFName.of('Min') }),
        [SAVED_VIEW_KEY]: PDFHexString.fromText(JSON.stringify({ markups: v.markups || [], hidden: v.hidden || [] })),
      }));
      stream.dict.set(PDFName.of('VA'), ctx.obj([...kept, ...added]));
    }
  }
}
