import { state } from '../core/state.js';
import { documentRevisie } from '../core/undo-manager.js';
import { validateIndex, safePath, findReferences, textReferenceRect, overlap, writeLinks, sha256 } from './model.js';
import { zipStore } from '../bcf/bcf-zip.js';

const sessions = new Map();
let scanController = null;

function openDocs() {
  return state.documents.filter(d => d.pdfDoc);
}

export async function captureLinkIndex() {
  const files = [],
    index = [];
  for (const doc of openDocs()) {
    if (files.length >= 50) throw new Error('FILE_LIMIT');
    const path = (doc.saveTargetPath || doc.filePath || '').split(/[\\/]/).pop();
    if (!safePath(path)) throw new Error('SAVE_SOURCES_FIRST');
    const labels = await doc.pdfDoc.getPageLabels();
    files.push({ documentId: doc.id, path, pageCount: doc.pdfDoc.numPages, modified: !!doc.modified });
    for (let page = 1; page <= doc.pdfDoc.numPages; page++) {
      if (index.length >= 500) throw new Error('PAGE_LIMIT');
      index.push({
        id: `${doc.id}:${page}`,
        path,
        page,
        label: labels?.[page - 1] || `${path.replace(/\.pdf$/i, '')}-${page}`,
        region: null
      });
    }
  }
  return { files, index };
}

export async function scanSheetLinks({ files, index, prefix = '', caseSensitive = false }) {
  if (scanController) throw new Error('SCAN_BUSY');
  index = validateIndex(index);
  if (!Array.isArray(files) || !files.length || files.length > 50) throw new Error('INVALID_FILES');
  const names = new Set(),
    snapshots = [];
  let totalBytes = 0,
    totalPages = 0;
  for (const file of files) {
    if (!safePath(file.path) || names.has(file.path.toLowerCase())) throw new Error('DUPLICATE_PATH');
    names.add(file.path.toLowerCase());
    const doc = openDocs().find(d => d.id === file.documentId);
    if (!doc) throw new Error('SOURCE_CLOSED');
    if (doc.modified || Object.values(doc.pageRotations || {}).some(Boolean)) throw new Error('SAVE_SOURCES_FIRST');
    totalPages += doc.pdfDoc.numPages;
    if (totalPages > 100) throw new Error('PAGE_LIMIT');
    snapshots.push({ doc, pdf: doc.pdfDoc, path: file.path, revision: documentRevisie(doc) });
  }
  const check = () => {
    for (const s of snapshots) if (!state.documents.includes(s.doc)
      || s.doc.pdfDoc !== s.pdf
      || documentRevisie(s.doc) !== s.revision
      || s.doc.modified
      || Object.values(s.doc.pageRotations || {}).some(Boolean)) throw new Error('SOURCE_CHANGED');
  };
  for (const row of index) {
    const source = snapshots.find(s => s.path === row.path);
    if (!source || row.page > source.pdf.numPages) throw new Error('BROKEN_TARGET');
    if (row.region) {
      const page = await source.pdf.getPage(row.page),
        box = page.view;
      if (row.region[0] < box[0] || row.region[1] < box[1] || row.region[2] > box[2] || row.region[3] > box[3]) throw new Error('REGION_OUTSIDE_PAGE');
    }
  }
  scanController = new AbortController();
  const signal = scanController.signal;
  const hits = [];
  try {
    for (const source of snapshots) {
      const { getCachedPdfBytes } = await import('../pdf/loader.js');
      source.bytes = (getCachedPdfBytes(source.doc.saveTargetPath || source.doc.filePath) || (await source.pdf.getData())).slice();
      totalBytes += source.bytes.length;
      if (totalBytes > 250 * 1024 * 1024) throw new Error('SIZE_LIMIT');
      source.hash = await sha256(source.bytes);
      check();
      for (let page = 1; page <= source.pdf.numPages; page++) {
        if (signal.aborted) throw new Error('CANCELLED');
        check();
        const pdfPage = await source.pdf.getPage(page),
          text = await pdfPage.getTextContent(),
          annotations = await pdfPage.getAnnotations(),
          existing = annotations.filter(a => a.subtype === 'Link').map(a => a.rect);
        for (const item of text.items) {
          if (typeof item.str !== 'string' || !item.str || !item.transform || item.width <= 0) continue;
          for (const found of findReferences(item.str, index, { prefix, caseSensitive })) {
            if (hits.length >= 2000) throw new Error('HIT_LIMIT');
            const rect = textReferenceRect(item, found.start, found.end);
            if (!rect.every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) continue;
            hits.push({
              ...found,
              id: String(hits.length),
              source: source.path,
              page,
              rect,
              existing: existing.some(box => overlap(box, rect)),
              approximate: found.start !== 0 || found.end !== item.str.length
            });
          }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    check();
    const id = crypto.randomUUID();
    sessions.set(id, { index, snapshots, check, hits, expires: Date.now() + 20 * 60 * 1000 });
    while (sessions.size > 3) sessions.delete(sessions.keys().next().value);
    return {
      id,
      hits: structuredClone(hits),
      index: structuredClone(index),
      files: snapshots.map(s => ({ path: s.path, hash: s.hash })),
      textOnly: true
    };
  } finally {
    scanController = null;
  }
}

function sessionFor(id) {
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) throw new Error('SCAN_EXPIRED');
  session.check();
  return session;
}

export async function renderLinkPreview(id, hitId, targetId, side, canvas) {
  const s = sessionFor(id),
    hit = s.hits.find(h => h.id === hitId),
    target = s.index.find(t => t.id === targetId);
  if (!hit || side === 'target' && !target) throw new Error('TARGET_REQUIRED');
  const file = s.snapshots.find(f => f.path === (side === 'source' ? hit.source : target.path)),
    page = await file.pdf.getPage(side === 'source' ? hit.page : target.page),
    base = page.getViewport({ scale: 1 }),
    viewport = page.getViewport({ scale: Math.min(1, 900 / Math.max(base.width, base.height)) });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  const rect = side === 'source' ? hit.rect : target.region;
  if (rect) {
    const r = [...viewport.convertToViewportPoint(rect[0], rect[1]), ...viewport.convertToViewportPoint(rect[2], rect[3])];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1]));
    ctx.restore();
  }
  s.check();
}

export async function exportLinkedPackage({ id, selections, replaceExisting = false }) {
  const session = sessionFor(id);
  if (!Array.isArray(selections) || !selections.length || selections.length > 2000) throw new Error('SELECT_LINKS');
  const used = new Set(),
    links = [];
  for (const choice of selections) {
    const hit = session.hits.find(h => h.id === choice.hitId),
      target = session.index.find(t => t.id === choice.targetId);
    if (!hit || !target || used.has(hit.id)) throw new Error('INVALID_SELECTION');
    used.add(hit.id);
    links.push({ source: hit.source, page: hit.page, rect: hit.rect, target });
  }
  const entries = [],
    report = [];
  for (const file of session.snapshots) {
    session.check();
    const selected = links.filter(l => l.source === file.path),
      result = selected.length ? await writeLinks(file.bytes, file.path, selected, { replaceExisting }) : { bytes: file.bytes, added: 0, skipped: 0, replaced: 0 };
    entries.push({ name: file.path, data: result.bytes });
    report.push({
      path: file.path,
      sourceHash: file.hash,
      outputHash: await sha256(result.bytes),
      added: result.added,
      skipped: result.skipped,
      replaced: result.replaced
    });
  }
  session.check();
  entries.push({ name: 'sheet-link-report.json', data: JSON.stringify({ version: 1, report, links }, null, 2) });
  return { bytes: zipStore(entries), report };
}

export async function sheetLinkRequest(request) {
  if (request.action === 'index') return captureLinkIndex();
  if (request.action === 'scan') return scanSheetLinks(request);
  if (request.action === 'cancel') {
    scanController?.abort();
    return { cancelled: !!scanController };
  }
  if (request.action === 'export') {
    const { isTauri, fileExists, writeBinaryFileNew } = await import('../core/platform.js');
    if (!isTauri() || typeof request.outputPath !== 'string' || !request.outputPath.toLowerCase().endsWith('.zip')) throw new Error('DESKTOP_ZIP_PATH_REQUIRED');
    if (await fileExists(request.outputPath)) throw new Error('OUTPUT_EXISTS');
    const { bytes, report } = await exportLinkedPackage(request);
    await writeBinaryFileNew(request.outputPath, bytes);
    return { path: request.outputPath, report };
  }
  throw new Error('INVALID_ACTION');
}
