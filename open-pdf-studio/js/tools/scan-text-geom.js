// Gescande tekst bewerken: de plek, grootte en kleuren van een herkend woord.
//
// Na "Tekst herkennen (OCR)" staat elk woord als onzichtbare tekst in het
// bestand: lettergrootte = hoogte van het woordvak, verankerd aan de onderrand,
// horizontaal uitgerekt tot de gemeten woordbreedte (saver/ocr-text-layer.js).
// Uit zo'n tekstitem van PDF.js volgt dus het voetafdruk-vak van het woord,
// en uit de pixels eromheen de achtergrond- en inktkleur. Geen DOM: testbaar.

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const naarHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/**
 * Het vak van een OCR-woord in de ruimte van `vt` (PDF-ruimte -> app-ruimte).
 * @param {{transform:number[], width:number, height:number}} item  PDF.js-tekstitem
 * @param {number[]|null} vt  weergavetransformatie [a b c d e f]
 */
export function woordKader(item, vt) {
  const [, , , , tx, ty] = item.transform;
  const w = item.width;
  const h = Math.abs(item.height) || Math.abs(item.transform[3]);
  const V = vt || [1, 0, 0, 1, 0, 0];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [px, py] of [[tx, ty], [tx + w, ty], [tx + w, ty + h], [tx, ty + h]]) {
    const x = V[0] * px + V[2] * py + V[4];
    const y = V[1] * px + V[3] * py + V[5];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Lettergrootte voor de vervangende tekst: de woordhoogte omvat ook stok- en staartletters. */
export function schatLettergrootte(woordHoogte) {
  return Math.max(6, Math.round(woordHoogte * 0.85));
}

/** Het vak iets ruimer, zodat randen van de gescande letters niet onder het nieuwe vlak uitsteken. */
export function ruimerKader(k, padX = 2, padY = 1.5) {
  return { x: k.x - padX, y: k.y - padY, width: k.width + 2 * padX, height: k.height + 2 * padY };
}

function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

/**
 * Achtergrond- en inktkleur van een woord uit de pixels van de gescande pagina.
 * @param {Uint8ClampedArray|Uint8Array} rgba  pixels (RGBA) van de pagina
 * @param {number} breedte  pagina in pixels
 * @param {number} hoogte
 * @param {{x:number,y:number,width:number,height:number}} kader  woordvak in pixels
 * @returns {{achtergrond:string, inkt:string}}
 */
export function bemonsterKleuren(rgba, breedte, hoogte, kader) {
  const x0 = Math.max(0, Math.floor(kader.x));
  const y0 = Math.max(0, Math.floor(kader.y));
  const x1 = Math.min(breedte - 1, Math.ceil(kader.x + kader.width));
  const y1 = Math.min(hoogte - 1, Math.ceil(kader.y + kader.height));
  const rand = 3;
  const ring = [];
  const binnen = [];
  for (let y = Math.max(0, y0 - rand); y <= Math.min(hoogte - 1, y1 + rand); y++) {
    for (let x = Math.max(0, x0 - rand); x <= Math.min(breedte - 1, x1 + rand); x++) {
      const i = (y * breedte + x) * 4;
      const px = [rgba[i], rgba[i + 1], rgba[i + 2]];
      const inKader = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      (inKader ? binnen : ring).push(px);
    }
  }
  const mediaan = (lijst, k) => {
    const v = lijst.map((p) => p[k]).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 255;
  };
  const bg = ring.length ? [mediaan(ring, 0), mediaan(ring, 1), mediaan(ring, 2)] : [255, 255, 255];
  const achtergrond = naarHex(...bg);

  let inkt = '#000000';
  if (binnen.length) {
    const gesorteerd = binnen.slice().sort((a, b) => lum(...a) - lum(...b));
    const n = Math.max(1, Math.floor(gesorteerd.length * 0.12));
    const donker = gesorteerd.slice(0, n);
    const gem = [0, 1, 2].map((k) => donker.reduce((s, p) => s + p[k], 0) / n);
    // Alleen een echt gekleurde of donkere inkt overnemen; bijna-wit blijft zwart.
    if (lum(...bg) - lum(...gem) >= 60) inkt = naarHex(...gem);
  }
  return { achtergrond, inkt };
}
