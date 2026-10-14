// ============================================================================
// Embedded image-XObject parser (issue #184).
//
// Pure, DOM-free helpers that locate the raster images that are baked into a
// PDF page's *content stream* (image XObjects invoked with `/Name Do`) — as
// opposed to images placed as annotations (stamps), which live in /Annots and
// are handled elsewhere. This module only depends on pdf-lib so it can be
// unit-tested under Node.
//
// The content stream is tokenised with a small graphics-state tracker (q / Q /
// cm) so every page-level image draw is captured together with:
//   - its CTM (used to derive the on-page bounding box), and
//   - the exact character range of the `/Name Do` operator (used to delete it).
//
// Deliberate scope (keeps detection and removal perfectly in sync — every
// highlighted image is removable):
//   - Only *page-level* image XObjects are reported. Images nested inside a
//     Form XObject are skipped (the Form's own `/Name Do` has Subtype /Form,
//     not /Image). Inline images (BI…ID…EI) are skipped over — their binary
//     payload is walked past so it can never be mis-read as operators.
// ============================================================================

import { PDFName, PDFArray, decodePDFRawStream, arrayAsString } from 'pdf-lib';

// --- character classes (PDF content-stream lexing) --------------------------
const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
function isWs(code) { return WS.has(code); }
function isDelim(ch) {
  return ch === '(' || ch === ')' || ch === '<' || ch === '>' ||
         ch === '[' || ch === ']' || ch === '{' || ch === '}' ||
         ch === '/' || ch === '%';
}
function isRegular(ch) {
  const code = ch.charCodeAt(0);
  return !isWs(code) && !isDelim(ch);
}
function isNumberToken(tok) {
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok);
}

// Multiply two 2-D affine matrices [a,b,c,d,e,f]. Result = A * B (B first).
// Matches the convention used by js/tools/pdf-snap-extractor.js.
function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

// Resolve an entry that may be inherited from a Pages parent (Resources).
export function getInherited(node, key, context) {
  let cur = node;
  const seen = new Set();
  while (cur) {
    const v = cur.get(PDFName.of(key));
    if (v !== undefined && v !== null) return v;
    const parentRef = cur.get(PDFName.of('Parent'));
    if (!parentRef) break;
    const parent = context.lookup(parentRef);
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    cur = parent;
  }
  return undefined;
}

// Return the page's content streams (in order) as one decoded string.
export function collectContentText(node, context) {
  const contentsRaw = node.get(PDFName.of('Contents'));
  const contents = contentsRaw ? context.lookup(contentsRaw) : null;
  const streams = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = context.lookup(contents.get(i));
      if (s) streams.push(s);
    }
  } else if (contents) {
    streams.push(contents);
  }
  const parts = streams.map((s) => {
    try { return arrayAsString(decodePDFRawStream(s).decode()); }
    catch { return ''; }
  });
  // '\n' separator matches how PDF.js concatenates multiple content streams,
  // so image-draw ordering here mirrors the render order exactly.
  return parts.join('\n');
}

// Set of resource names (e.g. "/Im0") whose XObject Subtype is /Image.
export function collectImageNames(node, context) {
  const names = new Set();
  const resRaw = getInherited(node, 'Resources', context);
  const res = resRaw ? context.lookup(resRaw) : null;
  if (!res) return names;
  const xoRaw = res.get(PDFName.of('XObject'));
  const xo = xoRaw ? context.lookup(xoRaw) : null;
  if (!xo || typeof xo.entries !== 'function') return names;
  for (const [name, ref] of xo.entries()) {
    try {
      const o = context.lookup(ref);
      const d = (o && o.dict) ? o.dict : o;
      const st = d && d.get ? d.get(PDFName.of('Subtype')) : null;
      if (st && st.toString() === '/Image') names.add(name.toString());
    } catch { /* ignore a single bad entry */ }
  }
  return names;
}

// Walk the content stream and return every page-level image draw in order:
//   { ctm:[6], start, end }
// where [start, end) is the character span of the `/Name Do` operator.
export function tokenizeImages(text, imageNames) {
  const n = text.length;
  const out = [];
  let i = 0;

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let operands = [];        // numeric operands accumulated for the next operator
  let pendingName = null;   // last /Name token text (e.g. "/Im0")
  let pendingNameStart = -1;

  while (i < n) {
    const ch = text[i];
    const code = ch.charCodeAt(0);

    if (isWs(code)) { i++; continue; }

    if (ch === '%') { // comment to end of line
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }

    if (ch === '/') { // name object
      const start = i; i++;
      while (i < n && isRegular(text[i])) i++;
      pendingName = text.slice(start, i);
      pendingNameStart = start;
      continue;
    }

    if (ch === '(') { // literal string — skip balanced, honouring escapes
      i++; let depth = 1;
      while (i < n && depth > 0) {
        const c = text[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        i++;
      }
      operands = []; pendingName = null;
      continue;
    }

    if (ch === '<') {
      if (text[i + 1] === '<') { i += 2; continue; } // dict open
      i++; while (i < n && text[i] !== '>') i++; i++; // hex string
      operands = []; pendingName = null;
      continue;
    }
    if (ch === '>') { i += (text[i + 1] === '>') ? 2 : 1; continue; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') { i++; continue; }

    // number or operator keyword: a run of regular chars
    const start = i;
    while (i < n && isRegular(text[i])) i++;
    const tok = text.slice(start, i);
    if (!tok) { i++; continue; }

    if (isNumberToken(tok)) {
      operands.push(parseFloat(tok));
      continue;
    }

    // operator keyword
    switch (tok) {
      case 'q':
        stack.push(ctm.slice());
        break;
      case 'Q':
        if (stack.length) ctm = stack.pop();
        break;
      case 'cm':
        if (operands.length >= 6) {
          const m = operands.slice(operands.length - 6);
          ctm = mul(ctm, m);
        }
        break;
      case 'BI': {
        // inline image — walk past the binary payload to EI so its bytes are
        // never mistaken for operators. Skipped (not removable in this pass).
        i = skipInlineImage(text, i);
        break;
      }
      case 'Do':
        if (pendingName && imageNames.has(pendingName)) {
          out.push({ ctm: ctm.slice(), start: pendingNameStart, end: i });
        }
        break;
      default:
        break;
    }
    operands = [];
    pendingName = null;
  }

  return out;
}

// Given index `i` positioned just after a `BI` token, return the index just
// after the matching `EI`. Heuristic: find ` ID`, then the first whitespace-
// delimited `EI`. Best-effort — inline images are rare in target documents.
function skipInlineImage(text, i) {
  const n = text.length;
  let j = i;
  while (j < n) {
    const idIdx = text.indexOf('ID', j);
    if (idIdx < 0) return n;
    const before = idIdx > 0 ? text[idIdx - 1] : ' ';
    const beforeOk = isWs(before.charCodeAt(0)) || isDelim(before);
    if (beforeOk) {
      let k = idIdx + 3; // skip 'ID' + one whitespace byte
      while (k < n) {
        const eiIdx = text.indexOf('EI', k);
        if (eiIdx < 0) return n;
        const b = eiIdx > 0 ? text[eiIdx - 1] : ' ';
        const a = eiIdx + 2 < n ? text[eiIdx + 2] : ' ';
        if (isWs(b.charCodeAt(0)) && (isWs(a.charCodeAt(0)) || isDelim(a))) {
          return eiIdx + 2;
        }
        k = eiIdx + 2;
      }
      return n;
    }
    j = idIdx + 2;
  }
  return n;
}

// Blank an image's `/Name Do` operator with spaces (preserving length so no
// other offsets shift). The surrounding q/cm/Q remain valid but paint nothing.
export function blankImageRange(text, image) {
  const len = image.end - image.start;
  return text.slice(0, image.start) + ' '.repeat(len) + text.slice(image.end);
}

// Axis-aligned bounding box (in the target space defined by `viewportTransform`)
// for an image whose placement CTM maps the unit square onto the page.
export function bboxFromCtm(ctm, viewportTransform) {
  const vt = viewportTransform;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [ux, uy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    // unit square → PDF page space
    const px = ctm[0] * ux + ctm[2] * uy + ctm[4];
    const py = ctm[1] * ux + ctm[3] * uy + ctm[5];
    // PDF page space → target (CSS) space
    const vx = vt ? vt[0] * px + vt[2] * py + vt[4] : px;
    const vy = vt ? vt[1] * px + vt[3] * py + vt[5] : py;
    minX = Math.min(minX, vx); minY = Math.min(minY, vy);
    maxX = Math.max(maxX, vx); maxY = Math.max(maxY, vy);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Convenience wrapper used by both detection and removal.
export function parsePageImages(pdfLibDoc, pageNum) {
  const context = pdfLibDoc.context;
  const node = pdfLibDoc.getPage(pageNum - 1).node;
  const text = collectContentText(node, context);
  const imageNames = collectImageNames(node, context);
  const images = tokenizeImages(text, imageNames);
  return { text, imageNames, images };
}
