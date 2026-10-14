// Lange tekst afbreken op een breedte, zodat "Tekst toevoegen" binnen de
// pagina blijft. Breekt op spaties; een woord dat zelf te breed is wordt op
// tekens afgebroken. Bestaande regeleinden blijven staan.

/**
 * @param {string} tekst
 * @param {number} maxBreedte  beschikbare breedte (zelfde eenheid als meet())
 * @param {(s: string) => number} meet  breedte van een tekenreeks
 * @returns {string} dezelfde tekst met regeleinden op de breekpunten
 */
export function wrapTekst(tekst, maxBreedte, meet) {
  const bron = String(tekst ?? '');
  if (!(maxBreedte > 0) || typeof meet !== 'function') return bron;
  return bron.split('\n').map((alinea) => wrapAlinea(alinea, maxBreedte, meet)).join('\n');
}

/**
 * Waar nieuwe tekst op de pagina komt. Past de breedste regel tussen het
 * klikpunt en de rechtermarge, dan blijft het klikpunt staan. Anders wordt er
 * afgebroken op de rechtermarge; blijft daar minder dan `minBreedte` over, dan
 * schuift het beginpunt naar links, maar niet verder dan de tekst nodig heeft.
 * @param {{ tekst: string, x: number, paginaBreedte: number,
 *           meet: (s: string) => number, marge?: number, minBreedte?: number }} opties
 * @returns {{ x: number, tekst: string }}
 */
export function plaatsTekstOpPagina({ tekst, x, paginaBreedte, meet, marge = 36, minBreedte = 150 }) {
  const bron = String(tekst ?? '');
  if (typeof meet !== 'function' || !(paginaBreedte > 0)) return { x, tekst: bron };
  const min = Math.min(minBreedte, Math.max(0, paginaBreedte - 2 * marge));
  const breedste = Math.max(0, ...bron.split('\n').map((regel) => meet(regel)));
  let tekstX = x;
  let wrapBreedte = paginaBreedte - tekstX - marge;
  if (breedste > wrapBreedte && wrapBreedte < min) {
    wrapBreedte = Math.min(min, breedste);
    tekstX = Math.max(marge, paginaBreedte - marge - wrapBreedte);
  }
  return { x: tekstX, tekst: wrapTekst(bron, wrapBreedte, meet) };
}

function wrapAlinea(alinea, maxBreedte, meet) {
  if (alinea === '' || meet(alinea) <= maxBreedte) return alinea;
  const regels = [];
  let regel = '';
  for (const woord of alinea.split(' ')) {
    const kandidaat = regel === '' ? woord : `${regel} ${woord}`;
    if (meet(kandidaat) <= maxBreedte) {
      regel = kandidaat;
      continue;
    }
    if (regel !== '') regels.push(regel);
    regel = '';
    // Een los woord dat niet past: op tekens afbreken.
    let rest = woord;
    while (rest !== '' && meet(rest) > maxBreedte) {
      let n = 1;
      while (n < rest.length && meet(rest.slice(0, n + 1)) <= maxBreedte) n++;
      regels.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    regel = rest;
  }
  if (regel !== '') regels.push(regel);
  return regels.join('\n');
}
