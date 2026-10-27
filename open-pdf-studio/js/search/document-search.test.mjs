import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDocuments, validateSearch } from './document-search.js';

function rig(files) {
  const closed = [];
  return { closed, adapter: {
    sources: async () => files.map((f, i) => ({ id: String(i), name: f.name || String(i), f })),
    open: async source => {
      const f = source.f;
      if (f.error) throw f.error;
      return { pages: f.pages || 1, revision: () => f.revision || 'r1', close: async () => closed.push(source.id),
        search: async (page, options) => { f.onPage?.(page); return { hasText: !f.scan, matches: f.scan ? [] : [{ pageNum: page, matchText: options.query }] }; } };
    },
  } };
}
test('files are grouped; encrypted/unreadable/scanned are not reported as no matches', async () => {
  const password = Object.assign(new Error('password'), { name: 'PasswordException' });
  const { adapter, closed } = rig([{ pages: 2 }, { error: password }, { error: new Error('bad PDF') }, { scan: true }]);
  const r = await searchDocuments({ query: 'water' }, adapter);
  assert.deepEqual(r.files.map(f => f.status), ['complete','encrypted','unreadable','needs_ocr']);
  assert.equal(r.matches.length, 2); assert.deepEqual(r.files[3].unsearchablePages, [1]); assert.deepEqual(closed, ['0','3']);
});
test('cancellation stops publication and releases the current document', async () => {
  const abort = new AbortController();
  const { adapter, closed } = rig([{ pages: 10, onPage: p => { if (p === 2) abort.abort(); } }, {}]);
  const r = await searchDocuments({ query: 'x' }, adapter, { signal: abort.signal });
  assert.equal(r.cancelled, true); assert.equal(r.matches.length, 1); assert.equal(r.files.length, 1); assert.deepEqual(closed, ['0']);
});
test('a mutation during extraction discards earlier hits for that document', async () => {
  const f = { pages: 3, onPage: p => { if (p === 2) f.revision = 'r2'; } };
  const { adapter } = rig([f]);
  const r = await searchDocuments({ query: 'x' }, adapter);
  assert.equal(r.files[0].status, 'changed'); assert.equal(r.matches.length, 0);
});
test('result cap is explicit and prevents opening further documents', async () => {
  const { adapter, closed } = rig([{ pages: 100 }, {}]);
  const r = await searchDocuments({ query: 'x', limit: 2 }, adapter);
  assert.equal(r.truncated, true); assert.equal(r.matches.length, 2); assert.equal(r.files.length, 1); assert.deepEqual(closed, ['0']);
});
test('repeat runs do not retain a stale index', async () => {
  const f = { scan: true }; const { adapter } = rig([f]);
  assert.equal((await searchDocuments({ query: 'x' }, adapter)).matches.length, 0);
  f.scan = false;
  assert.equal((await searchDocuments({ query: 'x' }, adapter)).matches.length, 1);
});
test('reject invalid queries/scopes before accessing documents', () => {
  for (const r of [{}, { query: ' ' }, { query: 'x', scope: 'network' }, { query: 'x', scope: 'folder' }]) assert.throws(() => validateSearch(r));
});
