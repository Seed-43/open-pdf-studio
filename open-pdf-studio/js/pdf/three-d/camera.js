// Camera maths for 3D views, kept free of three.js so it can be tested.
//
// /C2W (ISO 32000-1 section 13.6.4) is a 12-number matrix stored column by
// column: the camera's x axis, its y axis and its viewing direction in world
// space, then the camera position. The viewer reads the x column as "left"
// and the y column as "up", the convention this viewer was written and
// tried against exported building models with.

const vec = (a, i) => [a[i], a[i + 1], a[i + 2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Vertical field of view in degrees for a perspective view whose /FOV is
 * measured along `binding` ('W', 'H', 'Min', 'Max') of a viewport with this
 * aspect ratio (width / height).
 */
export function verticalFov(fov, binding, aspect) {
  const f = fov > 0 && fov < 180 ? fov : 30;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const alongWidth = binding === 'W' || (binding === 'Min' && a <= 1) || (binding === 'Max' && a > 1);
  if (!alongWidth) return f;
  const t = Math.tan((f * Math.PI) / 360) / a;
  return (Math.atan(t) * 360) / Math.PI;
}

/**
 * Where the camera of a view sits and looks.
 * @param {{c2w:number[]|null, co:number, ortho:boolean, fov:number, fovBinding?:string}} view
 * @param {{center:number[], radius:number}} sphere bounding sphere of the model
 * @param {number} aspect viewport width / height
 * @returns {null | { ortho, position, up, target, fov, halfHeight, near, far }}
 *   null when the view has no usable matrix (the viewer then fits the model).
 *   halfHeight is the half height of an orthographic frustum that shows the
 *   whole model; fov is the vertical field of view of a perspective camera.
 */
export function cameraForView(view, sphere, aspect) {
  const c = view?.c2w;
  if (!c || c.length < 12 || !c.every(Number.isFinite)) return null;
  const up = vec(c, 3), fwd = vec(c, 6), position = vec(c, 9);
  if (len(up) < 1e-12 || len(fwd) < 1e-12) return null;
  const f = norm(fwd);
  const r = Math.max(sphere.radius, 1e-6);
  const toCenter = Math.hypot(...position.map((p, i) => p - sphere.center[i]));
  const dist = view.co > 0 ? view.co : toCenter;
  const target = position.map((p, i) => p + f[i] * dist);
  const a = aspect > 0 ? aspect : 1;
  let eye = position, far = Math.max(r * 200, toCenter + r * 4);
  if (view.ortho) {
    // An orthographic image does not depend on how far back the camera is,
    // but the near plane does: step back along the view direction until the
    // whole model lies in front of the camera.
    const ahead = f.reduce((s, fi, i) => s + fi * (target[i] - sphere.center[i]), 0);
    const back = 2 * r + Math.max(0, ahead);
    eye = target.map((t, i) => t - f[i] * back);
    far = back + Math.abs(ahead) + r * 4;
  }
  return {
    ortho: !!view.ortho,
    position: eye,
    up: norm(up),
    target,
    fov: view.ortho ? 30 : verticalFov(view.fov, view.fovBinding || 'W', a),
    halfHeight: (a >= 1 ? r : r / a) * 1.05,
    near: r / 2000,
    far,
  };
}

/**
 * The camera as a /3DView would store it (inverse of cameraForView): the
 * camera's world matrix (three.js column-major elements) to /C2W.
 */
export function c2wFromMatrix(e) {
  const right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], back = [e[8], e[9], e[10]];
  return [-right[0], -right[1], -right[2], ...up, -back[0], -back[1], -back[2], e[12], e[13], e[14]];
}
