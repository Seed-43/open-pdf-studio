// U3D decoder (#599): reads files written by the independent writer in
// u3d-fixture.testhulp.mjs, and survives damaged input: truncated, garbled
// and hostile streams must end quickly with a skipped block or a U3DError,
// never with a hang or a huge allocation.
import assert from 'node:assert/strict';
import test from 'node:test';

import { readU3D, U3DError, DynamicHistogram, MAX_TRIANGLES } from './u3d-reader.js';
import { buildBoxU3D, BitWriter, block } from './u3d-fixture.testhulp.mjs';

const BOX_INDICES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

test('reads the box model: nodes, mesh, faces and shading groups', () => {
  const scene = readU3D(buildBoxU3D());
  assert.equal(scene.skipped, 0);
  assert.deepEqual([...scene.groups.keys()], ['Building', 'Annex']);
  assert.deepEqual([...scene.models.keys()], ['Box', 'Box2']);
  assert.equal(scene.models.get('Box').resource, 'BoxMesh');
  assert.deepEqual(scene.models.get('Box2').parents.map(p => p.name), ['Building', 'Annex']);
  assert.deepEqual(scene.models.get('Box2').parents[0].matrix.slice(12, 15), [3, 0, 0]);
  assert.deepEqual(scene.models.get('Box').shaders, [['RedShader'], ['BlueShader']]);
  assert.equal(scene.shaders.get('BlueShader'), 'Blue');
  assert.deepEqual(scene.materials.get('Red').diffuse, [1, 0, 0]);
  const mesh = scene.meshes.get('BoxMesh');
  assert.equal(mesh.groups.length, 2);
  assert.deepEqual(Array.from(mesh.positions.slice(18, 21)), [1, 1, 1]);
  assert.deepEqual(Array.from(mesh.indices), BOX_INDICES);
  assert.deepEqual(Array.from(mesh.faceGroups), [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(scene.triangles, 12);
});

test('face indices of a mesh with many positions are read as plain U32 values', () => {
  const scene = readU3D(buildBoxU3D({ extraPositions: 20000 }));
  assert.equal(scene.skipped, 0);
  const mesh = scene.meshes.get('BoxMesh');
  assert.equal(mesh.positions.length / 3, 20008);
  assert.deepEqual(Array.from(mesh.indices), BOX_INDICES);
});

test('the dynamic histogram agrees with a plain cumulative count, through rescaling', () => {
  const h = new DynamicHistogram();
  const plain = [1];
  let total = 1;
  const addPlain = (sym) => {
    if (sym > 0xffff) return;
    if (total >= 0x1fff) {
      let t = 0;
      for (let i = 0; i < plain.length; i++) { plain[i] >>= 1; t += plain[i]; }
      plain[0] += 1;
      total = t + 1;
    }
    while (plain.length <= sym) plain.push(0);
    plain[sym]++;
    total++;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 20000; n++) {
    const sym = rnd() < 0.05 ? Math.floor(rnd() * 70000) : Math.floor(rnd() * 5);
    h.add(sym);
    addPlain(sym);
    if (n % 997 === 0) {
      assert.equal(h.total, total);
      for (let target = 0; target < total; target += Math.max(1, Math.floor(total / 37))) {
        let acc = 0, s = 0;
        while (acc + plain[s] <= target) acc += plain[s++];
        assert.deepEqual(h.find(target), [s, acc, acc + plain[s]]);
      }
    }
  }
  assert.throws(() => h.find(h.total), U3DError);
});

test('not U3D data is rejected', () => {
  assert.throws(() => readU3D(new Uint8Array(0)), U3DError);
  assert.throws(() => readU3D(new TextEncoder().encode('PRC data, not U3D at all')), U3DError);
  assert.throws(() => readU3D('U3D'), U3DError);
});

/** Run the reader and require it to finish quickly, with or without a U3DError. */
function survives(bytes, label) {
  const t0 = Date.now();
  let scene = null;
  try {
    scene = readU3D(bytes);
  } catch (e) {
    assert.ok(e instanceof U3DError, `${label}: unexpected ${e && e.name}: ${e && e.message}`);
  }
  assert.ok(Date.now() - t0 < 2000, `${label}: took ${Date.now() - t0} ms`);
  if (scene) {
    assert.ok(scene.triangles <= MAX_TRIANGLES);
    for (const m of scene.meshes.values()) {
      if (!m.indices) continue;
      const n = m.positions.length / 3;
      assert.ok(m.indices.every(i => i < n), `${label}: index out of range`);
      assert.equal(m.indices.length, m.faceGroups.length * 3);
    }
  }
  return scene;
}

test('fuzz: every truncation of the box file', () => {
  const good = buildBoxU3D();
  for (let n = 0; n < good.length; n++) survives(good.subarray(0, n), `cut at ${n}`);
  // A cut inside the base mesh keeps the faces that were complete.
  const cut = survives(good.subarray(0, good.length - 6), 'cut late');
  assert.ok(cut.skipped >= 1);
});

test('fuzz: garbled bytes, bit flips and random data', () => {
  const good = buildBoxU3D({ extraPositions: 40 });
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 1500; k++) {
    const bad = good.slice();
    const flips = 1 + Math.floor(rnd() * 8);
    for (let f = 0; f < flips; f++) {
      const at = 4 + Math.floor(rnd() * (bad.length - 4)); // keep the magic so the blocks are read
      bad[at] = rnd() < 0.5 ? bad[at] ^ (1 << Math.floor(rnd() * 8)) : Math.floor(rnd() * 256);
    }
    survives(bad, `garble ${k}`);
  }
  for (let k = 0; k < 200; k++) {
    const junk = new Uint8Array(16 + Math.floor(rnd() * 4000));
    for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rnd() * 256);
    junk.set([0x55, 0x33, 0x44, 0x00], 0);
    survives(junk, `random ${k}`);
  }
});

function u3dWith(...blocks) {
  const header = block(0x00443355, new Uint8Array(24));
  const parts = [header, ...blocks];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

test('hostile counts are refused before anything is allocated', () => {
  // A base mesh that claims four billion faces and positions in 40 bytes.
  const w = new BitWriter();
  w.string('M'); w.u32(0);
  w.u32(0xffffffff); w.u32(0xffffffff); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
  const scene = survives(u3dWith(block(0xffffff3b, w.bytes())), 'huge counts');
  assert.equal(scene.skipped, 1);
  assert.equal(scene.meshes.size, 0);

  // Faces whose indices cost no bits: one position, a billion faces.
  const w2 = new BitWriter();
  w2.string('M'); w2.u32(0);
  w2.u32(1e9); w2.u32(1); w2.u32(0); w2.u32(0); w2.u32(0); w2.u32(0);
  w2.f32(0); w2.f32(0); w2.f32(0);
  const s2 = survives(u3dWith(block(0xffffff3b, w2.bytes())), 'free faces');
  assert.equal(s2.meshes.get('M').indices.length, 0);

  // A node with four billion parents, a string longer than its block.
  const w3 = new BitWriter();
  w3.string('N'); w3.u32(0xffffffff);
  const w4 = new BitWriter();
  w4.u16(0xffff);
  const s3 = survives(u3dWith(block(0xffffff53, w3.bytes()), block(0xffffff54, w4.bytes())), 'huge lists');
  assert.equal(s3.skipped, 2);
});

test('a block size past the end of the file only ends the file', () => {
  const good = buildBoxU3D();
  const bad = good.slice();
  new DataView(bad.buffer).setUint32(4, 0xfffffff0, true); // header block size
  const scene = survives(bad, 'oversized block');
  assert.equal(scene.models.size, 0);
});
