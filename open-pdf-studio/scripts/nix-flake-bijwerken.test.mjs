// Nix-pakket (#319): flake.nix pakt de Linux-AppImage van een release in.
// Nix zelf draait hier niet; deze tests bewaken wat zonder Nix te controleren
// is: de hash-omrekening, het bijwerkscript en de bestanden waar de flake naar
// verwijst.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

import { appImageNaam, sriUitHex, appImageUitRelease, werkFlakeBij } from './nix-flake-bijwerken.mjs';

const repoRoot = new URL('../../', import.meta.url);
const flake = readFileSync(new URL('flake.nix', repoRoot), 'utf8');

// sha256 van Open.PDF.Studio_2026.41.0_amd64.AppImage zoals GitHub hem meldt.
const HEX_41 = '80cce48ab6f2d1ebca1310fb9d084ad5ad5c5901fdb1e53686f6282547f8057c';
const SRI_41 = 'sha256-gMzkirby0evKExD7nQhK1a1cWQH9seU2hvYoJUf4BXw=';

test('hex-sha256 wordt de SRI-notatie die Nix verwacht', () => {
  assert.equal(sriUitHex(HEX_41), SRI_41);
  assert.equal(sriUitHex(`sha256:${HEX_41.toUpperCase()}`), SRI_41);
  assert.throws(() => sriUitHex('abc'));
  assert.throws(() => sriUitHex(undefined));
});

test('de AppImage heet zoals de release-workflow hem publiceert', () => {
  assert.equal(appImageNaam('2026.41.0'), 'Open.PDF.Studio_2026.41.0_amd64.AppImage');
});

test('versie en hash komen uit het release-object van de GitHub-API', () => {
  const release = {
    tag_name: 'v2026.41.0',
    assets: [
      { name: 'Open.PDF.Studio_2026.41.0_amd64.deb', digest: 'sha256:00' },
      { name: 'Open.PDF.Studio_2026.41.0_amd64.AppImage', digest: `sha256:${HEX_41}` },
    ],
  };
  assert.deepEqual(appImageUitRelease(release), { versie: '2026.41.0', hash: SRI_41 });
});

test('een release zonder AppImage of zonder digest geeft een duidelijke fout', () => {
  assert.throws(() => appImageUitRelease({ tag_name: 'v2026.41.0', assets: [] }), /geen Open\.PDF\.Studio/);
  assert.throws(
    () => appImageUitRelease({ tag_name: 'v2026.41.0', assets: [{ name: appImageNaam('2026.41.0'), browser_download_url: 'u' }] }),
    /nix-prefetch-url/,
  );
  assert.throws(() => appImageUitRelease({ tag_name: 'nightly', assets: [] }), /onverwachte tag/);
});

test('werkFlakeBij zet versie en hash en laat de rest staan', () => {
  const nieuw = werkFlakeBij(flake, { versie: '2026.42.0', hash: 'sha256-AAAA' });
  assert.match(nieuw, /^\s*version = "2026\.42\.0";\r?$/m);
  assert.match(nieuw, /^\s*hash = "sha256-AAAA";\r?$/m);
  // Alleen die twee regels veranderen.
  const oudRegels = flake.split('\n');
  const nieuwRegels = nieuw.split('\n');
  assert.equal(nieuwRegels.length, oudRegels.length);
  assert.equal(nieuwRegels.filter((r, i) => r !== oudRegels[i]).length, 2);
  // Ook met Windows-regeleinden.
  const crlf = werkFlakeBij(flake.replace(/\r?\n/g, '\r\n'), { versie: '2026.42.0', hash: 'sha256-AAAA' });
  assert.match(crlf, /version = "2026\.42\.0";\r\n/);
});

test('werkFlakeBij weigert een flake zonder of met dubbele versieregel', () => {
  assert.throws(() => werkFlakeBij('{ }', { versie: '1.0.0', hash: SRI_41 }), /version/);
  const dubbel = flake.replace(/^(\s*version = "[^"]*";)$/m, '$1\n$1');
  assert.throws(() => werkFlakeBij(dubbel, { versie: '1.0.0', hash: SRI_41 }), /gevonden 2/);
});

test('flake.nix bevat een geldige versie, SRI-hash en release-URL', () => {
  assert.match(flake, /^\s*version = "\d+\.\d+\.\d+";\r?$/m);
  assert.match(flake, /^\s*hash = "sha256-[A-Za-z0-9+/]{43}=";\r?$/m);
  assert.ok(
    flake.includes('releases/download/v${version}/Open.PDF.Studio_${version}_amd64.AppImage'),
    'de download-URL volgt de naam van het release-bestand niet meer',
  );
  assert.match(flake, /appimageTools\.wrapType2/);
});

test('alle repo-bestanden waar flake.nix naar verwijst bestaan', () => {
  const paden = [...flake.matchAll(/\$\{\.\/([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(paden.length >= 2, 'verwacht verwijzingen naar desktopbestand en pictogrammen');
  for (const pad of paden) {
    assert.ok(existsSync(new URL(pad, repoRoot)), `flake.nix verwijst naar ontbrekend ${pad}`);
  }
});

test('het desktopbestand start het programma dat de flake installeert', () => {
  const desktop = readFileSync(new URL('flatpak/org.openaec.OpenPdfStudio.desktop', repoRoot), 'utf8');
  assert.match(desktop, /^Exec=open-pdf-studio\b/m);
  assert.match(flake, /pname = "open-pdf-studio";/);
  assert.match(flake, /mainProgram = "open-pdf-studio";/);
});
