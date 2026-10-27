// Launches `tauri dev` with BOTH:
//   • WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//     → enables Chrome DevTools Protocol so the zoom-observer.mjs and any
//       other CDP-based tooling can attach.
//   • --mcp-server                       (passed as a CLI arg to the binary)
//     → starts the in-process MCP server on port 9223 so an AI-driven
//       debug loop can call the synthetic-wheel + zoom-anchor-test tools.
//   • OPDS_HEADLESS=1 (src-tauri/src/headless.rs)
//     → the window stays off-screen, without taskbar button, and never takes
//       focus, so a remote-controlled session does not disturb the desktop.
//       Start with OPDS_HEADLESS=0 to get a normal, visible window.
//
// Use this instead of plain `tauri dev` whenever you want the app to be
// remote-controllable. Plain `tauri dev` still works for normal development.

import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222',
  OPDS_HEADLESS: process.env.OPDS_HEADLESS ?? '1',
};

// The TRIPLE-dash dance is intentional and verified against tauri 2.10:
//   `tauri dev` runs `cargo run` under the hood.
//   - First `--` tells `tauri` to forward the rest to cargo.
//   - Second `--` tells cargo to forward the rest to the binary.
//   - `--mcp-server` lands as a CLI arg to the binary itself
//     (parsed by clap in src-tauri/src/main.rs).
// Without the second `--`, cargo tries to interpret `--mcp-server`
// as a cargo flag and fails with "unexpected argument '--mcp-server'".
const child = spawn('npx', ['tauri', 'dev', '--', '--', '--mcp-server'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
