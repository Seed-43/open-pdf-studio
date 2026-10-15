import { createSignal, createMemo, createEffect, For, Show, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

// 3D PDF support. PDF.js draws only the poster image of a /3D annotation,
// so the app shows the live model itself: on the page, inside the
// annotation's rectangle (like a 3D-capable viewer activating it on page
// open), following scroll, pan and zoom. A button expands it to fill the
// document area. Preset views come from the PDF, the model tree has
// visibility toggles, and there are render modes and fit. The U3D model is
// decoded in a worker (js/pdf/three-d/u3d-worker.js) and drawn with three.js.
import { paginaRectNaarClient } from '../../pdf/weergave-ruimte.js';
import { markDocumentModified } from '../../ui/chrome/tabs.js';

const [expanded, setExpanded] = createSignal(null);   // annot shown full-area
const [deactivated, setDeactivated] = createSignal(new Set()); // annot keys showing the poster

const activeDoc = () => state.documents[state.activeDocumentIndex];
const annotsOnPage = () => {
  const d = activeDoc();
  return (d?.threeD || []).filter(a => a.page === d.currentPage);
};
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

export default function ThreeDView() {
  return (
    <>
      <Show when={expanded()} keyed>
        {(annot) => <ThreeDViewer annot={annot} onClose={() => setExpanded(null)} onToggleSize={() => setExpanded(null)} />}
      </Show>
      <Show when={!expanded()}>
        <For each={annotsOnPage()}>{(annot) => <InlineHost annot={annot} />}</For>
      </Show>
    </>
  );
}

// Keeps a fixed-position box over the annotation's rectangle on screen,
// clipped to the document area, re-measured every animation frame.
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
  viewRectOf(doc, props.annot).then((r) => { rect = r; });
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
      <div class="threed-inline-clip" style={px(clip())}>
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

function ThreeDViewer(props) {
  const { t } = useTranslation('common');
  const tx = (k, f, o) => t(`threeD.${k}`, { defaultValue: f, ...o });
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal(null);
  const [ready, setReady] = createSignal(false);
  const [tree, setTree] = createSignal([]); // [{ name, models: [{ name, obj }], obj, open }]
  const [showTree, setShowTree] = createSignal(!props.compact);
  const [mode, setMode] = createSignal('solid');
  const [viewIdx, setViewIdx] = createSignal(props.annot.defaultView || 0);
  const [stats, setStats] = createSignal('');
  const [visTick, setVisTick] = createSignal(0);
  // Markups. A saved view holds a camera, hidden nodes and markups; while one
  // is shown (or while marking up) the model is locked so the markups stay
  // on the parts they point at. Markup points are stored as [u, v] with
  // u = (x - width / 2) / height and v = y / height: with a vertical field
  // of view that keeps them on the model at any canvas size.
  const [savedIdx, setSavedIdx] = createSignal(null);
  const [markupMode, setMarkupMode] = createSignal(false);
  const [tool, setTool] = createSignal('pen');
  const [draft, setDraft] = createSignal(null);
  const [textAt, setTextAt] = createSignal(null);
  const [size, setSize] = createSignal({ w: 1, h: 1 });
  const locked = () => savedIdx() != null || markupMode();

  let host, THREE, renderer, scene, camera, controls, root, worker, OrbitControls;
  let disposed = false;
  const materials = new Map();
  let edgesBuilt = false;
  const render = () => { if (renderer && !disposed) renderer.render(scene, camera); };
  createEffect(() => { const l = locked(); if (controls) controls.enabled = !l; });

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
      camera = new THREE.PerspectiveCamera(30, 1, 1, 1e7);
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      camera.add(key); key.position.set(0.5, 1, 0.3);
      scene.add(camera);
      root = new THREE.Group();
      scene.add(root);
      resize();
      const ro = new ResizeObserver(() => { resize(); render(); });
      ro.observe(host);
      onCleanup(() => ro.disconnect());
      await loadModel();
    } catch (e) {
      console.error('[3d] viewer failed:', e);
      setError(String(e?.message || e));
    }
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setSize({ w, h });
  }

  function loadModel() {
    return new Promise((resolve) => {
      if (props.annot.subtype && props.annot.subtype !== 'U3D') {
        setError(tx('unsupported', 'This 3D model uses the {{fmt}} format, which is not supported yet (only U3D).', { fmt: props.annot.subtype }));
        resolve();
        return;
      }
      const bytes = props.annot.getBytes();
      worker = new Worker(new URL('../../pdf/three-d/u3d-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.progress != null) { setProgress(msg.progress); return; }
        worker.terminate(); worker = null;
        if (msg.error) { setError(msg.error); resolve(); return; }
        if (!disposed) build(msg);
        resolve();
      };
      worker.onerror = (e) => { setError(String(e.message || e)); resolve(); };
      const copy = bytes.slice();
      worker.postMessage({ id: 1, bytes: copy }, [copy.buffer]);
    });
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
    for (const n of nodes) (groupObjs.get(n.parent) || root).add(n.obj);
    let tris = 0;
    for (const m of data.models) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geom.setIndex(new THREE.BufferAttribute(m.indices, 1));
      const mats = m.ranges.map((r, i) => { geom.addGroup(r.start, r.count, i); return materialFor(r.material); });
      const mesh = new THREE.Mesh(geom, mats.length === 1 ? mats[0] : mats);
      mesh.name = m.name;
      mesh.visible = m.visible;
      if (m.matrix) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(m.matrix); }
      (groupObjs.get(m.parent) || root).add(mesh);
      const node = nodes.find(n => n.name === m.parent);
      if (node) node.models.push({ name: m.name, obj: mesh });
      tris += m.indices.length / 3;
    }
    // Model tree: groups that hold models (or other groups), in file order.
    setTree(nodes.filter(n => n.models.length || nodes.some(c => c.parent === n.name))
      .map(n => ({ ...n, open: false })));
    setStats(tx('stats', '{{models}} objects, {{tris}} triangles', {
      models: data.models.length.toLocaleString(), tris: tris.toLocaleString(),
    }));
    root.updateMatrixWorld(true);
    setReady(true);
    applyView(viewIdx());
  }

  function bounds() {
    const box = new THREE.Box3().setFromObject(root, true);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { box, sphere };
  }

  function setControls(target) {
    if (controls) controls.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', render);
    controls.enabled = !locked();
    controls.update();
  }

  // /C2W is column major: left, up, forward, position (world space).
  function applyView(i) {
    applyCamera(props.annot.views[i]);
  }

  function applyCamera(v) {
    if (!ready() && !root) return;
    const { sphere } = bounds();
    const r = Math.max(sphere.radius, 1);
    camera.near = r / 2000; camera.far = r * 200;
    if (!v || !v.c2w || v.c2w.length < 12) { fit(); return; }
    const c = v.c2w;
    const up = new THREE.Vector3(c[3], c[4], c[5]).normalize();
    const fwd = new THREE.Vector3(c[6], c[7], c[8]).normalize();
    const pos = new THREE.Vector3(c[9], c[10], c[11]);
    const dist = v.co > 0 ? v.co : pos.distanceTo(sphere.center);
    camera.fov = v.fov || 30;
    camera.up.copy(up);
    camera.position.copy(pos);
    const target = pos.clone().addScaledVector(fwd, dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    setControls(target);
    render();
  }

  function fit() {
    const { sphere } = bounds();
    const r = Math.max(sphere.radius, 1);
    const dir = new THREE.Vector3().subVectors(camera.position, controls ? controls.target : sphere.center).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() === 0) dir.set(1, -1, 1).normalize();
    const dist = r / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = r / 2000; camera.far = r * 200;
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    setControls(sphere.center);
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
    if (m === 'edges' && !edgesBuilt) {
      edgesBuilt = true;
      const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
      root.traverse((o) => {
        if (o.isMesh) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), lineMat);
          e.name = '__edges'; o.add(e);
        }
      });
    }
    root.traverse((o) => { if (o.name === '__edges') o.visible = m === 'edges'; });
    render();
  }

  function toggle(obj) {
    obj.visible = !obj.visible;
    setVisTick(v => v + 1);
    render();
  }

  // ── Saved markup views ──────────────────────────────────────────────

  const savedViews = () => props.annot.savedViews || [];

  // Camera as a /3DView would store it: /C2W = left, up, forward, position.
  function captureCamera() {
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    const right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], back = [e[8], e[9], e[10]];
    const pos = [e[12], e[13], e[14]];
    const c2w = [-right[0], -right[1], -right[2], ...up, -back[0], -back[1], -back[2], ...pos];
    const co = controls ? camera.position.distanceTo(controls.target) : 0;
    return { c2w, co, fov: camera.fov };
  }

  function hiddenNames() {
    const out = [];
    root?.traverse((o) => { if (o !== root && o.name && o.name !== '__edges' && !o.visible) out.push(o.name); });
    return out;
  }

  function showSaved(i) {
    const v = savedViews()[i];
    if (!v) return;
    const hidden = new Set(v.hidden || []);
    root?.traverse((o) => { if (o !== root && o.name && o.name !== '__edges') o.visible = !hidden.has(o.name); });
    setVisTick(t => t + 1);
    setSavedIdx(i);
    applyCamera(v);
  }

  function selectView(value) {
    setMarkupMode(false);
    setDraft(null); setTextAt(null);
    if (value.startsWith('s')) { showSaved(+value.slice(1)); return; }
    setSavedIdx(null);
    const i = +value.slice(1);
    setViewIdx(i);
    applyView(i);
  }

  function markDirty() {
    props.annot.savedViewsDirty = true;
    const d = state.documents.find(doc => (doc.threeD || []).includes(props.annot)) || activeDoc();
    if (d) markDocumentModified(d);
  }

  // The first markup on an unsaved camera saves the view state with it.
  function commitMarkup(m) {
    const list = [...savedViews()];
    let i = savedIdx();
    if (i == null) {
      const n = list.length + 1;
      list.push({ name: `${tx('markupView', 'Markup view')} ${n}`, ...captureCamera(), hidden: hiddenNames(), markups: [m], saved: true });
      i = list.length - 1;
    } else {
      list[i] = { ...list[i], markups: [...(list[i].markups || []), m] };
    }
    props.annot.savedViews = list;
    setSavedIdx(i);
    markDirty();
  }

  function undoMarkup() {
    const i = savedIdx();
    if (i == null) return;
    const list = [...savedViews()];
    list[i] = { ...list[i], markups: (list[i].markups || []).slice(0, -1) };
    props.annot.savedViews = list;
    markDirty();
  }

  function deleteSaved() {
    const i = savedIdx();
    if (i == null) return;
    props.annot.savedViews = savedViews().filter((_, k) => k !== i);
    setSavedIdx(null);
    setMarkupMode(false);
    markDirty();
  }

  function unlock() {
    setSavedIdx(null);
    setMarkupMode(false);
    setDraft(null); setTextAt(null);
  }

  // Pointer -> [u, v] (see the note on the markup signals).
  function toUV(e) {
    const rc = host.getBoundingClientRect();
    const h = rc.height || 1;
    return [((e.clientX - rc.left) - rc.width / 2) / h, (e.clientY - rc.top) / h];
  }
  const X = (p) => p[0] * size().h + size().w / 2;
  const Y = (p) => p[1] * size().h;

  function onMarkDown(e) {
    if (!markupMode() || e.button !== 0) return;
    e.preventDefault();
    const p = toUV(e);
    if (tool() === 'text') { setTextAt(p); return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraft({ type: tool(), pts: [p, p] });
  }
  function onMarkMove(e) {
    const d = draft();
    if (!d) return;
    const p = toUV(e);
    setDraft(d.type === 'pen' ? { ...d, pts: [...d.pts, p] } : { ...d, pts: [d.pts[0], p] });
  }
  function onMarkUp() {
    const d = draft();
    setDraft(null);
    if (!d) return;
    const a = d.pts[0], b = d.pts[d.pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.004) return; // a click, not a stroke
    commitMarkup({ type: d.type, pts: d.type === 'pen' ? d.pts : [a, b] });
  }
  function commitText(value) {
    const at = textAt();
    setTextAt(null);
    if (at && value && value.trim()) commitMarkup({ type: 'text', pts: [at], text: value.trim() });
  }

  const shownMarkups = () => (savedIdx() != null ? (savedViews()[savedIdx()]?.markups || []) : []);

  function markupShape(m) {
    const p = m.pts || [];
    if (m.type === 'pen') {
      return <polyline points={p.map(q => `${X(q)},${Y(q)}`).join(' ')} />;
    }
    if (m.type === 'box') {
      const x = Math.min(X(p[0]), X(p[1])), y = Math.min(Y(p[0]), Y(p[1]));
      return <rect x={x} y={y} width={Math.abs(X(p[1]) - X(p[0]))} height={Math.abs(Y(p[1]) - Y(p[0]))} rx="4" />;
    }
    if (m.type === 'arrow') {
      return <line x1={X(p[0])} y1={Y(p[0])} x2={X(p[1])} y2={Y(p[1])} marker-end="url(#threed-arrowhead)" />;
    }
    if (m.type === 'text') {
      return <text x={X(p[0])} y={Y(p[0])} class="threed-markup-text" style={{ 'font-size': `${Math.max(11, size().h * 0.028)}px` }}>{m.text}</text>;
    }
    return null;
  }

  const markupLayer = (
    <svg class="threed-markups" classList={{ drawing: markupMode() }}
      width={size().w} height={size().h}
      onPointerDown={onMarkDown} onPointerMove={onMarkMove} onPointerUp={onMarkUp}>
      <defs>
        <marker id="threed-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="threed-arrowhead" />
        </marker>
      </defs>
      <For each={shownMarkups()}>{(m) => markupShape(m)}</For>
      <Show when={draft()}>{markupShape(draft())}</Show>
    </svg>
  );

  onCleanup(() => {
    disposed = true;
    if (worker) worker.terminate();
    if (controls) controls.dispose();
    root?.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of materials.values()) m.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove(); }
  });

  const viewNames = createMemo(() => props.annot.views.map((v, i) => v.name || `${tx('view', 'View')} ${i + 1}`));

  const toolbar = (
    <div class="threed-toolbar">
      <Show when={!props.compact}><span class="threed-title">{tx('title', '3D view')}</span></Show>
      <Show when={viewNames().length}>
        <label>{tx('view', 'View')}
          <select value={savedIdx() != null ? `s${savedIdx()}` : `v${viewIdx()}`} onChange={(e) => selectView(e.currentTarget.value)}>
            <For each={viewNames()}>{(n, i) => <option value={`v${i()}`} selected={savedIdx() == null && viewIdx() === i()}>{n}</option>}</For>
            <Show when={savedViews().length}>
              <optgroup label={tx('savedViews', 'Saved markup views')}>
                <For each={savedViews()}>{(v, i) => <option value={`s${i()}`} selected={savedIdx() === i()}>{`\u{1F512} ${v.name} (${(v.markups || []).length})`}</option>}</For>
              </optgroup>
            </Show>
          </select>
        </label>
      </Show>
      <button onClick={() => fit()} disabled={!ready() || locked()}>{tx('fit', 'Fit')}</button>
      <label>{tx('display', 'Display')}
        <select value={mode()} onChange={(e) => setRenderMode(e.currentTarget.value)} disabled={!ready()}>
          <option value="solid">{tx('modeSolid', 'Solid')}</option>
          <option value="edges">{tx('modeEdges', 'Solid with edges')}</option>
          <option value="wire">{tx('modeWire', 'Wireframe')}</option>
          <option value="xray">{tx('modeXray', 'Transparent')}</option>
        </select>
      </label>
      <button classList={{ active: showTree() }} onClick={() => setShowTree(v => !v)}>{tx('tree', 'Model tree')}</button>
      <Show when={!markupMode()} fallback={
        <span class="threed-markup-tools">
          <For each={[['pen', tx('toolPen', 'Pen')], ['arrow', tx('toolArrow', 'Arrow')], ['box', tx('toolBox', 'Box')], ['text', tx('toolText', 'Text')]]}>
            {([id, label]) => <button classList={{ active: tool() === id }} onClick={() => setTool(id)}>{label}</button>}
          </For>
          <button onClick={undoMarkup} disabled={!shownMarkups().length}>{tx('undo', 'Undo')}</button>
          <button class="threed-done" onClick={() => setMarkupMode(false)}>{tx('done', 'Done')}</button>
        </span>
      }>
        <button class="threed-markup-btn" onClick={() => setMarkupMode(true)} disabled={!ready()}>{tx('markup', 'Markup')}</button>
      </Show>
      <Show when={savedIdx() != null && !markupMode()}>
        <span class="threed-locked">{'\u{1F512}'} {tx('locked', 'View locked')}</span>
        <button onClick={unlock}>{tx('unlock', 'Unlock')}</button>
        <button onClick={deleteSaved}>{tx('deleteView', 'Delete view')}</button>
      </Show>
      <span class="threed-stats">{stats()}</span>
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
    <div class="threed-view" classList={{ compact: !!props.compact }} onKeyDown={(e) => { if (e.key !== 'Escape') return; if (markupMode()) setMarkupMode(false); else props.onClose(); }} tabIndex={-1}>
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
          <Show when={ready()}>{markupLayer}</Show>
          <Show when={textAt()}>
            <input class="threed-text-input"
              style={{ left: `${X(textAt())}px`, top: `${Y(textAt()) - 14}px` }}
              ref={(el) => queueMicrotask(() => el.focus())}
              placeholder={tx('textHint', 'Type, then Enter')}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitText(e.currentTarget.value); if (e.key === 'Escape') setTextAt(null); }}
              onBlur={(e) => commitText(e.currentTarget.value)} />
          </Show>
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
