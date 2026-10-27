// Leesbare tekst van een fout, voor meldingen aan de gebruiker (#596).
//
// Een fout uit Tauri (invoke, plugins) is meestal een gewone string, geen
// Error: `error.message` was dan leeg en de melding las "Failed to load PDF:"
// zonder reden. Deze functie geeft voor elke vorm iets leesbaars terug.

/** @param {unknown} fout */
export function foutBericht(fout) {
  if (fout == null) return '?';
  if (typeof fout === 'string') return fout.trim() || '?';
  if (typeof fout === 'object') {
    const { message, detail, code } = /** @type {any} */ (fout);
    for (const deel of [message, detail, code]) {
      if (typeof deel === 'string' && deel.trim()) return deel.trim();
    }
  }
  const tekst = String(fout);
  if (tekst && tekst !== '[object Object]') return tekst;
  try {
    return JSON.stringify(fout);
  } catch {
    return '?';
  }
}
