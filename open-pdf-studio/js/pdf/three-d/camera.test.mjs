// Camera of a 3D view (#599): /C2W, /CO and the projection to camera
// position, target, up vector and field of view, and back.
import assert from 'node:assert/strict';
import test from 'node:test';

import { cameraForView, verticalFov, c2wFromMatrix } from './camera.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearVec = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => near(v, b[i], eps));
const sphere = { center: [0, 0, 0], radius: 2 };

test('a field of view along the width becomes the vertical one', () => {
  assert.ok(near(verticalFov(40, 'H', 2), 40));
  // tan(v/2) = tan(w/2) / aspect
  const v = verticalFov(60, 'W', 2);
  assert.ok(near(Math.tan((v * Math.PI) / 360), Math.tan(Math.PI / 6) / 2));
  assert.ok(near(verticalFov(60, 'W', 1), 60));
  // Min and Max pick the shorter or longer side.
  assert.ok(near(verticalFov(50, 'Min', 2), 50));
  assert.ok(near(verticalFov(50, 'Max', 2), verticalFov(50, 'W', 2)));
  assert.ok(near(verticalFov(50, 'Min', 0.5), verticalFov(50, 'W', 0.5)));
  assert.ok(near(verticalFov(50, 'Max', 0.5), 50));
  // Nonsense falls back to 30 degrees and a square viewport.
  assert.ok(near(verticalFov(0, 'H', 1), 30));
  assert.ok(near(verticalFov(400, 'W', NaN), 30));
});

test('perspective view: position, target at the orbit distance, up and fov', () => {
  // Camera at (0,-10,0) looking along +y with z up.
  const view = { c2w: [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0, -10, 0], co: 8, fov: 30, fovBinding: 'H', ortho: false };
  const cam = cameraForView(view, sphere, 1.5);
  assert.equal(cam.ortho, false);
  assert.deepEqual(cam.position, [0, -10, 0]);
  assert.ok(nearVec(cam.target, [0, -2, 0]));
  assert.ok(nearVec(cam.up, [0, 0, 1]));
  assert.ok(near(cam.fov, 30));
  assert.ok(cam.far > 10 + 2);
  // Without /CO the target is as far away as the model's centre.
  const noCo = cameraForView({ ...view, co: 0 }, sphere, 1.5);
  assert.ok(nearVec(noCo.target, [0, 0, 0]));
});

test('orthographic view steps back until the model is in front of the camera', () => {
  // Camera inside the model, looking down -z.
  const view = { c2w: [-1, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1], co: 1, ortho: true };
  const cam = cameraForView(view, sphere, 2);
  assert.equal(cam.ortho, true);
  assert.ok(nearVec(cam.target, [0, 0, 0]));
  assert.ok(cam.position[2] - cam.near >= sphere.radius, 'nearest point of the model lies past the near plane');
  assert.ok(cam.position[2] + sphere.radius <= cam.far, 'farthest point lies before the far plane');
  assert.ok(near(cam.halfHeight, 2 * 1.05));
  // A tall viewport needs a taller frustum to fit the width.
  assert.ok(near(cameraForView(view, sphere, 0.5).halfHeight, 4 * 1.05));
});

test('views without a usable matrix are left to the fit', () => {
  assert.equal(cameraForView({ c2w: null }, sphere, 1), null);
  assert.equal(cameraForView({ c2w: [1, 2, 3] }, sphere, 1), null);
  assert.equal(cameraForView({ c2w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, sphere, 1), null);
  assert.equal(cameraForView({ c2w: [1, 0, 0, 0, 1, 0, 0, 0, 1, NaN, 0, 0] }, sphere, 1), null);
  assert.equal(cameraForView(undefined, sphere, 1), null);
});

test('a camera matrix turns back into the /C2W it came from', () => {
  const c2w = [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0, -10, 0];
  // three.js world matrix of that camera: x right (= -left), y up, z back (= -forward).
  const e = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, -10, 0, 1];
  assert.deepEqual(c2wFromMatrix(e).map(v => v + 0), c2w);
});
