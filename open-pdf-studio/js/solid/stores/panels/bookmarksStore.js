import { createSignal } from 'solid-js';

const [tree, setTree] = createSignal([]);
const [countText, setCountText] = createSignal('0 bookmarks');
const [emptyMessage, setEmptyMessage] = createSignal('No bookmarks in this document');
const [selectedId, setSelectedId] = createSignal(null);
// Meervoudige selectie (#690): alle geselecteerde ids; selectedId is de
// laatst aangeklikte (bewerken, subbladwijzer, zoekveld).
const [selectedIds, setSelectedIds] = createSignal([]);
const [toolbarDisabled, setToolbarDisabled] = createSignal({ add: true, addChild: true, edit: true, delete: true, style: true });

export {
  tree, setTree,
  countText, setCountText,
  emptyMessage, setEmptyMessage,
  selectedId, setSelectedId,
  selectedIds, setSelectedIds,
  toolbarDisabled, setToolbarDisabled,
};
