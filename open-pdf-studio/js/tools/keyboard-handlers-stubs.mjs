// Laadhaken voor tests van keyboard-handlers.js (#551): het echte bestand
// laadt, maar elke relatieve import ervan wordt een stub. Elke geïmporteerde
// naam wordt een functie die doorgeeft aan globalThis.__khStubs[naam]
// (ontbreekt die, dan doet ze niets); `state` is het object
// globalThis.__khStubs.state. Zet __khStubs dus vóór de import neer.
//
// Gebruik: register('./keyboard-handlers-stubs.mjs', import.meta.url) en
// daarna `await import('./keyboard-handlers.js')`.

import { readFileSync } from 'node:fs';

const DOEL = new URL('./keyboard-handlers.js', import.meta.url).href;
const MARKERING = 'kh-stub=';

let namenPerBron = null;
function namen() {
  if (namenPerBron) return namenPerBron;
  const bron = readFileSync(new URL(DOEL), 'utf8');
  namenPerBron = new Map();
  for (const m of bron.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)) {
    const lijst = m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    namenPerBron.set(m[2], [...(namenPerBron.get(m[2]) ?? []), ...lijst]);
  }
  return namenPerBron;
}

const zonderQuery = (url) => url.split('?')[0];

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && zonderQuery(context.parentURL) === DOEL && specifier.startsWith('.')) {
    const url = new URL(specifier, DOEL).href;
    return { url: `${url}?${MARKERING}${encodeURIComponent(specifier)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const i = url.indexOf(`?${MARKERING}`);
  if (i >= 0) {
    const spec = decodeURIComponent(url.slice(i + 1 + MARKERING.length));
    const source = [...new Set(namen().get(spec) ?? [])].map((naam) => (naam === 'state'
      ? 'export const state = globalThis.__khStubs.state;'
      : `export const ${naam} = (...a) => (globalThis.__khStubs?.[${JSON.stringify(naam)}] ?? (() => undefined))(...a);`)).join('\n');
    return { format: 'module', source, shortCircuit: true };
  }
  // Het package.json van de app zegt geen "type": "module": zelf als module laden.
  if (zonderQuery(url) === DOEL) return { format: 'module', source: readFileSync(new URL(DOEL), 'utf8'), shortCircuit: true };
  return nextLoad(url, context);
}
