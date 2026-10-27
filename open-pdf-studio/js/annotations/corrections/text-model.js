// Text model of the proofreading mode (#508, part 2).
//
// Built from the items of pdf.js getTextContent: the characters of a page as
// lines in reading order, each character with its start and end point on the
// baseline in the page space of the app (points, origin top left of the shown
// page, y down; see geometry.js). `transform` maps PDF user space into that
// space: the pdf.js viewport transform at scale 1 with the total rotation of
// the page.
//
// A cursor position is one number: the index of the gap before a character.
// Every line ends with a virtual line break, so the end of a line and the
// start of the next one are two positions, as in a text editor:
//   line 0 'ab' -> 0 a 1 b 2 | line 1 'cd' -> 3 c 4 d 5
//
// Pure: no DOM, no app imports.

import { TEXT_ASCENT, TEXT_DESCENT, textDirFromVector, normTextDir } from './geometry.js';

const IDENTITEIT = [1, 0, 0, 1, 0, 0];

const naPunt = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const naVector = (m, x, y) => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
const punt = (p, v, f) => ({ x: p.x + v.x * f, y: p.y + v.y * f });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Boundaries 0..1 of the characters of `str` along the baseline. */
function grenzen(str, tekens, measure, item) {
  const n = tekens.length;
  if (typeof measure === 'function') {
    const totaal = Number(measure(str, item));
    if (totaal > 0) {
      const uit = [0];
      let stuk = '';
      for (let i = 0; i < n; i++) {
        stuk += tekens[i];
        const f = i === n - 1 ? 1 : Number(measure(stuk, item)) / totaal;
        uit.push(Math.min(1, Math.max(uit[uit.length - 1], Number.isFinite(f) ? f : 0)));
      }
      return uit;
    }
  }
  return Array.from({ length: n + 1 }, (_, i) => i / n);
}

/** Geometry of one text item in app space, or null without usable characters. */
function itemGeometrie(item, m, measure) {
  if (!item || typeof item.str !== 'string' || item.str === '' || !Array.isArray(item.transform)) return null;
  const [a, b, c, d, e, f] = item.transform.map(Number);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  const tekens = Array.from(item.str);
  const lengteAB = Math.hypot(a, b);
  const ux = lengteAB > 0 ? a / lengteAB : 1;
  const uy = lengteAB > 0 ? b / lengteAB : 0;
  const opVec = naVector(m, c, d);
  const h = Math.hypot(opVec.x, opVec.y) || Math.abs(Number(item.height)) || 10;
  let w = Number(item.width);
  if (!(w > 0)) w = 0;
  const begin = naPunt(m, e, f);
  const eind = naPunt(m, e + ux * w, f + uy * w);
  // Direction along the baseline in app space; also defined for width 0.
  const richt = naVector(m, ux, uy);
  const lr = Math.hypot(richt.x, richt.y) || 1;
  const D = { x: richt.x / lr, y: richt.y / lr };
  // Up: perpendicular to the baseline, on the side of the text's own up axis.
  let U = { x: D.y, y: -D.x };
  if (dot(U, opVec) < 0) U = { x: -U.x, y: -U.y };
  const graden = Math.atan2(D.y, D.x) * 180 / Math.PI;
  const textDir = textDirFromVector(D.x, D.y) ?? normTextDir(graden);
  const g = grenzen(item.str, tekens, measure, item);
  const chars = tekens.map((ch, i) => ({ ch, a: lerp(begin, eind, g[i]), b: lerp(begin, eind, g[i + 1]), h }));
  return { chars, D, U, h, textDir, begin, eind };
}

const isSpatie = (ch) => /\s/u.test(ch);

/**
 * Builds the text model of one page.
 * @param {Array<object>} items  textContent.items of pdf.js
 * @param {{ transform?: number[], measure?: (s: string, item: object) => number }} [opties]
 *   transform: PDF user space -> app page space; measure: width of a piece
 *   of the item's text in any unit (canvas measureText), for the character
 *   positions; without it every character gets the same share.
 * @returns {{ lines: Array<{ textDir: number, D: {x,y}, up: {x,y}, chars: Array<{ch,a,b,h,virtual?}> }> }}
 */
export function buildTextModel(items, { transform = IDENTITEIT, measure } = {}) {
  const m = Array.isArray(transform) && transform.length >= 6 ? transform.map(Number) : IDENTITEIT;
  const lines = [];
  let huidig = null;
  let breek = false;
  for (const item of items || []) {
    const geo = itemGeometrie(item, m, measure);
    if (!geo) {
      if (item?.hasEOL) breek = true;
      continue;
    }
    let zelfdeRegel = false;
    if (huidig && !breek) {
      const laatste = huidig.chars[huidig.chars.length - 1];
      const rel = { x: geo.begin.x - laatste.b.x, y: geo.begin.y - laatste.b.y };
      const h = Math.max(laatste.h, geo.h);
      const langs = dot(rel, huidig.D);
      const dwars = Math.abs(dot(rel, huidig.up));
      zelfdeRegel = dot(huidig.D, geo.D) > 0.99 && dwars <= 0.5 * h && langs >= -0.5 * h;
      if (zelfdeRegel && langs > 0.15 * h && !isSpatie(laatste.ch) && !isSpatie(geo.chars[0].ch)) {
        huidig.chars.push({ ch: ' ', a: laatste.b, b: geo.begin, h: laatste.h, virtual: true });
      }
    }
    if (zelfdeRegel) {
      huidig.chars.push(...geo.chars);
    } else {
      huidig = { textDir: geo.textDir, D: geo.D, up: geo.U, chars: [...geo.chars] };
      lines.push(huidig);
    }
    breek = !!item.hasEOL;
  }
  return { lines };
}

/** The text of line `l`. */
export function lineText(model, l) {
  return (model.lines[l]?.chars || []).map((c) => c.ch).join('');
}

/** Number of positions minus one: the last position. */
export function totalLength(model) {
  const lines = model?.lines || [];
  if (lines.length === 0) return 0;
  return lines.reduce((n, l) => n + l.chars.length, 0) + lines.length - 1;
}

/** Index of the first position of every line. */
function begins(model) {
  const uit = [];
  let n = 0;
  for (const l of model.lines) { uit.push(n); n += l.chars.length + 1; }
  return uit;
}

/** Position -> { line, offset }; clamped to the model. */
export function locate(model, g) {
  const lines = model?.lines || [];
  if (lines.length === 0) return { line: 0, offset: 0 };
  const pos = Math.max(0, Math.min(totalLength(model), Math.round(Number(g) || 0)));
  let start = 0;
  for (let l = 0; l < lines.length; l++) {
    const len = lines[l].chars.length;
    if (pos <= start + len) return { line: l, offset: pos - start };
    start += len + 1;
  }
  const l = lines.length - 1;
  return { line: l, offset: lines[l].chars.length };
}

/** { line, offset } -> position. */
export function indexOf(model, line, offset) {
  const b = begins(model);
  if (b.length === 0) return 0;
  const l = Math.max(0, Math.min(b.length - 1, line));
  return b[l] + Math.max(0, Math.min(model.lines[l].chars.length, offset));
}

/** The character after position `g`: '\n' for a line break, '' at the end. */
export function charAt(model, g) {
  if (g < 0 || g >= totalLength(model)) return '';
  const { line, offset } = locate(model, g);
  const c = model.lines[line].chars[offset];
  return c ? c.ch : '\n';
}

// Word classes for Ctrl+arrow: 0 space (and line break), 1 word, 2 punctuation.
const WOORD = /[\p{L}\p{N}\p{M}_]/u;
function klasse(model, g) {
  const ch = charAt(model, g);
  if (ch === '' || ch === '\n' || isSpatie(ch)) return 0;
  if (WOORD.test(ch)) return 1;
  // An apostrophe between two letters belongs to the word (it's).
  if (/['’]/u.test(ch) && WOORD.test(charAt(model, g - 1)) && WOORD.test(charAt(model, g + 1))) return 1;
  return 2;
}

function puntOp(model, line, offset) {
  const chars = model.lines[line].chars;
  return offset < chars.length ? chars[offset].a : chars[chars.length - 1].b;
}

/** Offset on line `l` nearest to the point `doel` along that line. */
function dichtstbijOpRegel(model, l, doel) {
  const regel = model.lines[l];
  const s = dot(doel, regel.D);
  let beste = 0;
  let afstand = Infinity;
  for (let o = 0; o <= regel.chars.length; o++) {
    const a = Math.abs(dot(puntOp(model, l, o), regel.D) - s);
    if (a < afstand - 1e-9) { afstand = a; beste = o; }
  }
  return beste;
}

/**
 * Moves the cursor.
 * @param {string} how  'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd' |
 *   'docStart' | 'docEnd' | 'wordLeft' | 'wordRight'
 * @param {{ goal?: {x:number,y:number}|null }} [opties]  goal: column point kept over up/down
 * @returns {{ pos: number, goal: {x:number,y:number}|null, edge: 'start'|'end'|null }}
 *   edge: the move wanted to leave the model at that side (pos is unchanged)
 */
export function moveCursor(model, g, how, { goal = null } = {}) {
  const n = totalLength(model);
  const pos = Math.max(0, Math.min(n, Math.round(Number(g) || 0)));
  const leeg = !model?.lines?.length;
  const rand = (edge) => ({ pos, goal: null, edge });
  const naar = (p) => ({ pos: p, goal: null, edge: null });
  switch (how) {
    case 'left': return pos <= 0 ? rand('start') : naar(pos - 1);
    case 'right': return pos >= n ? rand('end') : naar(pos + 1);
    case 'docStart': return naar(0);
    case 'docEnd': return naar(n);
    case 'lineStart': {
      if (leeg) return naar(0);
      return naar(indexOf(model, locate(model, pos).line, 0));
    }
    case 'lineEnd': {
      if (leeg) return naar(0);
      const { line } = locate(model, pos);
      return naar(indexOf(model, line, model.lines[line].chars.length));
    }
    case 'up':
    case 'down': {
      if (leeg) return rand(how === 'up' ? 'start' : 'end');
      const { line, offset } = locate(model, pos);
      const doelRegel = line + (how === 'up' ? -1 : 1);
      if (doelRegel < 0) return rand('start');
      if (doelRegel >= model.lines.length) return rand('end');
      const doel = goal || puntOp(model, line, offset);
      return { pos: indexOf(model, doelRegel, dichtstbijOpRegel(model, doelRegel, doel)), goal: doel, edge: null };
    }
    case 'wordRight': {
      if (pos >= n) return rand('end');
      let p = pos;
      const k = klasse(model, p);
      if (k !== 0) while (p < n && klasse(model, p) === k) p++;
      while (p < n && klasse(model, p) === 0) p++;
      return naar(p);
    }
    case 'wordLeft': {
      if (pos <= 0) return rand('start');
      let p = pos - 1;
      while (p > 0 && klasse(model, p) === 0) p--;
      const k = klasse(model, p);
      if (k !== 0) while (p > 0 && klasse(model, p - 1) === k) p--;
      return naar(p);
    }
    default: return naar(pos);
  }
}

/** Per line the offsets [from, to) that the range a..b covers (line breaks excluded). */
function stukken(model, a, b) {
  const van = Math.min(a, b);
  const tot = Math.max(a, b);
  const uit = [];
  if (!model?.lines?.length || van === tot) return uit;
  const s = locate(model, van);
  const e = locate(model, tot);
  for (let l = s.line; l <= e.line; l++) {
    const len = model.lines[l].chars.length;
    const o1 = l === s.line ? s.offset : 0;
    const o2 = l === e.line ? e.offset : len;
    if (o2 > o1) uit.push({ line: l, from: o1, to: o2 });
  }
  return uit;
}

/** The text of a range; lines are joined with one space. */
export function rangeText(model, a, b) {
  let uit = '';
  let vorigeRegel = null;
  for (const { line, from, to } of stukken(model, a, b)) {
    const stuk = model.lines[line].chars.slice(from, to).map((c) => c.ch).join('');
    if (vorigeRegel !== null && line !== vorigeRegel && uit && !isSpatie(uit[uit.length - 1]) && !isSpatie(stuk[0])) uit += ' ';
    uit += stuk;
    vorigeRegel = line;
  }
  return uit;
}

/**
 * Text rectangles of a range, one per line, axis-aligned in app space (exact
 * for text on a quarter turn): from baseline - 0.2 h to baseline + 0.8 h,
 * like the search highlights. textDir is that of the first line.
 * @returns {{ rects: Array<{x:number,y:number,width:number,height:number}>, textDir: number }}
 */
export function rangeRects(model, a, b) {
  const rects = [];
  let textDir = null;
  for (const { line, from, to } of stukken(model, a, b)) {
    const regel = model.lines[line];
    if (textDir === null) textDir = regel.textDir;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const c of regel.chars.slice(from, to)) {
      for (const p of [c.a, c.b]) {
        for (const f of [TEXT_ASCENT * c.h, -TEXT_DESCENT * c.h]) {
          const q = punt(p, regel.up, f);
          minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
          minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
        }
      }
    }
    rects.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }
  return { rects, textDir: textDir ?? 0 };
}

/**
 * The cursor at position `g`: point P on the baseline, font size h, reading
 * direction and up vector. null for an empty model.
 */
export function caretAt(model, g) {
  if (!model?.lines?.length) return null;
  const { line, offset } = locate(model, g);
  const regel = model.lines[line];
  const c = regel.chars[Math.max(0, Math.min(regel.chars.length - 1, offset - 1))];
  return { P: puntOp(model, line, offset), h: c.h, textDir: regel.textDir, up: regel.up, line };
}

/** The cursor as a line across the text: from the descent (bottom) to the ascent (top). */
export function caretSegment(model, g) {
  const c = caretAt(model, g);
  if (!c) return null;
  return { from: punt(c.P, c.up, -TEXT_DESCENT * c.h), to: punt(c.P, c.up, TEXT_ASCENT * c.h), ...c };
}

/** Position nearest to the point (x, y): the nearest character box, then its nearest side. */
export function hitTest(model, x, y) {
  if (!model?.lines?.length) return 0;
  const P = { x: Number(x), y: Number(y) };
  let beste = null;
  let afstand = Infinity;
  model.lines.forEach((regel, l) => {
    const s = dot(P, regel.D);
    const t = dot(P, regel.up);
    regel.chars.forEach((c, o) => {
      const s1 = Math.min(dot(c.a, regel.D), dot(c.b, regel.D));
      const s2 = Math.max(dot(c.a, regel.D), dot(c.b, regel.D));
      const t0 = dot(c.a, regel.up);
      const ds = Math.max(0, s1 - s, s - s2);
      const dt = Math.max(0, t0 - TEXT_DESCENT * c.h - t, t - (t0 + TEXT_ASCENT * c.h));
      const d = Math.hypot(ds, dt);
      if (d < afstand - 1e-9) {
        afstand = d;
        const voor = s < (dot(c.a, regel.D) + dot(c.b, regel.D)) / 2;
        beste = { line: l, offset: voor ? o : o + 1 };
      }
    });
  });
  return beste ? indexOf(model, beste.line, beste.offset) : 0;
}
