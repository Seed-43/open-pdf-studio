import { createSignal, createMemo, createEffect, For, Show, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// 3D PDF support. PDF.js draws only the poster image of a /3D annotation,
// so the app shows the live model itself: on the page, inside the
// annotation's rectangle (activated when the page opens), following
// scroll, pan and zoom. A button expands it to fill the document area.
// Preset views come from the PDF, the model tree has visibility toggles,
// and there are render modes and fit. The U3D model is decoded in a worker
// (js/pdf/three-d/u3d-worker.js) and drawn with three.js. This module and
// three.js are loaded by ThreeDLazy.jsx only for documents with 3D content.
import { paginaRectNaarClient } from '../../pdf/weergave-ruimte.js';
import { goToPage } from '../../pdf/renderer.js';
import { cameraForView, verticalFov, c2wFromMatrix } from '../../pdf/three-d/camera.js';
import { decodedKey, getDecoded, putDecoded } from '../../pdf/three-d/decoded-cache.js';

const [expanded, setExpanded] = createSignal(null);   // annot shown full-area
const [deactivated, setDeactivated] = createSignal(new Set()); // annot keys showing the poster

const activeDoc = () => state.documents[state.activeDocumentIndex];
const annotsOnPage = () => {
  const d = activeDoc();
  return (d?.threeD || []).filter(a => a.page === d.currentPage);
};
// Pointer and menu events inside the 3D area belong to the 3D view: the
// app's document-level handlers (page context menu, annotation tools) must
// not see them, or a right-drag pan would also open the page menu. Native
// listeners, so they run before the document's; clicks are left alone.
const OWN_EVENTS = ['contextmenu', 'pointerdown', 'mousedown', 'wheel', 'dblclick'];
function keepEventsInside(el) {
  const stop = (e) => {
    e.stopPropagation();
    if (e.type === 'contextmenu') e.preventDefault();
  };
  for (const type of OWN_EVENTS) el.addEventListener(type, stop);
  onCleanup(() => { for (const type of OWN_EVENTS) el.removeEventListener(type, stop); });
}

const annotKey = (a) => `${activeDoc()?.id}:${a.page}:${(a.rect || []).join(',')}`;

// Annotation /Rect (PDF user space) -> page space as drawn (top-left origin,
// scale 1, page /Rotate applied), the space paginaRectNaarClient expects.
async function viewRectOf(doc, annot) {
  if (annot._viewRect) return annot._viewRect;
  const page = await doc.pdfDoc.getPage(annot.page);
  const vp = page.getViewport({ scale: 1 });
  const [x1, y1, x2, y2] = annot.rect || page.view;
  const a = vp.convertToViewportPoint(x1, y1), b = vp.convertToViewportPoint(x2, y2);
  annot._viewRect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
  return annot._viewRect;
}

// Text printed above the 3D area (sheet title on the left, export or print
// date on the right), shown docked under the 3D toolbar so it stays readable
// while the page is panned. Text runs may be rotated in PDF space (sheets
// stored unrotated with /Rotate 90), so boxes come from the run direction.
async function headerTextsOf(doc, annot) {
  if (annot._header) return annot._header;
  const rect = await viewRectOf(doc, annot);
  const page = await doc.pdfDoc.getPage(annot.page);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const left = [], right = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const rl = Math.hypot(a, b) || 1, ul = Math.hypot(c, d) || 1, h = it.height || ul;
    const pts = [[e, f], [e + (a / rl) * it.width, f + (b / rl) * it.width],
      [e + (c / ul) * h, f + (d / ul) * h]].map(([x, y]) => vp.convertToViewportPoint(x, y));
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys), text: it.str.trim() };
    if (box.y2 > rect.y + 1) continue; // only text above the 3D area
    ((box.x + box.x2) / 2 < vp.width / 2 ? left : right).push(box);
  }
  const join = (bs) => bs.sort((p, q) => p.y - q.y || p.x - q.x).map(q => q.text).join(' ').replace(/\s+/g, ' ').trim();
  annot._header = { left: join(left), right: join(right) };
  return annot._header;
}

// 3D markup pages (three-d/snapshot-page.js) of the active document, and
// the one shown now if any.
const snapshots = () => activeDoc()?.threeDSnapshots || [];
const currentSnapshot = () => snapshots().find(s => s.page === activeDoc()?.currentPage) || null;

export function ThreeDSnapshotBar() {
  const { t } = useTranslation('common');
  const tx = (k, f, o) => t(`threeD.${k}`, { defaultValue: f, ...o });
  return (
    <Show when={currentSnapshot()} keyed>
      {(snap) => (
        <div class="pdfa-bar threed-snapshot-bar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
            <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z" /><path d="M2.5 4.5L8 7.5l5.5-3M8 7.5v7" />
          </svg>
          <span>{tx('snapshotBar', '3D markup page: {{name}}', { name: snap.name })}</span>
          <button class="pdfa-bar-action" onClick={() => goToPage(snap.sourcePage || 1)}>
            {tx('backTo3D', 'Back to 3D model')}
          </button>
        </div>
      )}
    </Show>
  );
}

export default function ThreeDView() {
  // The expanded viewer belongs to one document and page: switching tabs or
  // pages (or closing the tab) puts it back.
  const expandedHere = () => {
    const a = expanded();
    return a && annotsOnPage().includes(a) ? a : null;
  };
  createEffect(() => { if (expanded() && !expandedHere()) setExpanded(null); });
  return (
    <>
      <Show when={expandedHere()} keyed>
        {(annot) => <ThreeDViewer annot={annot} onClose={() => setExpanded(null)} onToggleSize={() => setExpanded(null)} />}
      </Show>
      <Show when={!expandedHere()}>
        <For each={annotsOnPage()}>{(annot) => <InlineHost annot={annot} />}</For>
      </Show>
    </>
  );
}

// Keeps a fixed-position box over the annotation's rectangle on screen,
// clipped to the document area, re-measured every animation frame while
// the 3D page is shown.
function InlineHost(props) {
  const { t } = useTranslation('common');
  const tx = (k, f) => t(`threeD.${k}`, { defaultValue: f });
  const [clip, setClip] = createSignal(null);
  const [box, setBox] = createSignal(null);
  const isOff = () => deactivated().has(annotKey(props.annot));
  const [dock, setDock] = createSignal(null);
  const [treeDock, setTreeDock] = createSignal(null);
  const [dockH, setDockH] = createSignal(0);
  const [header, setHeader] = createSignal({ left: '', right: '' });
  let raf = 0, rect = null, last = '';
  const doc = activeDoc();
  viewRectOf(doc, props.annot).then((r) => { rect = r; }).catch(() => {});
  headerTextsOf(doc, props.annot).then(setHeader).catch(() => {});
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const area = document.getElementById('pdf-container');
    if (!rect || !area) return;
    const a = area.getBoundingClientRect();
    const r = paginaRectNaarClient(props.annot.page, rect, doc);
    if (!r) return;
    const key = [a.left, a.top, a.width, a.height, r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (key === last) return;
    last = key;
    setClip({ left: a.left, top: a.top, width: a.width, height: a.height });
    setBox({ left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height });
  };
  raf = requestAnimationFrame(tick);
  onCleanup(() => cancelAnimationFrame(raf));
  const px = (o) => o && ({ left: `${o.left}px`, top: `${o.top}px`, width: `${o.width}px`, height: `${o.height}px` });
  return (
    <Show when={clip() && box()}>
      <div class="threed-inline-clip" style={px(clip())} ref={keepEventsInside}>
        <div class="threed-dock" classList={{ off: isOff() }}
          ref={(el) => { const ro = new ResizeObserver(() => setDockH(el.offsetHeight)); ro.observe(el); onCleanup(() => ro.disconnect()); }}>
          <div class="threed-dock-toolbar" ref={setDock} />
          <Show when={header().left || header().right}>
            <div class="threed-dock-header">
              <span class="threed-dock-left" title={header().left}>{header().left}</span>
              <span class="threed-dock-right" title={header().right}>{header().right}</span>
            </div>
          </Show>
        </div>
        <div class="threed-tree-dock" style={{ top: `${dockH()}px` }} ref={setTreeDock} />
        <div class="threed-inline" style={px(box())}>
          <Show when={!isOff()} fallback={
            <button class="threed-activate" onClick={() => setDeactivated(s => { const n = new Set(s); n.delete(annotKey(props.annot)); return n; })}>
              {tx('activate', 'Activate 3D')}
            </button>
          }>
            <ThreeDViewer
              annot={props.annot}
              compact
              toolbarMount={dock()}
              treeMount={treeDock()}
              onClose={() => setDeactivated(s => new Set(s).add(annotKey(props.annot)))}
              onToggleSize={() => setExpanded(props.annot)}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** Decode a 3D annotation's model in the worker (or take it from the cache). */
function decodeModel(annot, docId, onProgress) {
  const key = decodedKey(docId, annot);
  const hit = getDecoded(key);
  if (hit) return { promise: Promise.resolve(hit), cancel: () => {} };
  let worker = null;
  const promise = new Promise((resolve, reject) => {
    const src = annot.getSource(typeof DecompressionStream !== 'undefined');
    worker = new Worker(new URL('../../pdf/three-d/u3d-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.progress != null) { onProgress(msg.progress); return; }
      worker.terminate(); worker = null;
      if (msg.error) { reject(new Error(msg.error)); return; }
      putDecoded(key, docId, msg);
      resolve(msg);
    };
    worker.onerror = (e) => { worker?.terminate(); worker = null; reject(new Error(String(e.message || e))); };
    worker.postMessage({ id: 1, bytes: src.bytes, deflated: src.deflated }, [src.bytes.buffer]);
  });
  return { promise, cancel: () => { if (worker) { worker.terminate(); worker = null; } } };
}

function ThreeDViewer(props) {
  const { t } = useTranslation('common');
  const tx = (k, f, o) => t(`threeD.${k}`, { defaultValue: f, ...o });
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal(null);
  const [notice, setNotice] = createSignal('');
  const [ready, setReady] = createSignal(false);
  const [tree, setTree] = createSignal([]); // [{ name, models: [{ name, obj }], obj, open }]
  const [showTree, setShowTree] = createSignal(!props.compact);
  const [mode, setMode] = createSignal('solid');
  const [viewIdx, setViewIdx] = createSignal(props.annot.defaultView || 0);
  const [stats, setStats] = createSignal('');
  const [visTick, setVisTick] = createSignal(0);
  const docId = activeDoc()?.id;

  let host, THREE, renderer, scene, camera, perspCam, orthoCam, keyLight, controls, root, OrbitControls;
  let disposed = false, decoding = null, sphere = null, halfH = 1;
  const materials = new Map();
  const edgeGeoms = new Map();
  let lineMat = null;
  const render = () => { if (renderer && !disposed) renderer.render(scene, camera); };

  async function init(el) {
    host = el;
    try {
      THREE = await import('three');
      ({ OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js'));
      if (disposed) return;
      renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setClearColor(0xffffff, 1);
      host.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
      perspCam = new THREE.PerspectiveCamera(30, 1, 1, 1e7);
      orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e7);
      keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(0.5, 1, 0.3);
      useCamera(perspCam);
      root = new THREE.Group();
      scene.add(root);
      resize();
      const ro = new ResizeObserver(() => { resize(); render(); });
      ro.observe(host);
      onCleanup(() => ro.disconnect());
    } catch (e) {
      console.error('[3d] viewer failed:', e);
      setError(tx('viewerFailed', 'The 3D view could not be started.'));
      return;
    }
    await loadModel();
  }

  const aspect = () => (host?.clientWidth || 1) / (host?.clientHeight || 1);

  // The key light rides along with whichever camera is in use.
  function useCamera(cam) {
    if (camera === cam) return;
    if (camera) scene.remove(camera);
    camera = cam;
    camera.add(keyLight);
    scene.add(camera);
  }

  function updateProjection() {
    const a = aspect();
    if (camera.isOrthographicCamera) {
      camera.left = -halfH * a; camera.right = halfH * a;
      camera.top = halfH; camera.bottom = -halfH;
    } else {
      camera.aspect = a;
    }
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    updateProjection();
  }

  async function loadModel() {
    if (props.annot.subtype && props.annot.subtype !== 'U3D') {
      setError(tx('unsupported', 'This 3D model uses the {{fmt}} format, which is not supported yet (only U3D).', { fmt: props.annot.subtype }));
      return;
    }
    try {
      decoding = decodeModel(props.annot, docId, setProgress);
      const data = await decoding.promise;
      decoding = null;
      if (!disposed) build(data);
    } catch (e) {
      decoding = null;
      if (disposed) return;
      console.warn('[3d] model could not be read:', e);
      setError(tx('readFailed', 'The 3D model could not be read.'));
    }
  }

  function materialFor(m) {
    const key = `${m.color.join(',')}|${m.opacity}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(m.color[0], m.color[1], m.color[2]),
        flatShading: true,
        side: THREE.DoubleSide,
        transparent: m.opacity < 1,
        opacity: m.opacity,
        shininess: 20,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      mat.userData.baseOpacity = m.opacity;
      materials.set(key, mat);
    }
    return mat;
  }

  function build(data) {
    const groupObjs = new Map();
    const nodes = [];
    for (const g of data.groups) {
      const obj = new THREE.Group();
      obj.name = g.name;
      if (g.matrix) { obj.matrixAutoUpdate = false; obj.matrix.fromArray(g.matrix); }
      groupObjs.set(g.name, obj);
      nodes.push({ name: g.name, parent: g.parent, obj, models: [] });
    }
    const nodeByName = new Map(nodes.map(n => [n.name, n]));
    for (const n of nodes) {
      const parent = groupObjs.get(n.parent);
      (parent && parent !== n.obj ? parent : root).add(n.obj);
    }
    // One geometry per mesh resource, shared by every model node using it.
    const geoms = data.resources.map((r) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
      geom.setIndex(new THREE.BufferAttribute(r.indices, 1));
      r.ranges.forEach((range, i) => geom.addGroup(range.start, range.count, i));
      return geom;
    });
    for (const m of data.models) {
      const geom = geoms[m.resource];
      if (!geom) continue;
      const mats = m.materials.map(materialFor);
      const mesh = new THREE.Mesh(geom, mats.length === 1 ? mats[0] : mats);
      mesh.name = m.name;
      mesh.visible = m.visible;
      if (m.matrix) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(m.matrix); }
      (groupObjs.get(m.parent) || root).add(mesh);
      nodeByName.get(m.parent)?.models.push({ name: m.name, obj: mesh });
    }
    // Model tree: groups that hold models (or other groups), in file order.
    const hasChild = new Set(nodes.map(n => n.parent));
    setTree(nodes.filter(n => n.models.length || hasChild.has(n.name)).map(n => ({ ...n, open: false })));
    setStats(tx('stats', '{{models}} objects, {{tris}} triangles', {
      models: data.models.length.toLocaleString(), tris: data.triangles.toLocaleString(),
    }));
    if (data.skipped) setNotice(tx('partial', 'Some parts of the 3D model could not be read ({{n}} skipped).', { n: data.skipped }));
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const s = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
    sphere = { center: s.center.toArray(), radius: Math.max(s.radius, 1e-6) };
    setReady(true);
    applyView(viewIdx());
  }

  function setControls(target) {
    if (controls) controls.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', render);
    controls.update();
  }

  function applyView(i) {
    if (!sphere) return;
    const v = props.annot.views[i];
    const cam = cameraForView(v, sphere, aspect());
    useCamera(v?.ortho ? orthoCam : perspCam);
    if (!cam) { fit(); return; }
    camera.up.set(...cam.up);
    camera.position.set(...cam.position);
    camera.near = cam.near; camera.far = cam.far;
    camera.zoom = 1;
    if (cam.ortho) halfH = cam.halfHeight; else camera.fov = cam.fov;
    const target = new THREE.Vector3(...cam.target);
    camera.lookAt(target);
    updateProjection();
    setControls(target);
    render();
  }

  function fit() {
    if (!sphere) return;
    const center = new THREE.Vector3(...sphere.center);
    const r = sphere.radius;
    const dir = new THREE.Vector3().subVectors(camera.position, controls ? controls.target : center).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() === 0) dir.set(1, -1, 1).normalize();
    let dist;
    if (camera.isOrthographicCamera) {
      const a = aspect();
      halfH = (a >= 1 ? r : r / a) * 1.05;
      dist = r * 3;
    } else {
      // Fit along the narrower of the two fields of view.
      const vfov = camera.fov, hfov = verticalFov(vfov, 'H', 1 / aspect());
      dist = r / Math.sin((Math.min(vfov, hfov) * Math.PI) / 360);
    }
    camera.zoom = 1;
    camera.near = r / 2000; camera.far = dist + r * 4;
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    updateProjection();
    setControls(center);
    render();
  }

  function setRenderMode(m) {
    setMode(m);
    for (const mat of materials.values()) {
      mat.wireframe = m === 'wire';
      const base = mat.userData.baseOpacity ?? 1;
      mat.opacity = m === 'xray' ? Math.min(base, 0.35) : base;
      mat.transparent = mat.opacity < 1;
      mat.depthWrite = m !== 'xray';
      mat.needsUpdate = true;
    }
    if (m === 'edges' && !lineMat) {
      lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
      const meshes = [];
      root.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const o of meshes) {
        let eg = edgeGeoms.get(o.geometry);
        if (!eg) { eg = new THREE.EdgesGeometry(o.geometry, 30); edgeGeoms.set(o.geometry, eg); }
        const e = new THREE.LineSegments(eg, lineMat);
        e.name = '__edges'; o.add(e);
      }
    }
    root.traverse((o) => { if (o.name === '__edges') o.visible = m === 'edges'; });
    render();
  }

  // Camera as a /3DView would store it: /C2W = left, up, forward, position.
  function captureCamera() {
    camera.updateMatrixWorld(true);
    const c2w = c2wFromMatrix(camera.matrixWorld.elements);
    const co = controls ? camera.position.distanceTo(controls.target) : 0;
    return { c2w, co, fov: camera.isOrthographicCamera ? 30 : camera.fov, ortho: !!camera.isOrthographicCamera };
  }

  function hiddenNames() {
    const out = [];
    root?.traverse((o) => { if (o !== root && o.name && o.name !== '__edges' && !o.visible) out.push(o.name); });
    return out;
  }

  // Render the current view at print resolution (about 2400 px across)
  // and return it as JPEG bytes. The canvas size is restored afterwards.
  function snapshotJpeg() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    const k = 2400 / Math.max(w, h);
    const ratio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(Math.round(w * k), Math.round(h * k), false);
    updateProjection();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.92);
    renderer.setPixelRatio(ratio);
    resize();
    render();
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  const [creating, setCreating] = createSignal(false);
  const mySnapshots = () => snapshots().filter(s => s.sourcePage === props.annot.page);

  // Edit: the page with the 3D model stays free to rotate; this view becomes
  // a new page (same sheet, picture of the model) that takes markups.
  async function editAsPage() {
    if (creating() || !ready()) return;
    setCreating(true);
    try {
      const jpeg = snapshotJpeg();
      const name = `${tx('markupView', 'Markup view')} ${mySnapshots().length + 1}`;
      const { insertThreeDSnapshotPage } = await import('../../pdf/three-d/snapshot-page.js');
      await insertThreeDSnapshotPage({
        sourcePage: props.annot.page, rect: props.annot.rect, jpeg, name,
        view: { ...captureCamera(), hidden: hiddenNames() },
      });
    } catch (e) {
      console.error('[3d] markup page failed:', e);
      import('../../bridge.js').then(m => m.showMessage?.(String(e?.message || e))).catch(() => {});
    } finally {
      setCreating(false);
    }
  }

  function toggle(obj) {
    obj.visible = !obj.visible;
    setVisTick(v => v + 1);
    render();
  }

  onCleanup(() => {
    disposed = true;
    decoding?.cancel();
    if (controls) controls.dispose();
    root?.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const g of edgeGeoms.values()) g.dispose();
    for (const m of materials.values()) m.dispose();
    lineMat?.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove(); }
  });

  const viewNames = createMemo(() => props.annot.views.map((v, i) => v.name || `${tx('view', 'View')} ${i + 1}`));

  const toolbar = (
    <div class="threed-toolbar">
      <Show when={!props.compact}><span class="threed-title">{tx('title', '3D view')}</span></Show>
      <Show when={viewNames().length}>
        <label>{tx('view', 'View')}
          <select onChange={(e) => {
            const v = e.currentTarget.value;
            if (v.startsWith('p')) { goToPage(+v.slice(1)); e.currentTarget.value = `v${viewIdx()}`; return; }
            const i = +v.slice(1); setViewIdx(i); applyView(i);
          }}>
            <For each={viewNames()}>{(n, i) => <option value={`v${i()}`} selected={viewIdx() === i()}>{n}</option>}</For>
            <Show when={mySnapshots().length}>
              <optgroup label={tx('markupPages', 'Markup pages')}>
                <For each={mySnapshots()}>{(sn) => <option value={`p${sn.page}`}>{`${sn.name} (${tx('pageN', 'page {{n}}', { n: sn.page })})`}</option>}</For>
              </optgroup>
            </Show>
          </select>
        </label>
      </Show>
      <button onClick={() => fit()} disabled={!ready()}>{tx('fit', 'Fit')}</button>
      <label>{tx('display', 'Display')}
        <select value={mode()} onChange={(e) => setRenderMode(e.currentTarget.value)} disabled={!ready()}>
          <option value="solid">{tx('modeSolid', 'Solid')}</option>
          <option value="edges">{tx('modeEdges', 'Solid with edges')}</option>
          <option value="wire">{tx('modeWire', 'Wireframe')}</option>
          <option value="xray">{tx('modeXray', 'Transparent')}</option>
        </select>
      </label>
      <button classList={{ active: showTree() }} onClick={() => setShowTree(v => !v)} disabled={!tree().length}>{tx('tree', 'Model tree')}</button>
      <button class="threed-markup-btn" onClick={editAsPage} disabled={!ready() || creating()}
        title={tx('editTip', 'Make a markup page of this view; the 3D page stays free to rotate')}>
        {creating() ? tx('creating', 'Creating page...') : tx('edit', 'Edit')}
      </button>
      <span class="threed-stats">{stats()}</span>
      <Show when={notice()}><span class="threed-notice" title={notice()}>{notice()}</span></Show>
      <span style={{ flex: 1 }} />
      <Show when={!props.compact}>
        <span class="threed-hint">{tx('hint', 'Left drag: orbit, right drag: pan, wheel: zoom')}</span>
      </Show>
      <button onClick={props.onToggleSize} title={props.compact ? tx('expand', 'Fill the document area') : tx('shrink', 'Back to the page')}>
        {props.compact ? '⤢' : '⤡'}
      </button>
      <button class="threed-close" onClick={props.onClose} title={props.compact ? tx('deactivate', 'Turn off the 3D view') : t('close')}>&times;</button>
    </div>
  );

  const treePanel = (
    <div class="threed-tree">
      <For each={tree()}>
        {(node, i) => (
          <div class="threed-tree-group">
            <div class="threed-tree-row">
              <span class="threed-tree-arrow" onClick={() => setTree(ts => ts.map((n, k) => (k === i() ? { ...n, open: !n.open } : n)))}>
                {node.models.length ? (node.open ? '▼' : '▶') : ''}
              </span>
              <input type="checkbox" checked={(visTick(), node.obj.visible)} onChange={() => toggle(node.obj)} />
              <span class="threed-tree-name" title={node.name}>{node.name}</span>
              <span class="threed-tree-count">{node.models.length || ''}</span>
            </div>
            <Show when={node.open}>
              <For each={node.models}>
                {(m) => (
                  <div class="threed-tree-row threed-tree-model">
                    <input type="checkbox" checked={(visTick(), m.obj.visible)} onChange={() => toggle(m.obj)} />
                    <span class="threed-tree-name" title={m.name}>{m.name}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        )}
      </For>
    </div>
  );

  return (
    <div class="threed-view" classList={{ compact: !!props.compact }} ref={(el) => { if (!props.compact) keepEventsInside(el); }} onKeyDown={(e) => { if (e.key === 'Escape') props.onClose(); }} tabIndex={-1}>
      <Show when={props.toolbarMount} fallback={toolbar}>
        <Portal mount={props.toolbarMount}>{toolbar}</Portal>
      </Show>
      <div class="threed-body">
        <Show when={showTree() && tree().length}>
          <Show when={props.treeMount} fallback={treePanel}>
            <Portal mount={props.treeMount}>{treePanel}</Portal>
          </Show>
        </Show>
        <div class="threed-canvas" ref={(el) => queueMicrotask(() => init(el))}>
          <Show when={!ready() && !error()}>
            <div class="threed-loading">{tx('loading', 'Loading 3D model... {{pct}}%', { pct: Math.round(progress() * 100) })}</div>
          </Show>
          <Show when={error()}>
            <div class="threed-loading threed-error">{error()}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}
