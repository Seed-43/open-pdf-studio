// Decoded 3D models, kept while their document is open so going back to the
// 3D page (from a markup page, another page or another tab) does not decode
// the model again. At most two models are kept; entries of closed documents
// are dropped by pruneDecoded (called by the 3D view shell when the list of
// open documents changes).

const MAX_ENTRIES = 2;
const cache = new Map(); // key -> { docId, data }

export function decodedKey(docId, annot) {
  return `${docId}:${annot.page}:${(annot.rect || []).join(',')}`;
}

export function getDecoded(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key); // most recent last
  cache.set(key, hit);
  return hit.data;
}

export function putDecoded(key, docId, data) {
  cache.delete(key);
  cache.set(key, { docId, data });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

/** Drop the models of documents that are no longer open. */
export function pruneDecoded(openDocIds) {
  const open = new Set(openDocIds);
  for (const [key, hit] of cache) if (!open.has(hit.docId)) cache.delete(key);
}

export function decodedCount() {
  return cache.size;
}
