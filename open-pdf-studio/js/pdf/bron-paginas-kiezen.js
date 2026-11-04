// Choose which pages of a source PDF to bring in (#963): Insert from File and
// Replace Pages ask this when the picked PDF has more than one page. A
// one-page PDF needs no question.

/**
 * Ask which pages of `srcBytes` to use.
 * @param {Uint8Array} srcBytes the source PDF
 * @param {string} naam file name, shown in the dialog
 * @param {number} aantal page count of the source
 * @param {'insert'|'replace'} doel what the pages are for (dialog wording)
 * @returns {Promise<number[]|null>} 0-based page indices in source order, or
 *   null when the user cancelled.
 */
export async function kiesBronPaginas(srcBytes, naam, aantal, doel = 'insert') {
  if (aantal <= 1) return aantal === 1 ? [0] : [];
  const { openDialog } = await import('../solid/stores/dialogStore.js');
  return new Promise((resolve) => {
    let klaar = false;
    const einde = (paginas) => {
      if (klaar) return;
      klaar = true;
      resolve(paginas && paginas.length ? paginas.map(p => p - 1) : null);
    };
    openDialog('choose-pages', { bytes: srcBytes, naam, aantal, doel, onDone: einde });
  });
}

/** "1-3, 5" for a sorted list of 1-based pages. */
export function bereikTekst(paginas) {
  const delen = [];
  for (let i = 0; i < paginas.length; i++) {
    const begin = paginas[i];
    while (i + 1 < paginas.length && paginas[i + 1] === paginas[i] + 1) i++;
    delen.push(begin === paginas[i] ? String(begin) : `${begin}-${paginas[i]}`);
  }
  return delen.join(', ');
}
