/**
 * Tool Group State
 *
 * In-memory, session-only state for "tool groups" — ToolDefinitions that
 * declare a `subTools` array. The host renders such a tool as a single
 * palette button that opens a sub-menu pop-out. The currently active
 * sub-tool per group is persisted here so the main button can morph to
 * show that sub-tool's icon between clicks.
 *
 * State shape: Map<groupId, currentSubToolId>
 *
 * Reactive: backed by a Solid signal, so consumers (palette renderer,
 * etc.) can subscribe via the imported getters and re-run on change.
 *
 * Lifetime: in-memory only. Cleared on plugin-deactivate via
 * `clearAllToolGroups()`. NO localStorage; choice does not survive
 * an app restart by design.
 */

import { createSignal } from 'solid-js';

const [groupState, setGroupState] = createSignal(new Map());

/**
 * Returns the active sub-tool id for a given group, or null if the user
 * has not made a choice yet in this session.
 *
 * @param {string} groupId
 * @returns {string | null}
 */
export function getActiveSubToolId(groupId) {
  const map = groupState();
  return map.has(groupId) ? map.get(groupId) : null;
}

/**
 * Returns the currently active sub-tool ToolDefinition for a group.
 * Falls back to `groupDef.subTools[0]` if no choice has been made yet
 * or if the stored id no longer matches any sub-tool (e.g. plugin
 * re-registered with a different sub-tool set).
 *
 * @param {object} groupDef ToolDefinition with a non-empty `subTools` array
 * @returns {object} a ToolDefinition from groupDef.subTools
 */
export function getActiveSubTool(groupDef) {
  const subTools = groupDef && groupDef.subTools;
  if (!subTools || subTools.length === 0) {
    throw new Error('getActiveSubTool: groupDef has no subTools');
  }
  const activeId = getActiveSubToolId(groupDef.id);
  if (activeId !== null) {
    const found = subTools.find(t => t.id === activeId);
    if (found) return found;
  }
  return subTools[0];
}

/**
 * Set the active sub-tool for a group. Triggers reactive consumers.
 *
 * @param {string} groupId
 * @param {string} subToolId
 */
export function setActiveSubTool(groupId, subToolId) {
  setGroupState(prev => {
    const next = new Map(prev);
    next.set(groupId, subToolId);
    return next;
  });
}

/**
 * Reset all tool-group state. Called on plugin deactivate so a fresh
 * activate starts with no stale per-group selections.
 */
export function clearAllToolGroups() {
  setGroupState(new Map());
}

/**
 * Wis alleen de opgegeven groepen: die van één extensie (#550). Een extensie
 * die uitgaat of herlaadt, laat de keuzes in de paletten van andere
 * extensies staan.
 *
 * @param {Iterable<string>} groupIds
 */
export function clearToolGroups(groupIds) {
  const ids = new Set(groupIds);
  if (!ids.size) return;
  setGroupState(prev => {
    if (![...ids].some(id => prev.has(id))) return prev;
    const next = new Map(prev);
    for (const id of ids) next.delete(id);
    return next;
  });
}

/**
 * De id's van de gereedschapsgroepen (ToolDefinitions met `subTools`) in de
 * opgegeven paletbeschrijvingen, ook geneste.
 *
 * @param {Array<{ tools?: object[] } | null | undefined>} palettes
 * @returns {string[]}
 */
export function toolGroupIdsOf(palettes) {
  const ids = [];
  const walk = (tools) => {
    for (const tool of tools || []) {
      if (Array.isArray(tool?.subTools) && tool.subTools.length) {
        if (typeof tool.id === 'string') ids.push(tool.id);
        walk(tool.subTools);
      }
    }
  };
  for (const palette of palettes || []) walk(palette?.tools);
  return ids;
}

/**
 * Direct access to the underlying signal getter for consumers that need
 * the full Map (e.g. devtools, debug panels). Most callers should use
 * `getActiveSubToolId` / `getActiveSubTool` instead.
 *
 * @returns {Map<string, string>}
 */
export function getToolGroupStateSnapshot() {
  return groupState();
}
