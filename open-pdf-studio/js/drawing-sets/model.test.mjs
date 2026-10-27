import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, revisionPreview, commitRevision, transferPreview } from './model.js';

const sheet = (number, hash = 'a') => ({
  number,
  title: 'Plan',
  discipline: 'A',
  revision: '1',
  date: '2026-10-21',
  source: `revisions/${hash}.pdf`,
  hash: hash.repeat(64),
  page: 1,
  width: 600,
  height: 800,
  rotation: 0
});
const manifest = () => ({
  version: 1,
  name: 'Project',
  sheets: [{ id: 'one', present: true, versions: [sheet('A-101')] }, { id: 'two', present: true, versions: [sheet('A-102')] }]
});
test('portable history, explicit revision plan and complete package report', () => {
  const input = manifest(),
    before = JSON.stringify(input),
    incoming = [{ ...sheet('A-101', 'b'), revision: '2' }, sheet('A-103', 'c'), sheet('A-999', 'd')];
  assert.deepEqual(revisionPreview(input, incoming).map(r => r.status), ['matched', 'added', 'added']);
  const result = commitRevision(input, incoming, ['one', 'new', 'ignore']);
  assert.equal(result.manifest.sheets[0].versions.length, 2);
  assert.equal(result.manifest.sheets[1].present, false);
  assert.deepEqual(result.report, { added: ['A-103'], removed: ['A-102'], replaced: ['A-101'], unmatched: ['A-999'], unchanged: [] });
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(validateManifest(JSON.parse(JSON.stringify(result.manifest))), result.manifest);
  assert.throws(() => validateManifest({ ...input, sheets: [{ id: 'x', versions: [{ ...sheet('X'), source: '../escape.pdf' }] }] }));
});
test('duplicate sheet numbers and ambiguous old matches require explicit resolution', () => {
  const old = manifest();
  old.sheets.push({ id: 'three', versions: [sheet('A-101', 'b')] });
  assert.equal(revisionPreview(old, [sheet('A-101', 'c')])[0].status, 'ambiguous');
  assert.deepEqual(revisionPreview(manifest(), [sheet('X'), sheet('X', 'b')]).map(r => r.status), ['duplicate', 'duplicate']);
  assert.throws(() => commitRevision(manifest(), [sheet('X'), sheet('X', 'b')], ['one', 'one']), /DUPLICATE_TARGET/);
  assert.throws(() => commitRevision(manifest(), [sheet('X')], []), /RESOLVE_ALL/);
});
test('transfer maps geometry, flags uncertain/outside/unsupported and remaps replies', () => {
  const source = sheet('X'),
    target = { ...sheet('X', 'b'), width: 800, height: 600, rotation: 90, page: 2 };
  const original = [{
    id: 'box',
    type: 'box',
    page: 1,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    replies: [{ id: 'r', text: 'Keep this', author: 'A' }]
  }, { id: 'line', type: 'line', page: 1, startX: 0, startY: 0, endX: 600, endY: 800 }, { id: 'text', type: 'textbox', page: 1, x: 0, y: 0, width: 100, height: 20 }];
  const before = JSON.stringify(original),
    rows = transferPreview(original, { source, target, mapPoint: (x, y) => ({ x: 800 - y, y: x }), prefix: 'revision' });
  assert.equal(rows[0].status, 'review');
  assert.deepEqual([rows[0].annotation.x, rows[0].annotation.y, rows[0].annotation.width, rows[0].annotation.height], [740, 10, 40, 30]);
  assert.equal(rows[0].annotation.replies[0].inReplyTo, 'revision:box');
  assert.equal(rows[0].annotation.replies[0].text, 'Keep this');
  assert.equal(rows[2].status, 'unsupported');
  assert.equal(JSON.stringify(original), before);
  assert.equal(transferPreview(original, { source, target, mapPoint: (x, y) => ({ x, y }), dx: 1000, prefix: 'revision' })[0].status, 'outside');
});
