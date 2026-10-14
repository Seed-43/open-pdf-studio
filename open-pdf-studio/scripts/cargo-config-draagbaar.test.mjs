// Draagbare Cargo-instellingen (#582): een verse kloon moet op elke machine
// bouwen zonder bijgehouden bestanden aan te passen. Geen .cargo/config van de
// repo mag daarom een absoluut pad bevatten; de manifest-resource voor de
// testbinaries met de GNU-toolchain komt uit build.rs, met een pad vanaf
// CARGO_MANIFEST_DIR.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(app, '..');
const tauri = join(app, 'src-tauri');

const cargoConfigs = [repo, app, tauri]
  .flatMap((map) => ['config.toml', 'config'].map((naam) => join(map, '.cargo', naam)))
  .filter((pad) => existsSync(pad));

// Windows-stationsletter, UNC-pad of een thuismap op Linux/macOS.
const ABSOLUUT = /(?:^|["'=\s])(?:[A-Za-z]:[\\/]|\\\\|\/home\/|\/Users\/)/m;

test('geen .cargo/config in de repo bevat een absoluut pad', () => {
  assert.ok(cargoConfigs.length > 0, 'de workspace-config (crt-static) hoort er te zijn');
  for (const pad of cargoConfigs) {
    const regels = readFileSync(pad, 'utf8').split(/\r?\n/).filter((r) => !r.trim().startsWith('#'));
    const fout = regels.filter((r) => ABSOLUUT.test(r));
    assert.deepEqual(fout, [], pad);
  }
});

test('test.res wordt niet meer via rustflags gelinkt (dat raakte elk build-script)', () => {
  for (const pad of cargoConfigs) {
    assert.doesNotMatch(readFileSync(pad, 'utf8'), /test\.res/, pad);
  }
});

test('build.rs linkt test.res alleen voor de GNU-toolchain, vanaf CARGO_MANIFEST_DIR', () => {
  const bron = readFileSync(join(tauri, 'build.rs'), 'utf8');
  const start = bron.indexOf('if target == "x86_64-pc-windows-gnu"');
  assert.ok(start >= 0, 'GNU-tak ontbreekt in build.rs');
  const eind = bron.indexOf('tauri_build::build()', start);
  const tak = bron.slice(start, eind >= 0 ? eind : undefined);
  assert.match(tak, /CARGO_MANIFEST_DIR/);
  assert.match(tak, /join\("test\.res"\)/);
  assert.match(tak, /cargo:rustc-link-arg=\{\}/);
  assert.ok(existsSync(join(tauri, 'test.res')), 'src-tauri/test.res hoort bij de repo');
});
