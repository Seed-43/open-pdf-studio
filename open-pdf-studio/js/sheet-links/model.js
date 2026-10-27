import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';

const fail = code => {
  throw new Error(code);
};
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

export function safePath(path) {
  return typeof path === 'string'
    && path.length <= 500
    && /\.pdf$/i.test(path)
    && !path.startsWith('/')
    && !/[\\:]/.test(path)
    && path.split('/').every(p => p && p !== '.' && p !== '..');
}

export function relativePath(source, target) {
  if (!safePath(source) || !safePath(target)) fail('INVALID_PATH');
  const from = source.split('/');
  from.pop();
  const to = target.split('/');
  while (from.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return '../'.repeat(from.length) + to.join('/');
}

export function validateIndex(input) {
  if (!Array.isArray(input) || !input.length || input.length > 500) fail('INVALID_INDEX');
  const ids = new Set();
  return input.map(row => {
    if (!row
      || typeof row.id !== 'string'
      || !row.id
      || ids.has(row.id)
      || !safePath(row.path)
      || !Number.isInteger(row.page)
      || row.page < 1
      || typeof row.label !== 'string'
      || !row.label.trim()
      || row.label.length > 80) fail('INVALID_INDEX');
    ids.add(row.id);
    if (row.region
      && (!Array.isArray(row.region) || row.region.length !== 4 || !row.region.every(Number.isFinite) || row.region[2] <= row.region[0] || row.region[3] <= row.region[1])) fail('INVALID_REGION');
    return { id: row.id, path: row.path, page: row.page, label: row.label.trim(), region: row.region || null };
  });
}

export function findReferences(text, index, { prefix = '', caseSensitive = false } = {}) {
  if (typeof text !== 'string' || text.length > 100000 || typeof prefix !== 'string' || prefix.length > 80) fail('INVALID_TEXT');
  const normal = s => caseSensitive ? s : s.toLocaleUpperCase();
  const map = new Map();
  for (const row of index) {
    const key = normal(row.label);
    map.set(key, [...(map.get(key) || []), row.id]);
  }
  const labels = [...map.keys()].sort((a, b) => b.length - a.length).map(escape);
  const regex = prefix ? new RegExp(escape(prefix) + '([\\p{L}\\p{N}_.-]+)', caseSensitive ? 'gu' : 'giu') : new RegExp('(?<![\\p{L}\\p{N}_])(' + labels.join('|') + ')(?![\\p{L}\\p{N}_])', caseSensitive ? 'gu' : 'giu');
  const results = [];
  for (const match of text.matchAll(regex)) {
    const label = match[1],
      start = match.index + (prefix ? prefix.length : 0),
      targets = map.get(normal(label)) || [];
    results.push({
      label,
      start,
      end: start + label.length,
      targets,
      status: targets.length === 1 ? 'resolved' : targets.length ? 'ambiguous' : 'missing'
    });
    if (results.length >= 1000) break;
  }
  return results;
}

export const overlap = (a, b) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);

export function textReferenceRect(item, start, end) {
  const [a, b,,, x, y] = item.transform,
    width = item.width,
    height = Math.abs(item.height) || Math.hypot(item.transform[2], item.transform[3]),
    length = Math.hypot(a, b) || 1,
    ux = a / length,
    uy = b / length;
  const s = width * start / item.str.length,
    e = width * end / item.str.length,
    points = [[x + ux * s, y + uy * s], [x + ux * e, y + uy * e], [x + ux * s - uy * height, y + uy * s + ux * height], [x + ux * e - uy * height, y + uy * e + ux * height]];
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}
const readString = value => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;

export async function writeLinks(bytes, sourcePath, links, { replaceExisting = false } = {}) {
  if (!safePath(sourcePath)) fail('INVALID_PATH');
  const pdf = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  let added = 0,
    skipped = 0,
    replaced = 0;
  for (const link of links) {
    if (!Number.isInteger(link.page)
      || link.page < 1
      || link.page > pdf.getPageCount()
      || !Array.isArray(link.rect)
      || link.rect.length !== 4
      || !link.rect.every(Number.isFinite)
      || link.rect[2] <= link.rect[0]
      || link.rect[3] <= link.rect[1]
      || !safePath(link.target.path)
      || !Number.isInteger(link.target.page)
      || link.target.page < 1) fail('INVALID_LINK');
    const page = pdf.getPage(link.page - 1),
      existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray),
      id = 'opds-sheet-link-' + (await sha256(new TextEncoder().encode(JSON.stringify({
        sourcePath,
        page: link.page,
        rect: link.rect,
        target: { path: link.target.path, page: link.target.page, region: link.target.region || null }
      }))));
    const entries = existing ? existing.asArray() : [],
      kept = [];
    let duplicate = false,
      blocked = false,
      pendingReplaced = 0;
    for (const ref of entries) {
      const ann = pdf.context.lookup(ref);
      if (!(ann instanceof PDFDict) || ann.get(PDFName.of('Subtype'))?.toString() !== '/Link') {
        kept.push(ref);
        continue;
      }
      if (readString(ann.get(PDFName.of('NM'))) === id) {
        duplicate = true;
        kept.push(ref);
        continue;
      }
      const box = ann.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map(n => n instanceof PDFNumber ? n.asNumber() : NaN);
      if (box?.length === 4 && overlap(box, link.rect)) {
        if (replaceExisting) {
          pendingReplaced++;
          continue;
        }
        blocked = true;
      }
      kept.push(ref);
    }
    if (duplicate || blocked) {
      skipped++;
      continue;
    }
    const target = link.target;
    const destination = target.region ? [target.page - 1, PDFName.of('FitR'), ...target.region] : [target.page - 1, PDFName.of('Fit')];
    let action;
    if (target.path === sourcePath) {
      if (target.page > pdf.getPageCount()) fail('BROKEN_TARGET');
      destination[0] = pdf.getPage(target.page - 1).ref;
      action = pdf.context.obj({ S: 'GoTo', D: destination });
    } else {
      const path = relativePath(sourcePath, target.path);
      action = pdf.context.obj({
        S: 'GoToR',
        F: { Type: 'Filespec', F: PDFString.of(path), UF: PDFHexString.fromText(path) },
        D: destination,
        NewWindow: true
      });
    }
    const ann = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: link.rect,
      Border: [0, 0, 0],
      A: action,
      NM: PDFString.of(id),
      F: 4
    });
    kept.push(pdf.context.register(ann));
    page.node.set(PDFName.of('Annots'), pdf.context.obj(kept));
    added++;
    replaced += pendingReplaced;
  }
  return {
    bytes: added ? await pdf.save({ useObjectStreams: false }) : bytes.slice(),
    added,
    skipped,
    replaced
  };
}
