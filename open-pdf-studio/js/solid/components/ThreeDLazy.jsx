import { Show, createEffect, lazy } from 'solid-js';
import { state } from '../../core/state.js';
import { pruneDecoded } from '../../pdf/three-d/decoded-cache.js';

// Shell for the 3D view (ThreeDView.jsx). The viewer, its toolbar and
// three.js only load once the active document has a 3D model or a 3D markup
// page; for every other PDF nothing of it is fetched or rendered.

const ThreeDViewImpl = lazy(() => import('./ThreeDView.jsx'));
const ThreeDSnapshotBarImpl = lazy(() => import('./ThreeDView.jsx').then(m => ({ default: m.ThreeDSnapshotBar })));

const activeDoc = () => state.documents[state.activeDocumentIndex];

export function ThreeDSnapshotBar() {
  return (
    <Show when={activeDoc()?.threeDSnapshots?.length}>
      <ThreeDSnapshotBarImpl />
    </Show>
  );
}

export default function ThreeDView() {
  // Decoded models of closed documents are dropped right away.
  createEffect(() => pruneDecoded(state.documents.map(d => d.id)));
  return (
    <Show when={activeDoc()?.threeD?.length}>
      <ThreeDViewImpl />
    </Show>
  );
}
