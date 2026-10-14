#!/usr/bin/env node
// Werkt flake.nix (in de repo-root) bij naar een gepubliceerde release (#319).
//
// Het Nix-pakket pakt de Linux-AppImage van de release in. Daarvoor zijn
// alleen de versie en de sha256 van die AppImage nodig; GitHub geeft die
// hash als `digest` bij elk release-bestand, dus niets hoeft gedownload te
// worden.
//
// Gebruik (na het publiceren van een release):
//   node open-pdf-studio/scripts/nix-flake-bijwerken.mjs            # nieuwste release
//   node open-pdf-studio/scripts/nix-flake-bijwerken.mjs v2026.42.0 # een bepaalde tag

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPO = 'OpenAEC-Foundation/open-pdf-studio';
const FLAKE = new URL('../../flake.nix', import.meta.url);

/** Naam van de AppImage zoals de release-workflow hem publiceert. */
export function appImageNaam(versie) {
  return `Open.PDF.Studio_${versie}_amd64.AppImage`;
}

/** Hexadecimale sha256 -> SRI-notatie die Nix verwacht ("sha256-<base64>"). */
export function sriUitHex(hex) {
  const schoon = String(hex || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(schoon)) {
    throw new Error(`geen geldige sha256: ${hex}`);
  }
  return `sha256-${Buffer.from(schoon, 'hex').toString('base64')}`;
}

/**
 * Haalt versie en hash van de AppImage uit een release-object van de GitHub-
 * API (`/releases/latest` of `/releases/tags/<tag>`).
 * @returns {{versie:string, hash:string}}
 */
export function appImageUitRelease(release) {
  const versie = String(release?.tag_name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(versie)) {
    throw new Error(`onverwachte tag: ${release?.tag_name}`);
  }
  const naam = appImageNaam(versie);
  const bestand = (release.assets || []).find((a) => a.name === naam);
  if (!bestand) throw new Error(`release ${release.tag_name} heeft geen ${naam}`);
  if (!bestand.digest) {
    throw new Error(`GitHub gaf geen digest voor ${naam}; bereken hem met: nix-prefetch-url ${bestand.browser_download_url}`);
  }
  return { versie, hash: sriUitHex(bestand.digest) };
}

/**
 * Zet versie en hash in de tekst van flake.nix. Gooit als een van beide niet
 * precies één keer voorkomt, zodat een omgebouwde flake niet stil half
 * bijgewerkt wordt.
 */
export function werkFlakeBij(tekst, { versie, hash }) {
  const regels = [
    // (?=\r?$): ook een flake met Windows-regeleinden wordt herkend.
    [/^(\s*version = ")[^"]*(";)(?=\r?$)/m, versie, 'version'],
    [/^(\s*hash = ")sha256-[^"]*(";)(?=\r?$)/m, hash, 'hash'],
  ];
  let uit = tekst;
  for (const [patroon, waarde, naam] of regels) {
    const alle = new RegExp(patroon.source, 'gm');
    const aantal = (uit.match(alle) || []).length;
    if (aantal !== 1) throw new Error(`flake.nix: verwacht precies één "${naam} = ..."-regel, gevonden ${aantal}`);
    uit = uit.replace(patroon, `$1${waarde}$2`);
  }
  return uit;
}

async function haalRelease(tag) {
  const pad = tag ? `releases/tags/${tag.startsWith('v') ? tag : `v${tag}`}` : 'releases/latest';
  const antwoord = await fetch(`https://api.github.com/repos/${REPO}/${pad}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!antwoord.ok) throw new Error(`GitHub-API ${antwoord.status} voor ${pad}`);
  return antwoord.json();
}

async function hoofd() {
  const release = await haalRelease(process.argv[2]);
  const { versie, hash } = appImageUitRelease(release);
  const oud = await readFile(FLAKE, 'utf8');
  const nieuw = werkFlakeBij(oud, { versie, hash });
  if (nieuw === oud) {
    console.log(`flake.nix staat al op ${versie}`);
    return;
  }
  await writeFile(FLAKE, nieuw);
  console.log(`flake.nix bijgewerkt naar ${versie} (${hash})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  hoofd().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
