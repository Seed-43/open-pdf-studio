import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { naHerladen } from './herladen.js';

test('na een gewone start: niets te melden', () => {
  assert.deepEqual(naHerladen({ herladen: 0, gestopt: false }, { headless: false }), { log: null, toonMelding: false });
  assert.deepEqual(naHerladen(undefined, { headless: false }), { log: null, toonMelding: false });
});

test('na een automatische herlaadbeurt: alleen een logregel', () => {
  const uit = naHerladen({ herladen: 1, gestopt: false }, { headless: false });
  assert.match(uit.log, /reloaded automatically after a renderer failure \(1x/);
  assert.equal(uit.toonMelding, false);
});

test('grens bereikt: melding in de app, headless alleen in het log', () => {
  const app = naHerladen({ herladen: 2, gestopt: true }, { headless: false });
  assert.equal(app.toonMelding, true);
  assert.match(app.log, /reload limit reached/);
  const headless = naHerladen({ herladen: 2, gestopt: true }, { headless: true });
  assert.equal(headless.toonMelding, false);
  assert.match(headless.log, /message suppressed \(headless\)/);
});

test('de grens in Rust: 2 keer per 5 minuten, alleen hoofdvenster en renderproces, alleen bureaublad', () => {
  const rs = readFileSync(new URL('../../src-tauri/src/crashlog.rs', import.meta.url), 'utf8');
  assert.match(rs, /pub const HERLAAD_MAX: usize = 2;/);
  assert.match(rs, /pub const HERLAAD_VENSTER_MS: u64 = 5 \* 60_000;/);
  assert.match(rs, /herlaad_besluit\(label == "main", soort/);
  assert.match(rs, /#\[cfg\(desktop\)\]\s+\{\s+let wv = webview\.clone\(\);/);
});
