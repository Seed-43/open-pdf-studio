// Gespatieerde tekst (Tc > 0) bewerken (#718).
//
// Bij een flinke tekenafstand (Tc vanaf ~0,15 em) zetten PDF.js (en MuPDF)
// spaties tussen de letters: de tekstlaag geeft "G e s p a t i e e r d e"
// waar het bestand "Gespatieerde" met Tc 2 heeft. De editor toonde die
// spaties, en de vervanging kwam met die spaties én met de Tc van het
// origineel terug: dubbele afstand. Nu:
//  - de tekenafstand per tekstitem komt uit de operatorlijst van PDF.js
//    (tekenafstandPerItem);
//  - bij het openen van een run met Tc > 0 gaan de enkele spaties tussen
//    losse tekens weg (zonderSpatieringsSpaties);
//  - de vervanging houdt de Tc van het origineel: in het originele font via
//    de tekst-state van de run (text-edit-inplace.js), op de terugvalroute
//    via `lineCharSpacing` van het record, en live via letterSpacing.
//
// Vrij van DOM en PDF.js, zodat het zonder browser te testen is.

const compact = (tekst) => String(tekst ?? '').replace(/\s+/g, '');

/**
 * Haal de spaties weg die de tekstextractie tussen gespatieerde letters zet:
 * binnen een woord ("G e s p a t") verdwijnen de enkele spaties tussen losse
 * tekens; twee of meer spaties (de echte woordgrens, ook gespatieerd) worden
 * één spatie. Tekst zonder dat patroon blijft zoals hij is.
 */
export function zonderSpatieringsSpaties(tekst) {
  const bron = String(tekst ?? '');
  if (!/\S \S/u.test(bron)) return bron;
  return bron
    .split(/( {2,})/u)
    .map((deel) => {
      if (/^ {2,}$/u.test(deel)) return ' ';
      // Begin- en eindspaties van het stuk blijven; alleen de kern telt.
      const m = /^( ?)(.*?)( ?)$/u.exec(deel);
      const kern = m[2];
      return /^\S( \S)+$/u.test(kern) ? `${m[1]}${kern.replace(/ /gu, '')}${m[3]}` : deel;
    })
    .join('');
}

/** Lijkt deze tekst gespatieerd ("a b c")? Alleen dan is Tc het opzoeken waard. */
export function lijktGespatieerd(tekst) {
  return /(^|\s)\S( \S){2,}(\s|$)/u.test(String(tekst ?? ''));
}

/**
 * De tekenafstand (Tc) per tekstitem van PDF.js, in punten van de pagina
 * (user space): Tc × Th × (lettergrootte van het item / Tf). 0 als het item
 * niet aan geschilderde glyfen te koppelen is.
 * @param {Array<{ str?: string, transform?: number[] }>} items textContent.items (met str)
 * @param {{ fnArray: number[], argsArray: unknown[][] }} operatorList
 * @param {Record<string, number>} OPS
 * @returns {number[]}
 */
export function tekenafstandPerItem(items, operatorList, OPS) {
  const geschilderd = [];
  let st = { tc: 0, th: 1, tfs: 1 };
  const stapel = [];
  const fn = operatorList?.fnArray || [];
  const args = operatorList?.argsArray || [];
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i];
    if (op === OPS.save) stapel.push({ ...st });
    else if (op === OPS.restore) st = stapel.pop() || { tc: 0, th: 1, tfs: 1 };
    else if (op === OPS.setCharSpacing) st.tc = Number(a?.[0]) || 0;
    else if (op === OPS.setHScale) st.th = Number.isFinite(Number(a?.[0])) ? Number(a[0]) / 100 : 1;
    else if (op === OPS.setFont) st.tfs = Number(a?.[1]) || 1;
    else if (op === OPS.showText || op === OPS.showSpacedText
        || op === OPS.nextLineShowText || op === OPS.nextLineSetSpacingShowText) {
      const glyfen = Array.isArray(a?.[0]) ? a[0] : [];
      for (const g of glyfen) {
        if (typeof g !== 'object' || typeof g?.unicode !== 'string') continue;
        for (const teken of compact(g.unicode)) geschilderd.push({ teken, tc: st.tc, th: st.th, tfs: st.tfs });
      }
    }
  }
  const letters = geschilderd.map((g) => g.teken).join('');
  const uit = Array(items.length).fill(0);
  let cursor = 0;
  for (let index = 0; index < items.length; index++) {
    const waarde = compact(items[index]?.str);
    if (!waarde) continue;
    const at = letters.startsWith(waarde, cursor) ? cursor : letters.indexOf(waarde, cursor);
    if (at < 0 || at - cursor > 200) continue;
    const eerste = geschilderd[at];
    cursor = at + waarde.length;
    if (!eerste || !eerste.tc) continue;
    const t = items[index]?.transform;
    const grootte = Array.isArray(t) ? Math.hypot(t[2], t[3]) : 0;
    const schaal = grootte > 0 && eerste.tfs ? grootte / Math.abs(eerste.tfs) : 1;
    uit[index] = eerste.tc * eerste.th * schaal;
  }
  return uit;
}
