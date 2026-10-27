// Kleur en vet/cursief van bladwijzers (#689). Puur: geen imports uit de app,
// zodat de unit-tests het model zonder browser kunnen draaien.
//
// Het model (doc.bookmarks) heeft per bladwijzer `color` ('#rrggbb' of null),
// `bold` en `italic`; de saver schrijft die als /C en /F van het outline-item.

// De vaste kleuren van het menu. `null` = Standaard: geen /C, de titel volgt
// de tekstkleur van het thema.
export const BLADWIJZER_KLEUREN = [
  { sleutel: 'red', hex: '#e81123' },
  { sleutel: 'orange', hex: '#f7630c' },
  { sleutel: 'green', hex: '#107c10' },
  { sleutel: 'blue', hex: '#0078d7' },
  { sleutel: 'purple', hex: '#881798' },
  { sleutel: 'gray', hex: '#808080' },
];

/** i18n-sleutel (context-namespace) van een menukleur: 'red' → 'bookmark.colorRed'. */
export function kleurLabelSleutel(sleutel) {
  return 'bookmark.color' + sleutel.charAt(0).toUpperCase() + sleutel.slice(1);
}

/** '#RGB', '#RRGGBB' of 'RRGGBB' → '#rrggbb'; al het andere → null. */
export function normaliseerKleur(kleur) {
  if (typeof kleur !== 'string') return null;
  let s = kleur.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return '#' + s;
}

/**
 * Zet kleur en/of stijl op de bladwijzers met deze ids. `wijziging` bevat
 * alleen de velden die veranderen: { color?: string|null, bold?: boolean,
 * italic?: boolean }. Geeft een nieuwe array terug (gewijzigde items als
 * kopie, de rest ongemoeid) en of er iets veranderde.
 * @returns {{ bookmarks: object[], gewijzigd: boolean }}
 */
export function zetBladwijzerStijl(bookmarks, ids, wijziging) {
  const lijst = Array.isArray(bookmarks) ? bookmarks : [];
  const doel = new Set(ids || []);
  const velden = {};
  if (wijziging && 'color' in wijziging) velden.color = wijziging.color == null ? null : normaliseerKleur(wijziging.color);
  if (wijziging && 'bold' in wijziging) velden.bold = !!wijziging.bold;
  if (wijziging && 'italic' in wijziging) velden.italic = !!wijziging.italic;
  let gewijzigd = false;
  const uit = lijst.map((bm) => {
    if (!doel.has(bm.id)) return bm;
    const anders = Object.keys(velden).some((k) => (k === 'color' ? (bm.color || null) : !!bm[k]) !== velden[k]);
    if (!anders) return bm;
    gewijzigd = true;
    return { ...bm, ...velden };
  });
  return { bookmarks: uit, gewijzigd };
}

/**
 * Wat het menu als vinkje toont voor de selectie: vet/cursief alleen als
 * ALLE geselecteerde het hebben; kleur alleen als ze allemaal dezelfde hebben
 * (anders undefined: gemengd).
 */
export function stijlVanSelectie(bookmarks, ids) {
  const doel = new Set(ids || []);
  const gekozen = (bookmarks || []).filter((b) => doel.has(b.id));
  if (gekozen.length === 0) return { bold: false, italic: false, color: undefined, aantal: 0 };
  const kleuren = new Set(gekozen.map((b) => normaliseerKleur(b.color)));
  return {
    bold: gekozen.every((b) => !!b.bold),
    italic: gekozen.every((b) => !!b.italic),
    color: kleuren.size === 1 ? [...kleuren][0] : undefined,
    aantal: gekozen.length,
  };
}

// ── Weergave: een donkere kleur op een donker thema leesbaar maken ─────────

function naarRgb(hex) {
  const n = normaliseerKleur(hex);
  if (!n) return null;
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
}

function naarHex(rgb) {
  return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

/** 'rgb(30, 30, 30)' / 'rgba(…)' / '#rrggbb' → [r,g,b] of null (ook bij transparant). */
export function leesCssKleur(css) {
  if (typeof css !== 'string') return null;
  const hex = naarRgb(css);
  if (hex) return hex;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(css.trim());
  if (!m) return null;
  if (m[4] != null) {
    const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a === 0) return null;
  }
  return [m[1], m[2], m[3]].map(Number);
}

function luminantie([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const la = luminantie(a);
  const lb = luminantie(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * De kleur waarin het paneel de titel tekent. Alleen voor de weergave: het
 * PDF houdt de gekozen kleur. Heeft de kleur te weinig contrast met de
 * achtergrond (donkerblauw op een donker thema), dan mengt hij in stapjes
 * naar wit (of zwart op een licht thema) tot hij leesbaar is.
 * @param {string|null} hex          kleur van de bladwijzer
 * @param {number[]|null} achtergrond [r,g,b] van het paneel
 */
export function weergaveKleur(hex, achtergrond, minimum = 3) {
  const rgb = naarRgb(hex);
  if (!rgb) return null;
  if (!achtergrond || contrast(rgb, achtergrond) >= minimum) return naarHex(rgb);
  const naar = luminantie(achtergrond) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let stap = 1; stap <= 10; stap++) {
    const f = stap / 10;
    const gemengd = rgb.map((c, i) => c + (naar[i] - c) * f);
    if (contrast(gemengd, achtergrond) >= minimum) return naarHex(gemengd);
  }
  return naarHex(naar);
}
