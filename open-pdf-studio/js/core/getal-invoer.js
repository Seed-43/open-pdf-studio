// Getalinvoer — één parser voor alles wat de gebruiker als getal typt.
//
// Komma en punt zijn allebei een decimaalteken: "0,1" en "0.1" zijn hetzelfde
// getal, ongeacht de taal van de app of van Windows. Een duizendtal-scheiding
// telt alleen waar ze ondubbelzinnig is:
//
//   "0,1" / "0.1"     -> 0.1      één scheidingsteken is altijd het decimaalteken
//   "1,5" / "1.5"     -> 1.5
//   "1.234,5"         -> 1234.5   beide tekens: het laatste is het decimaalteken,
//   "1,234.5"         -> 1234.5   het andere scheidt groepen van precies drie
//   "1.234.567"       -> 1234567  hetzelfde teken vaker: dan zijn het groepen
//   " -2,5 "          -> -2.5     spaties eromheen en een voorteken mogen
//   "5," / ",5"       -> 5 / 0.5  een los decimaalteken aan het eind of begin
//   "1,2,3" / "1.2,3,4" / "abc" / "" -> ongeldig
//
// Arabisch-Indische cijfers (en het Arabische decimaalteken) worden als
// gewone cijfers gelezen, zodat ook een Arabische of Perzische invoer werkt.
//
// Schaalnotaties staan erbij: "1:100" (verhouding), "0,5x" / "2×" (factor) en
// "50%" (percentage als factor).

const ARABISCH_INDISCH = '٠١٢٣٤٥٦٧٨٩';
const PERZISCH = '۰۱۲۳۴۵۶۷۸۹';

/** Zet afwijkende cijfers en tekens om naar ASCII; verder niets. */
function gewoneTekens(tekst) {
  let uit = '';
  for (const ch of tekst) {
    let i = ARABISCH_INDISCH.indexOf(ch);
    if (i < 0) i = PERZISCH.indexOf(ch);
    if (i >= 0) { uit += String(i); continue; }
    if (ch === '٫') { uit += ','; continue; } // Arabisch decimaalteken
    if (ch === '٬') { uit += '.'; continue; } // Arabisch duizendtalteken
    if (ch === '−') { uit += '-'; continue; } // typografisch minteken
    uit += ch;
  }
  return uit;
}

const GROEPEN = { '.': /^\d{1,3}(?:\.\d{3})+$/, ',': /^\d{1,3}(?:,\d{3})+$/ };

/**
 * Het getal als canonieke tekst ("-1234.5", "0.1", "1e-7"), of '' bij
 * ongeldige invoer. Dezelfde vorm als `value` van een getalveld in de
 * browser, zodat bestaande code met parseFloat/Number er direct mee werkt.
 * @param {unknown} invoer
 * @returns {string}
 */
export function normaliseerGetalTekst(invoer) {
  if (typeof invoer === 'number') return Number.isFinite(invoer) ? String(invoer) : '';
  if (typeof invoer !== 'string') return '';
  const s = gewoneTekens(invoer).trim();
  const m = /^([+-]?)([\d.,]+)((?:[eE][+-]?\d+)?)$/.exec(s);
  if (!m) return '';
  const [, teken, lijf, exponent] = m;
  if (!/\d/.test(lijf)) return '';
  const punten = (lijf.match(/\./g) || []).length;
  const kommas = (lijf.match(/,/g) || []).length;
  let geheel;
  let breuk = '';
  if (punten === 0 && kommas === 0) {
    geheel = lijf;
  } else if (punten > 0 && kommas > 0) {
    // Beide tekens: het laatste is het decimaalteken (één keer), het andere
    // scheidt groepen van drie en staat alleen vóór het decimaalteken.
    const dec = lijf.lastIndexOf('.') > lijf.lastIndexOf(',') ? '.' : ',';
    const groep = dec === '.' ? ',' : '.';
    if ((dec === '.' ? punten : kommas) !== 1) return '';
    const pos = lijf.indexOf(dec);
    const voor = lijf.slice(0, pos);
    breuk = lijf.slice(pos + 1);
    if (!GROEPEN[groep].test(voor) || !/^\d*$/.test(breuk)) return '';
    geheel = voor.split(groep).join('');
  } else {
    const sep = punten > 0 ? '.' : ',';
    const aantal = punten || kommas;
    if (aantal === 1) {
      const pos = lijf.indexOf(sep);
      geheel = lijf.slice(0, pos);
      breuk = lijf.slice(pos + 1);
    } else {
      // Hetzelfde teken vaker kan geen decimaalteken zijn: dan zijn het
      // groepen van drie ("1.234.567"), anders is het een typefout.
      if (!GROEPEN[sep].test(lijf)) return '';
      geheel = lijf.split(sep).join('');
    }
  }
  if (!/^\d*$/.test(geheel) || !/^\d*$/.test(breuk)) return '';
  if (!geheel && !breuk) return '';
  const tekst = `${teken === '-' ? '-' : ''}${geheel || '0'}${breuk ? `.${breuk}` : ''}${exponent}`;
  return Number.isFinite(Number(tekst)) ? tekst : '';
}

/**
 * Leest een getypt getal; de hele tekst moet een getal zijn.
 * @param {unknown} invoer
 * @returns {number} NaN bij ongeldige invoer
 */
export function leesGetal(invoer) {
  const tekst = normaliseerGetalTekst(invoer);
  return tekst === '' ? NaN : Number(tekst);
}

/**
 * Als leesGetal, maar null in plaats van NaN.
 * @param {unknown} invoer
 * @returns {number|null}
 */
export function leesGetalOfNull(invoer) {
  const n = leesGetal(invoer);
  return Number.isFinite(n) ? n : null;
}

/**
 * Vervanger van parseFloat: leest het langste getal aan het begin van de
 * tekst ("2pt" -> 2, "1,5 mm" -> 1.5, "100%" -> 100) met komma én punt als
 * decimaalteken. Een getal gaat ongewijzigd terug.
 * @param {unknown} invoer
 * @returns {number} NaN als er geen getal vooraan staat
 */
export function leesGetalBegin(invoer) {
  if (typeof invoer === 'number') return invoer;
  if (invoer == null) return NaN;
  const s = gewoneTekens(String(invoer)).trimStart();
  // Zoals parseFloat: "Infinity" is een getal (de aanroeper begrenst het).
  const oneindig = /^([+-]?)Infinity/.exec(s);
  if (oneindig) return oneindig[1] === '-' ? -Infinity : Infinity;
  const run = /^[+-]?[\d.,]*/.exec(s)[0];
  for (let eind = run.length; eind > 0; eind--) {
    const stuk = run.slice(0, eind);
    if (!normaliseerGetalTekst(stuk)) continue;
    // Exponent alleen direct na het volledige getal, zoals parseFloat("1e3").
    const exp = eind === run.length ? /^[eE][+-]?\d+/.exec(s.slice(eind)) : null;
    return leesGetal(exp ? stuk + exp[0] : stuk);
  }
  return NaN;
}

/**
 * Vervanger van parseInt(x, 10) voor getypte invoer: het getal aan het begin,
 * naar nul toe afgerond. "12,7" -> 12, "3 stuks" -> 3.
 * @param {unknown} invoer
 * @returns {number} NaN als er geen getal vooraan staat
 */
export function leesGeheelGetal(invoer) {
  const n = leesGetalBegin(invoer);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

/**
 * Een verhouding als "1:100", "1 : 53,42" of "2,5:1".
 * @param {unknown} invoer
 * @returns {{teller:number, noemer:number}|null} null als het geen verhouding is
 */
export function leesVerhouding(invoer) {
  if (typeof invoer !== 'string') return null;
  const delen = invoer.split(':');
  if (delen.length !== 2) return null;
  const teller = leesGetal(delen[0]);
  const noemer = leesGetal(delen[1]);
  if (!Number.isFinite(teller) || !Number.isFinite(noemer)) return null;
  return { teller, noemer };
}

/**
 * Een schaalfactor als "2", "0,5x", "1.5×" of "50%" (= 0.5).
 * @param {unknown} invoer
 * @returns {number} NaN bij ongeldige invoer
 */
export function leesFactor(invoer) {
  if (typeof invoer === 'number') return Number.isFinite(invoer) ? invoer : NaN;
  if (typeof invoer !== 'string') return NaN;
  const m = /^(.*?)\s*([xX×%])?$/.exec(invoer.trim());
  const n = leesGetal(m[1]);
  if (!Number.isFinite(n)) return NaN;
  return m[2] === '%' ? n / 100 : n;
}

/**
 * Een getal met een optionele eenheid erachter: "2,5 m", "100mm", "3'".
 * @param {unknown} invoer
 * @returns {{waarde:number, eenheid:string}|null} eenheid is '' als die ontbreekt
 */
export function leesGetalMetEenheid(invoer) {
  if (typeof invoer !== 'string') return null;
  const m = /^(.*?)\s*([a-zA-Z"'µ]+)?$/.exec(invoer.trim());
  const waarde = leesGetal(m[1]);
  if (!Number.isFinite(waarde)) return null;
  return { waarde, eenheid: m[2] || '' };
}

/**
 * Het decimaalteken waarmee een taal getallen toont: ',' of '.'.
 * @param {string} [taal]
 * @returns {',' | '.'}
 */
export function decimaalTekenVoor(taal) {
  try {
    const deel = new Intl.NumberFormat(taal || undefined)
      .formatToParts(1.5).find((p) => p.type === 'decimal');
    return deel && (deel.value === ',' || deel.value === '٫') ? ',' : '.';
  } catch {
    return '.';
  }
}

const CANONIEK = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Toont een getal (of de canonieke tekst ervan) met het decimaalteken van de
 * taal: 0.1 -> "0,1" in het Nederlands. Andere tekst blijft zoals ze is.
 * Er komt geen duizendtalscheiding bij: wat getoond wordt, moet weer
 * ongewijzigd ingetypt kunnen worden.
 * @param {unknown} waarde
 * @param {string} [taal]
 * @returns {string}
 */
export function toonGetal(waarde, taal) {
  if (waarde == null) return '';
  const tekst = typeof waarde === 'number'
    ? (Number.isFinite(waarde) ? String(waarde) : '')
    : String(waarde);
  if (!CANONIEK.test(tekst)) return tekst;
  return decimaalTekenVoor(taal) === ',' ? tekst.replace('.', ',') : tekst;
}
