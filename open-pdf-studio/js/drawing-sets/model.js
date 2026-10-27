const copy = value => JSON.parse(JSON.stringify(value));
const fail = code => {
  throw new Error(code);
};
const text = (value, max = 200) => typeof value === 'string' && value.length <= max;

export function validateSheet(sheet) {
  if (!sheet
    || !text(sheet.number)
    || !sheet.number.trim()
    || !text(sheet.title)
    || !text(sheet.discipline)
    || !text(sheet.revision)
    || !text(sheet.date, 30)) fail('INVALID_SHEET');
  if (!text(sheet.source, 500)
    || !sheet.source
    || sheet.source.includes('\\')
    || sheet.source.startsWith('/')
    || sheet.source.includes(':')
    || sheet.source.split('/').some(p => !p || p === '.' || p === '..')) fail('RELATIVE_SOURCE_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(sheet.hash)
    || !Number.isInteger(sheet.page)
    || sheet.page < 1
    || sheet.page > 100000
    || ![sheet.width, sheet.height].every(v => Number.isFinite(v) && v > 0)
    || ![0, 90, 180, 270].includes(sheet.rotation)) fail('INVALID_PAGE');
  return {
    number: sheet.number.trim(),
    title: sheet.title,
    discipline: sheet.discipline.trim(),
    revision: sheet.revision,
    date: sheet.date,
    source: sheet.source,
    hash: sheet.hash,
    page: sheet.page,
    width: sheet.width,
    height: sheet.height,
    rotation: sheet.rotation
  };
}

export function validateManifest(value) {
  if (value?.version !== 1
    || !text(value.name)
    || !value.name.trim()
    || !Array.isArray(value.sheets)
    || value.sheets.length > 5000) fail('INVALID_MANIFEST');
  const ids = new Set();
  return {
    version: 1,
    name: value.name,
    sheets: value.sheets.map(sheet => {
      if (!text(sheet.id, 100)
        || !sheet.id
        || ids.has(sheet.id)
        || !Array.isArray(sheet.versions)
        || !sheet.versions.length
        || sheet.versions.length > 100) fail('INVALID_HISTORY');
      ids.add(sheet.id);
      return { id: sheet.id, present: sheet.present !== false, versions: sheet.versions.map(validateSheet) };
    })
  };
}
const key = s => `${s.discipline.toLocaleLowerCase()}\u0000${s.number.toLocaleLowerCase()}`;

export function revisionPreview(manifest, incoming) {
  manifest = validateManifest(manifest);
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 5000) fail('INVALID_PACKAGE');
  incoming = incoming.map(validateSheet);
  const counts = new Map();
  for (const sheet of incoming) counts.set(key(sheet), (counts.get(key(sheet)) || 0) + 1);
  return incoming.map((sheet, index) => {
    const matches = manifest.sheets.filter(s => key(s.versions.at(-1)) === key(sheet)).map(s => s.id);
    return {
      index,
      sheet,
      matches,
      status: counts.get(key(sheet)) > 1 ? 'duplicate' : matches.length > 1 ? 'ambiguous' : matches.length ? 'matched' : 'added'
    };
  });
}

export function commitRevision(manifest, incoming, resolutions) {
  const preview = revisionPreview(manifest, incoming),
    out = validateManifest(manifest),
    used = new Set(),
    report = { added: [], removed: [], replaced: [], unmatched: [], unchanged: [] };
  if (!Array.isArray(resolutions) || resolutions.length !== preview.length) fail('RESOLVE_ALL_SHEETS');
  for (const row of preview) {
    const target = resolutions[row.index];
    if (target === 'ignore') {
      report.unmatched.push(row.sheet.number);
      continue;
    }
    if (target === 'new') {
      const id = crypto.randomUUID();
      out.sheets.push({ id, present: true, versions: [row.sheet] });
      used.add(id);
      report.added.push(row.sheet.number);
      continue;
    }
    const sheet = out.sheets.find(s => s.id === target);
    if (!sheet || used.has(target)) fail('DUPLICATE_TARGET');
    used.add(target);
    sheet.present = true;
    const old = sheet.versions.at(-1);
    if (JSON.stringify(old) === JSON.stringify(row.sheet)) {
      report.unchanged.push(row.sheet.number);
      continue;
    }
    if (sheet.versions.length >= 100) fail('HISTORY_LIMIT');
    sheet.versions.push(row.sheet);
    report.replaced.push(row.sheet.number);
  }
  for (const sheet of out.sheets) if (!used.has(sheet.id)) {
    if (sheet.present) report.removed.push(sheet.versions.at(-1).number);
    sheet.present = false;
  }
  return { manifest: validateManifest(out), report };
}
const supported = new Set(['box', 'circle', 'line', 'arrow', 'polygon', 'comment']);

export function transferPreview(annotations, { source, target, mapPoint, dx = 0, dy = 0, prefix }) {
  if (![dx, dy].every(Number.isFinite) || typeof prefix !== 'string') fail('INVALID_ALIGNMENT');
  const ids = new Map(annotations.map(a => [a.id, `${prefix}:${a.id}`]));
  const point = (x, y) => {
    const p = mapPoint(x, y);
    return { x: p.x + dx, y: p.y + dy };
  };
  return annotations.map(original => {
    if (!supported.has(original.type) || original.rotation || original.inReplyTo || original.points?.some(p => p.bulge || p.arc)) return { sourceId: original.id, status: 'unsupported', annotation: null };
    const a = copy(original);
    a.id = ids.get(original.id);
    a.page = target.page;
    delete a.layer;
    let points = [];
    if (['line', 'arrow'].includes(a.type)) {
      const start = point(a.startX, a.startY),
        end = point(a.endX, a.endY);
      Object.assign(a, { startX: start.x, startY: start.y, endX: end.x, endY: end.y });
      points = [start, end];
    } else if (a.type === 'polygon') {
      if (!Array.isArray(a.points) || a.points.length < 3) return { sourceId: original.id, status: 'unsupported', annotation: null };
      a.points = a.points.map(p => point(p.x, p.y));
      points = a.points;
    } else {
      if (![a.x, a.y, a.width, a.height].every(Number.isFinite)) return { sourceId: original.id, status: 'unsupported', annotation: null };
      points = [point(a.x, a.y), point(a.x + a.width, a.y), point(a.x, a.y + a.height), point(a.x + a.width, a.y + a.height)];
      a.x = Math.min(...points.map(p => p.x));
      a.y = Math.min(...points.map(p => p.y));
      a.width = Math.max(...points.map(p => p.x)) - a.x;
      a.height = Math.max(...points.map(p => p.y)) - a.y;
    }
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail('INVALID_GEOMETRY');
    if (a.replies) a.replies = a.replies.map((r, i) => ({ ...r, id: `${a.id}:reply:${i}`, inReplyTo: a.id }));
    const outside = points.some(p => p.x < 0 || p.y < 0 || p.x > target.width || p.y > target.height);
    const changed = source.width !== target.width || source.height !== target.height || source.rotation !== target.rotation || dx !== 0 || dy !== 0;
    return {
      sourceId: original.id,
      sourceAnnotation: copy(original),
      status: outside ? 'outside' : changed ? 'review' : 'ready',
      annotation: a
    };
  });
}
