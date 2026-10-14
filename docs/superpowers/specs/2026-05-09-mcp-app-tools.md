# MCP "live app" tools (`app_*`) — spec

Status: implemented (iter `mcp-app-tools-2026-05-09`); extended with mouse
+ keyboard tools (iter `mcp-input-tools`).
Author: Claude (mcp-app-tools agent)

The existing MCP server (see `2026-05-08-render-regression-test-design.md`)
exposes only **headless** rendering tools (`screenshot_page`, `screenshot_all`,
`get_pdf_metadata`, `list_test_pdfs`). Those drive the pure-Rust
`open-pdf-render` engine and never touch the running Tauri WebView — perfect
for renderer regression testing, useless for reproducing UI bugs that depend
on the live app's state (zoom, scroll, panel visibility, annotation overlay,
etc.).

This iter adds **eleven** tools that drive the **live** WebView from outside,
so a future agent can:

1. Open a PDF in a fresh tab,
2. Set or step the zoom,
3. Capture the resulting canvas + overlays,
4. Move/click/drag the mouse over CSS pixel coordinates,
5. Send wheel events (with optional ctrl modifier for zoom-to-cursor),
6. Press keys and type text,

…all over the same JSON-RPC channel, without ever clicking the GUI.

## Architecture

```
┌────────────────────────┐    HTTP JSON-RPC     ┌────────────────────────┐
│ test harness / curl    │ ────────────────────►│ Rust MCP server (axum) │
│                        │ ◄──────────────────── │  port 9223 / 9224      │
└────────────────────────┘                       └─────────┬──────────────┘
                                                           │
                                                  Tauri Emitter::emit
                                                  "mcp:open-pdf" etc.
                                                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ WebView (js/mcp-bridge.js)                                          │
│  Listens for mcp:* events, runs the matching app function           │
│  (loadPDF / setZoom / canvas.toDataURL), calls the Rust command     │
│  `app_response(request_id, result)` to deliver the answer.          │
└─────────────────────────────────────────────────────────────────────┘
                                                           │
                                                  oneshot::Receiver
                                                  in mcp_app_bridge
                                                           ▼
                                                 tool returns the JSON
```

The Rust side (`src-tauri/src/mcp_app_bridge.rs`) keeps a `HashMap<u64,
oneshot::Sender<Value>>` keyed by request id. Each `app_*` tool allocates
an id, emits the matching `mcp:*` event with `{request_id, params}`,
then `tokio::time::timeout`-awaits the oneshot. The JS side
(`js/mcp-bridge.js`) calls back through the new `app_response` Tauri
command, which removes the sender from the map and forwards the result.

## Tool reference

All tools live under `tools/call`. Curl examples assume the server is on
`127.0.0.1:9224` (start with `OPS_ENABLE_MCP=1 npm run tauri -- dev -- -- --mcp-server --mcp-port 9224`).

### `app_open_pdf`

Open a PDF in a new tab (or focus the existing tab if already open).

| param  | type   | required |
|--------|--------|----------|
| `path` | string | yes      |

Returns:

```json
{ "ok": true, "tab_id": <int>, "page_count": <int>, "file_path": <string> }
```

```bash
curl -s -X POST http://127.0.0.1:9224/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_open_pdf","arguments":{"path":"C:/.../Tekst.pdf"}}}'
```

Timeout: 60 s (loading large PDFs can take a while).

### `app_set_zoom`

Set the page-view zoom to an absolute scale factor.

| param   | type   | required | range            |
|---------|--------|----------|------------------|
| `scale` | number | yes      | `0.05` … `32.0`  |

`scale=1.0` is 100 %.

Returns:

```json
{ "ok": true, "requested": <number>, "actual": <number|null> }
```

`actual` is read back from the live viewport (vector mode clamps to the
configured min/max), or `null` when no document is open.

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"app_set_zoom","arguments":{"scale":1.5}}}'
```

### `app_zoom_in` / `app_zoom_out`

Trigger one toolbar-equivalent zoom step. No params.

Returns: `{ "ok": true, "actual": <number|null> }`

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"app_zoom_in","arguments":{}}}'
```

### `app_screenshot_view`

Capture the live app as a PNG and return it as base64. With the default
`scope: "document"` it composites the current page view (`#pdf-canvas` +
`#text-highlight-canvas` + `#annotation-canvas`).

| param      | type    | required | default      |
|------------|---------|----------|--------------|
| `width`    | integer | no       | `2000`       |
| `scope`    | string  | no       | `"document"` |
| `selector` | string  | with `element` | — |

`width` is the maximum longer-side pixel size of the PNG — the output is
scaled down (preserving aspect) when the capture is larger.

`scope` (#583):

- `document` — the canvases only, not the surrounding chrome. Works on every
  platform.
- `window` — a native capture of the whole web view (WebView2
  `CapturePreview` through the Tauri command `capture_webview_png`): title
  bar, ribbon including extension tabs, side panels, document view and status
  bar.
- `element` — the window capture cropped to `selector`
  (`getBoundingClientRect`, limited to the window). A selector without a scope
  means `element`.

`window` and `element` are Windows-only for now; elsewhere they return
`{ ok: false, error: "... not supported on this platform yet ..." }`. The crop
and downscale rules are in `js/core/mcp-schermafdruk.js`.

Returns:

```json
{ "ok": true, "scope": "document", "png_base64": "<no-prefix-base64>", "width": <int>, "height": <int>,
  "bounds": { "x": <css px>, "y": <css px>, "width": <css px>, "height": <css px> }, "devicePixelRatio": <number> }
```

`bounds` is the captured area in CSS pixels (for `document` the page canvas).
`element` also returns `elementBounds` (the element's full rectangle), and
`window`/`element` return `capture` (the size of the native capture in
physical pixels).

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"app_screenshot_view","arguments":{"width":1200}}}'
```

### `app_mouse_move`

Dispatch a synthetic `mousemove` at viewport CSS coordinates `(x, y)`
inside the live WebView. Coordinates are top-left origin, the same as
`MouseEvent.clientX/Y`.

| param | type    | required |
|-------|---------|----------|
| `x`   | integer | yes      |
| `y`   | integer | yes      |

Returns:

```json
{ "ok": true, "x": <int>, "y": <int>,
  "target": { "tag": "canvas", "id": "pdf-canvas", "classes": [] } }
```

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"app_mouse_move","arguments":{"x":500,"y":300}}}'
```

### `app_mouse_click`

Click at `(x, y)`. Generates the standard `mousemove → mousedown → mouseup
→ click` sequence (or `… → contextmenu` for the right button).

| param    | type    | required | default | values                         |
|----------|---------|----------|---------|--------------------------------|
| `x`      | integer | yes      |         |                                |
| `y`      | integer | yes      |         |                                |
| `button` | string  | no       | `left`  | `"left"` `"middle"` `"right"`  |

Returns: `{ ok: true, x, y, button, target: {...} }`

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"app_mouse_click","arguments":{"x":120,"y":80,"button":"left"}}}'
```

### `app_mouse_drag`

Drag from `(x1, y1)` to `(x2, y2)` with `steps` interpolated mousemove
events. Sequence: `mousedown` at start → N × `mousemove` (with `buttons`
bitmask set) → `mouseup` at end. Used for marquee-select, drag-to-pan,
drag-to-create-annotation, etc.

| param    | type    | required | default | values                         |
|----------|---------|----------|---------|--------------------------------|
| `x1`     | integer | yes      |         |                                |
| `y1`     | integer | yes      |         |                                |
| `x2`     | integer | yes      |         |                                |
| `y2`     | integer | yes      |         |                                |
| `button` | string  | no       | `left`  | `"left"` `"middle"` `"right"`  |
| `steps`  | integer | no       | `10`    | `1 … 200`                      |

Returns: `{ ok: true, from: {x,y}, to: {x,y}, button, steps, end_target: {...} }`

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"app_mouse_drag","arguments":{"x1":300,"y1":300,"x2":700,"y2":500,"steps":15}}}'
```

### `app_scroll`

Send a `wheel` event at `(x, y)` with delta `(dx, dy)` in CSS pixels. Set
`ctrlKey: true` for ctrl+wheel zoom-to-cursor.

| param      | type    | required | default |
|------------|---------|----------|---------|
| `x`        | integer | yes      |         |
| `y`        | integer | yes      |         |
| `dx`       | integer | no       | `0`     |
| `dy`       | integer | no       | `0`     |
| `ctrlKey`  | boolean | no       | `false` |
| `shiftKey` | boolean | no       | `false` |
| `altKey`   | boolean | no       | `false` |
| `metaKey`  | boolean | no       | `false` |

Negative `dy` scrolls up (zoom in with ctrl), positive scrolls down (zoom
out with ctrl). `deltaMode` is fixed at `0` (DOM_DELTA_PIXEL).

Returns: `{ ok: true, x, y, dx, dy, ctrlKey, target: {...} }`

```bash
# ctrl+wheel up over (500, 300) → zoom-to-cursor in
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"app_scroll","arguments":{"x":500,"y":300,"dx":0,"dy":-100,"ctrlKey":true}}}'
```

### `app_key`

Press a single key (with optional modifiers). Dispatches `keydown` then
`keyup` on `document.activeElement` (or `document.body` if nothing is
focused). Modern browsers do not synthesize `keypress` for non-printable
keys, so we omit it.

| param   | type    | required | default |
|---------|---------|----------|---------|
| `key`   | string  | yes      |         |
| `ctrl`  | boolean | no       | `false` |
| `shift` | boolean | no       | `false` |
| `alt`   | boolean | no       | `false` |
| `meta`  | boolean | no       | `false` |

`key` follows the W3C [`KeyboardEvent.key`] vocabulary: `"Escape"`,
`"Enter"`, `"ArrowLeft"`, `"a"`, `"A"`, `"+"`, etc.

Returns: `{ ok: true, key, modifiers: {...}, target: {...} }`

```bash
# Ctrl+Z (undo)
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"app_key","arguments":{"key":"z","ctrl":true}}}'

# Escape
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"app_key","arguments":{"key":"Escape"}}}'
```

### `app_type`

Type a string of characters into the focused element. Per character:
`keydown → beforeinput → (value splice) → input → keyup`. For
`<input>` and `<textarea>` we splice the new character into `.value` and
update the selection so frameworks watching the field's value (SolidJS
included) see the change. For `contenteditable` fragments we fall back to
`document.execCommand('insertText', …)`. For non-editable targets we send
only the keyboard events.

| param  | type   | required |
|--------|--------|----------|
| `text` | string | yes      |

Returns: `{ ok: true, typed: <int> }`

```bash
curl -s -X POST http://127.0.0.1:9224/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"app_type","arguments":{"text":"Hello"}}}'
```

## Reproducing the zoom-bug (out-of-scope for this iter)

The user-reported bug: "De 1e pagina van een pdf heeft iets geks dat als
je inzoomt/uitzoomt dat de view in een soort kader komt" — the first page
ends up "in some kind of frame" when zooming. With the new tools the
follow-up iter can script:

```bash
# 1. open a multi-page pdf
curl ... app_open_pdf {"path": "..."}
# 2. screenshot the baseline
curl ... app_screenshot_view {"width": 1600}     # save as p0_baseline.png
# 3. zoom in twice
curl ... app_zoom_in {}
curl ... app_zoom_in {}
# 4. screenshot after zoom
curl ... app_screenshot_view {"width": 1600}     # save as p0_zoomed.png
# 5. zoom back out
curl ... app_zoom_out {}
curl ... app_zoom_out {}
# 6. screenshot — bug shows itself here as a visible frame around the page
curl ... app_screenshot_view {"width": 1600}     # save as p0_back.png
```

Diff `p0_baseline.png` vs `p0_back.png` to confirm the bug, iterate on a
fix in `pdf/renderer.js` / `pdf/pdf-viewport.js`, re-run.

## Operational notes

- The MCP server now starts from `tauri::Builder::setup()` so the
  `app_*` tools have access to the `AppHandle` they need to emit events.
  The headless tools (`screenshot_page` etc.) keep working unchanged.
- Tests instantiate `AppState { app_handle: None, .. }` and exercise the
  pure-Rust tools directly; calling an `app_*` tool against such a state
  returns an "AppHandle unavailable" error instead of panicking.
- The bridge logs `[mcp-bridge] WebView ready, listening for: [...]` to
  the app's stderr once the JS side has registered all listeners — useful
  for confirming the bridge is wired before sending tool calls.
- Each `app_*` tool has its own timeout (60 s for `app_open_pdf`, 30 s
  for `app_screenshot_view`, `app_mouse_drag` and `app_type`, 10 s for
  the input tools, 15 s for the rest). On timeout the pending oneshot is
  cleaned up so request IDs don't leak.
- Mouse + keyboard events are **synthetic** — they bypass the OS pointer
  driver and dispatch directly into the JS event loop. This means: (a)
  the OS cursor doesn't visually move, (b) Tauri's drag-region detection
  is unaffected, (c) `event.isTrusted` is `false` (which most app code
  doesn't check). It also means events go to the WebView only, so global
  shortcuts handled by the OS or Tauri menu won't fire.
- Coordinates are CSS pixels relative to the WebView document viewport
  (top-left = 0, 0). At 100 % DPI on a 1920×1080 window with default
  chrome, the PDF canvas typically starts around y≈80 (below the toolbar)
  and ends around y≈1000 (above the status bar). Use `app_screenshot_view`
  with the surrounding chrome cropped, or take an OS-level screenshot
  first, to find the right click coordinates.
