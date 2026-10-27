// Draw data from a decoded U3D scene (#599): one geometry per mesh
// resource shared by its model nodes, an instance per parent, faces ordered
// by shading group, each buffer transferred once, parent loops broken.
import assert from 'node:assert/strict';
import test from 'node:test';

import { readU3D } from './u3d-reader.js';
import { buildDrawData, orderByGroup } from './u3d-scene.js';
import { buildBoxU3D } from './u3d-fixture.testhulp.mjs';

test('draw data shares one geometry and gives every parent its own instance', () => {
  const draw = buildDrawData(readU3D(buildBoxU3D()));
  assert.equal(draw.resources.length, 1);
  assert.deepEqual(draw.models.map(m => `${m.name}<${m.parent}`), ['Box<Building', 'Box2<Building', 'Box2<Annex']);
  assert.ok(draw.models.every(m => m.resource === 0));
  assert.equal(draw.triangles, 36);
  assert.deepEqual(draw.resources[0].ranges, [{ start: 0, count: 12, group: 0 }, { start: 12, count: 24, group: 1 }]);
  assert.deepEqual(draw.models[0].materials.map(m => m.color), [[1, 0, 0], [0, 0, 1]]);
  // Each buffer is transferred once, even though three models use it.
  assert.equal(new Set(draw.transfer).size, draw.transfer.length);
  assert.equal(draw.transfer.length, 2);
});

test('faces are ordered by shading group, stable within a group', () => {
  const { indices, ranges } = orderByGroup(
    new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    new Uint32Array([7, 2, 7, 2]),
  );
  assert.deepEqual(Array.from(indices), [3, 4, 5, 9, 10, 11, 0, 1, 2, 6, 7, 8]);
  assert.deepEqual(ranges, [{ start: 0, count: 6, group: 2 }, { start: 6, count: 6, group: 7 }]);
});

test('a parent chain that loops hangs off the root instead', () => {
  const scene = {
    header: {}, skipped: 0, models: new Map(), meshes: new Map(), shaders: new Map(), materials: new Map(),
    groups: new Map([
      ['A', { parents: [{ name: 'B' }] }],
      ['B', { parents: [{ name: 'A' }] }],
      ['C', { parents: [{ name: 'D' }] }],
      ['D', { parents: [{ name: '' }] }],
    ]),
  };
  const groups = buildDrawData(scene).groups;
  assert.deepEqual(groups.map(g => `${g.name}<${g.parent}`), ['A<', 'B<', 'C<D', 'D<']);
});
