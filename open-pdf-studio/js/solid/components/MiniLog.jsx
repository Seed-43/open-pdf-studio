/**
 * MiniLog — floating bottom-right panel that mirrors recent engine events
 * captured by mcp-bridge.js into window.__consoleRing.
 *
 * Read-only viewer: it polls the ring at a low rate (5 Hz) and renders the
 * last ~30 entries. Local component state only — no global store.
 *
 * Storage keys:
 *   minilog.expanded  — bool, persisted across mounts (default true)
 *   minilog.dismissed — bool, hides the panel for this session-of-mounts;
 *                       cleared on next app start so it re-appears.
 */

import { createSignal, onMount, onCleanup, For, Show, createEffect } from 'solid-js';
import { leesOpslag, schrijfOpslag } from '../../core/opslag.js';

const MAX_VISIBLE = 30;
const POLL_MS = 200;
const PREVIEW_LEN = 40;

// Color map per known tag. Anything else falls through to default gray.
const TAG_COLORS = {
  '[PERF]':        '#22d3ee', // cyan
  '[render]':      '#4ade80', // green
  '[thumb]':       '#60a5fa', // blue
  '[tile]':        '#facc15', // yellow
  '[bitmap-orch]': '#e879f9', // magenta
  '[tile-orch]':   '#fb923c', // orange
  '[wheel-zoom]':  '#a78bfa', // violet
  '[pre-render]':  '#34d399', // emerald
};

function detectTag(text) {
  // Match the first bracketed tag in the message.
  const m = text.match(/^\s*(\[[a-z\-]+\])/i);
  if (m && TAG_COLORS[m[1]]) return m[1];
  if (m) return m[1]; // unknown tag -> still detected, default color
  return null;
}

function colorFor(tag) {
  return TAG_COLORS[tag] || '#9ca3af';
}

function fmtTime(t) {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function readStoredBool(key, dflt) {
  const v = leesOpslag(key);
  if (v === null) return dflt;
  return v === '1' || v === 'true';
}

function writeStoredBool(key, v) {
  try { schrijfOpslag(key, v ? '1' : '0'); } catch { /* noop */ }
}

export default function MiniLog() {
  const [expanded, setExpanded] = createSignal(readStoredBool('minilog.expanded', true));
  const [dismissed, setDismissed] = createSignal(false); // session-only
  const [entries, setEntries] = createSignal([]);

  let bodyRef;
  let pollTimer = null;
  let lastLen = -1;
  let lastTs = 0;

  function tick() {
    const ring = window.__consoleRing;
    if (!ring || !Array.isArray(ring)) return;
    const len = ring.length;
    const lastEntry = len > 0 ? ring[len - 1] : null;
    const ts = lastEntry ? lastEntry.t : 0;
    if (len === lastLen && ts === lastTs) return;
    lastLen = len;
    lastTs = ts;
    // Slice last MAX_VISIBLE entries; map to shallow copies so SolidJS can
    // diff cheaply by reference change of the array.
    const slice = ring.slice(-MAX_VISIBLE).map(e => ({ t: e.t, level: e.level, text: e.text }));
    setEntries(slice);
  }

  // Auto-scroll body to bottom when entries change AND expanded.
  createEffect(() => {
    entries(); // dependency
    if (!expanded() || !bodyRef) return;
    // Defer until after DOM update.
    queueMicrotask(() => {
      if (bodyRef) bodyRef.scrollTop = bodyRef.scrollHeight;
    });
  });

  onMount(() => {
    tick();
    pollTimer = setInterval(tick, POLL_MS);
  });

  onCleanup(() => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  function toggleExpanded(e) {
    e?.stopPropagation();
    const next = !expanded();
    setExpanded(next);
    writeStoredBool('minilog.expanded', next);
  }

  function dismiss(e) {
    e?.stopPropagation();
    setDismissed(true);
  }

  // Latest entry preview (used in collapsed state)
  const previewText = () => {
    const arr = entries();
    if (arr.length === 0) return '(no events yet)';
    const last = arr[arr.length - 1];
    let txt = last.text || '';
    if (txt.length > PREVIEW_LEN) txt = txt.slice(0, PREVIEW_LEN - 1) + '…';
    return txt;
  };

  const previewTag = () => {
    const arr = entries();
    if (arr.length === 0) return null;
    return detectTag(arr[arr.length - 1].text);
  };

  return (
    <Show when={!dismissed()}>
      <div
        class={`minilog ${expanded() ? 'minilog--expanded' : 'minilog--collapsed'}`}
        role="region"
        aria-label="Engine event log"
      >
        <div class="minilog-header" onClick={toggleExpanded}>
          <span class="minilog-chevron" aria-hidden="true">
            {expanded() ? '▾' : '▸'}
          </span>
          <span class="minilog-title">Engine log</span>
          <Show when={!expanded()}>
            <span
              class="minilog-preview"
              style={{ color: colorFor(previewTag()) }}
              title={previewText()}
            >
              {previewText()}
            </span>
          </Show>
          <Show when={expanded()}>
            <span class="minilog-count">{entries().length}</span>
          </Show>
          <button
            class="minilog-close"
            title="Dismiss"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
        </div>

        <Show when={expanded()}>
          <div class="minilog-body" ref={bodyRef}>
            <For each={entries()}>
              {(ev) => {
                const tag = detectTag(ev.text);
                return (
                  <div class="minilog-row">
                    <span class="minilog-time">{fmtTime(ev.t)}</span>
                    <span class="minilog-text" style={{ color: colorFor(tag) }}>
                      {ev.text}
                    </span>
                  </div>
                );
              }}
            </For>
            <Show when={entries().length === 0}>
              <div class="minilog-empty">(waiting for engine events…)</div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
