# Open PDF Studio — MCP for Claude Desktop / Claude Code

Open PDF Studio ships a **full MCP server inside the app** (75 public tools: open /
zoom / annotate / save PDFs, drive the assistant, call the OpenAEC AI, inspect
viewport state, …). It is implemented in Rust (`src-tauri/src/mcp_server.rs`)
and speaks **HTTP JSON-RPC** on `127.0.0.1:9223/mcp`.

Claude Desktop and Claude Code speak MCP over **stdio**, so this folder adds a
tiny zero-dependency bridge (`server.mjs`) that proxies stdio ⇄ HTTP. Nothing
is reimplemented here — `tools/list` / `tools/call` are answered by the live
app, so the bridge always reflects exactly what the app exposes.

```
Claude Desktop / Code  ──stdio──►  server.mjs  ──HTTP──►  Open PDF Studio
                       ◄─stdio──                ◄──HTTP──  (in-app Rust server)
```

This mirrors the working `open-calc-studio` setup, but thinner: Calc reimplements
its domain logic in the Node server; here the app already *is* the MCP server.

---

## 1. Start the app with the MCP server enabled

The MCP server is **on by default**; check it in the app under
**Settings > General > AI link (MCP)** (port 9223 by default). That starts the
server with the public tool set — every user-facing tool, each with MCP
annotations, without the developer/test tools.

Developers can start it with a flag instead; that route exposes **all** tools,
including the test tools:

```bash
# Dev (debug build) — from open-pdf-studio/open-pdf-studio/
npm run tauri -- dev -- -- --mcp-server
#                       └── pass-through to the app binary ──┘

# Different port:
npm run tauri -- dev -- -- --mcp-server --mcp-port 9300

# Release build — must also set OPS_ENABLE_MCP=1 (safety guard):
OPS_ENABLE_MCP=1 "Open PDF Studio.exe" --mcp-server
```

When ready the app logs `MCP server listening on http://127.0.0.1:9223/mcp`
and `[mcp-bridge] WebView ready, listening for: [...]`.

## 2. Verify the bridge can reach it

```bash
node mcp-stdio/server.mjs --probe
# → [open-pdf-studio mcp bridge] OK — 75 tools available at http://127.0.0.1:9223/mcp
```

If you used a non-default port, set it first: `OPS_MCP_PORT=9300 node mcp-stdio/server.mjs --probe`.

## 3a. Claude Code

`.mcp.json` already lives in the repo root, so just open this repo in Claude
Code and approve the **open-pdf-studio** server when prompted. Then ask Claude
to call e.g. `app_accounts_status` or `app_list_tabs`.

Change the port via the `env.OPS_MCP_PORT` field in `.mcp.json`.

## 3b. Claude Desktop

Edit `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and add:

```json
{
  "mcpServers": {
    "open-pdf-studio": {
      "command": "node",
      "args": ["C:\\Users\\rickd\\Documents\\GitHub\\open-pdf-studio\\mcp-stdio\\server.mjs"],
      "env": { "OPS_MCP_PORT": "9223" }
    }
  }
}
```

Restart Claude Desktop. The **open-pdf-studio** tools appear in the 🔌 menu.
(If `node` isn't on Claude Desktop's PATH, use its absolute path, e.g.
`"command": "C:\\Program Files\\nodejs\\node.exe"`.)

---

## Talking to the assistant

The reason this exists — drive Open PDF Studio's assistant from Claude:

- **`app_assistant_ask`** — submit a message into the in-app assistant window,
  exactly as if the user typed it. The answer comes from whichever provider
  resolves: OpenAEC AI → a personal Claude key → the **MCP relay** (below).
- **`app_assistant_pending`** → **`app_assistant_answer`** — the relay. When no
  AI provider is configured, the app queues each assistant question. Call
  `app_assistant_pending` to take the oldest question, compute an answer, then
  `app_assistant_answer { id, text }` to make it appear in the window. This is
  how *Claude itself becomes the assistant's brain*.
- **`app_assistant_history`** — read back the conversation to confirm a reply.
- **`app_agent_task_pending`** → **`app_agent_task_result`** — structured tasks
  from extensions, without the assistant window or a chat message. An
  extension submits a task (for example recognising the floor plan on one
  page) with the context fields it chooses to share and a `resultSchema`.
  Take the oldest task with `app_agent_task_pending` (optionally `{ kind }`),
  then answer `app_agent_task_result { id, result }` with an object that
  matches the schema, or `{ id, error: { message } }`. The result goes only to
  the extension that asked, as a proposal: nothing is drawn until it applies
  it. A task is cancelled when the user switches or closes the document or
  when its source, page or scale changes.
- **`app_ai_complete`** — call the OpenAEC AI directly (needs the app signed in
  to OpenAEC; returns `{ ok, signedInAs, text, credits }`).
- **`app_accounts_status`** / **`app_accounts_fetch`** — check sign-in and call
  any `/me/*` Accounts API from the signed-in app.

A few of the many PDF tools: `app_open_pdf`, `app_new_blank_pdf`,
`app_go_to_page`, `app_set_zoom` / `app_fit_width`, `app_create_annotation`,
`app_list_annotations`, `app_get_page_text`, `app_replace_text`,
`app_translate_page`, `app_save_pdf`,
`app_screenshot_view`. The full,
authoritative list is in `src-tauri/src/mcp_server.rs` (`handle_tools_list`)
and documented in `docs/superpowers/specs/2026-05-09-mcp-app-tools.md`.

`app_screenshot_view` captures the page view by default. Pass
`{"scope":"window"}` for the whole window (ribbon, extension tabs, side
panels, status bar) or `{"scope":"element","selector":".ribbon-container"}`
for one element; the result adds the captured `bounds` (CSS px) and
`devicePixelRatio`. The window and element captures are Windows-only for now.

`app_list_commands` lists every ribbon tab as `ribbon-tab:<tab>` (extension
tabs included) and the buttons of extension tabs with the extension tab id in
`tab`; `app_run_command` runs them. To check what a click did, `app_read_ui`
returns a compact accessibility-style tree (role, name, state such as
disabled, checked, selected, expanded and value) of the ribbon, the side
panels and the status bar, or of the elements a `selector` matches.

## Edit or translate existing page text

Open a PDF, call `app_get_page_text` with a 1-based page number, and use its
`spans` as the translation units. Each span includes the original text, a
document-bound `id`, page-space bounding box, font information, rotation and
fill colour when it can be recovered. For each translated span, call
`app_replace_text` with `spanId`, the exact `expectedText`, and `newText`.
Then call `app_save_pdf` with an output path and reopen the result to check it.
For example:

```json
{"spanId":"42:p1:i0-3","expectedText":"Welcome","newText":"Welkom"}
```

The replacement is fitted into the original run width, retaining its anchor,
rotation and colour. If the PDF's embedded font subset cannot encode the new
characters, the app embeds a bundled font that covers them and reports
`fontFallback` and `fontUsed`. It refuses a run it cannot remove unambiguously
from the PDF content stream or fit legibly. It never paints a white rectangle
over page artwork for MCP replacements. A returned `rasterBackgroundOverlap`
warning means that an overlapping background image may already contain the
same words as pixels; those pixels cannot be edited as PDF text. Colour may
also be `null` for some PDFs; then supply an explicit `#RRGGBB` `color` to
`app_replace_text`. That tool edits one line per call. To translate a whole
page, send all spans of that page in one `app_translate_page` call:

```json
{"page":1,"replacements":[
  {"spanId":"42:p1:i0-3","expectedText":"Welcome","newText":"Welkom"},
  {"spanId":"42:p1:i4-9","expectedText":"Opening hours","newText":"Openingstijden"}]}
```

It applies the same rules, checks all replacements together on one copy of
the PDF and adds them as one undo step. It is all or nothing: when one
replacement fails, nothing changes and `results` gives the error per span.
Review the saved pages afterwards. A scanned page with
no selectable text must first go through OCR; pixels in the scan are not
editable text spans.

---

## Direct HTTP (no bridge) — Claude Code only, optional

Claude Code also supports HTTP MCP servers, so you can skip `server.mjs`:

```json
{ "mcpServers": { "open-pdf-studio": { "type": "http", "url": "http://127.0.0.1:9223/mcp" } } }
```

The stdio bridge is the recommended default because it works identically in
both Claude Desktop and Claude Code and gives clearer "app not running" errors.

## Troubleshooting

- **`Open PDF Studio is not reachable`** — the app isn't running, or the AI
  link was turned off, or it's on a different port. Check Settings > General >
  AI link (MCP) (on by default) and that the port matches. While the app is down the bridge
  still answers `tools/list` (from `tools.json`), so the client keeps its tools.
- **Tools call but nothing happens in the UI** — `app_*` tools need the live
  WebView; make sure you launched the GUI app (not a headless build).
- **Release build "refused to start"** — set `OPS_ENABLE_MCP=1`.
