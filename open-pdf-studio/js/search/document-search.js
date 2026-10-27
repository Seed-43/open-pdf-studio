// Sequential, bounded search. Adapters own PDF parsing and document lifetime.
export function validateSearch(request) {
  if (!request || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500)
    throw new Error('INVALID_QUERY');
  if (!['active', 'open', 'folder'].includes(request.scope || 'open')) throw new Error('INVALID_SCOPE');
  if (request.scope === 'folder' && (typeof request.folder !== 'string' || !request.folder)) throw new Error('INVALID_FOLDER');
  return { ...request, scope: request.scope || 'open', limit: Math.min(2000, Math.max(1, Math.floor(Number(request.limit) || 500))) };
}

export async function searchDocuments(request, adapter, { signal, onProgress = () => {} } = {}) {
  const options = validateSearch(request);
  const report = { query: options.query, files: [], matches: [], cancelled: false, truncated: false };
  const stopped = () => signal?.aborted;
  const sources = await adapter.sources(options);
  for (const source of sources) {
    if (stopped()) break;
    const file = { id: source.id, path: source.path, name: source.name, status: 'searching', pages: 0, matches: 0, unsearchablePages: [] };
    report.files.push(file);
    let handle;
    try {
      handle = await adapter.open(source, signal);
      const revision = handle.revision();
      file.revision = revision;
      Object.assign(file, handle.metadata || {});
      for (let page = 1; page <= handle.pages; page++) {
        if (stopped()) break;
        const result = await handle.search(page, options);
        if (stopped()) break;
        if (handle.revision() !== revision) throw new Error('DOCUMENT_CHANGED');
        if (!result.hasText) file.unsearchablePages.push(page);
        file.pages++;
        for (const match of result.matches) {
          if (report.matches.length >= options.limit) { report.truncated = true; break; }
          report.matches.push({ ...match, documentId: source.id, path: source.path, name: source.name, revision });
          file.matches++;
        }
        onProgress(structuredClone(report));
        if (report.truncated) break;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      file.status = stopped() ? 'cancelled' : report.truncated ? 'limited' : file.unsearchablePages.length ? 'needs_ocr' : 'complete';
    } catch (error) {
      file.status = stopped() ? 'cancelled' : error?.name === 'PasswordException' ? 'encrypted' : error?.message === 'DOCUMENT_CHANGED' ? 'changed' : 'unreadable';
      file.error = String(error?.message || error);
      // Do not publish potentially stale hits after a document changes mid-run.
      if (file.status === 'changed') { report.matches = report.matches.filter(m => m.documentId !== source.id); file.matches = 0; }
    } finally {
      try { await handle?.close(); }
      catch (error) { file.cleanupError = String(error?.message || error); }
    }
    onProgress(structuredClone(report));
    if (report.truncated) break;
  }
  report.cancelled = !!stopped();
  return report;
}
