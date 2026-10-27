// Past het door `tauri android init` gemaakte project aan (#596).
//
// src-tauri/gen/android staat niet in git: de release-workflow (job
// build-android) maakt het elke keer opnieuw. Daarna zet dit script de eigen
// Android-bestanden uit src-tauri/android erin:
//   MainActivity.kt  systeembalken als opvulling + weergavenaam van content://
//
// Gebruik (in open-pdf-studio/): node scripts/android-project.mjs

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pad van MainActivity.kt in het gegenereerde project, voor een app-id. */
export function activiteitPad(identifier) {
  if (!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)+$/.test(identifier)) {
    throw new Error(`ongeldige app-id: ${identifier}`);
  }
  return join('src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', ...identifier.split('.'), 'MainActivity.kt');
}

/** Controleert dat het eigen bestand bij de app-id hoort. */
export function controleerPakket(kotlin, identifier) {
  const pakket = kotlin.match(/^package\s+([\w.]+)/m)?.[1];
  if (pakket !== identifier) {
    throw new Error(`MainActivity.kt heeft package ${pakket}, de app-id is ${identifier}`);
  }
}

export function pasAndroidProjectAan(basis = app) {
  const config = JSON.parse(readFileSync(join(basis, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const bron = join(basis, 'src-tauri', 'android', 'MainActivity.kt');
  const doel = join(basis, activiteitPad(config.identifier));
  if (!existsSync(doel)) {
    throw new Error(`${doel} ontbreekt: eerst \`npx tauri android init\` draaien`);
  }
  controleerPakket(readFileSync(bron, 'utf8'), config.identifier);
  copyFileSync(bron, doel);
  return [doel];
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  for (const pad of pasAndroidProjectAan()) console.log(`android-project: ${pad}`);
}
