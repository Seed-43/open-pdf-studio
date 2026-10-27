// The document feature calls of the extension API (searchDocuments …
// approvalRouting) follow the documented error contract: they resolve to
// { ok: true, ... } or { ok: false, code, message } and never throw.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');

const FEATURE_CALLS = [
  'searchDocuments', 'locations', 'hiddenInformation', 'printPreflight', 'reviewOcr', 'portfolio',
  'recognizeForm', 'searchSymbols', 'workbookBindings', 'documentWorkflows', 'drawingSets', 'sheetLinks',
  'approvalRouting',
];

test('a failing feature call resolves to { ok: false, code, message }', async () => {
  globalThis.__actiefDocument = null;
  const api = createPluginApi('nl.test.features');
  const result = await api.locations({ action: 'list' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_DOCUMENT');
  assert.equal(typeof result.message, 'string');
  const invalid = await api.hiddenInformation({ action: 'nonsense' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_ACTION');
});

test('a successful feature call resolves to { ok: true, ... }', async () => {
  globalThis.__actiefDocument = { id: 'doc-1', annotations: [], pdfDoc: { numPages: 0 }, _annotationPagesReady: new Set() };
  try {
    const api = createPluginApi('nl.test.features-ok');
    const result = await api.locations();
    assert.equal(result.ok, true);
    assert.equal(result.documentId, 'doc-1');
    assert.deepEqual(result.zones, []);
  } finally {
    globalThis.__actiefDocument = null;
  }
});

test('after cleanup every feature call resolves to EXTENSION_INACTIVE', async () => {
  const api = createPluginApi('nl.test.features-closed');
  api._cleanup();
  for (const name of FEATURE_CALLS) {
    const result = await api[name]({ action: 'list' });
    assert.equal(result.ok, false, name);
    assert.equal(result.code, 'EXTENSION_INACTIVE', name);
  }
});

test('the feature calls sit apart from the view navigation block', () => {
  const source = readFileSync(new URL('./plugin-api.js', import.meta.url), 'utf8');
  const comment = source.indexOf('// --- View navigation and selection (#557) ---');
  const navigate = source.indexOf('navigateToPage(request) {');
  assert.ok(comment > 0 && navigate > comment);
  for (const name of FEATURE_CALLS) {
    const at = source.indexOf(`${name}(`, source.indexOf('// --- Document features'));
    assert.ok(at > 0, name);
    assert.ok(at < comment || at > navigate, `${name} is not between the navigation comment and its calls`);
  }
});
