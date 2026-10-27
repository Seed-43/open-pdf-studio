// Achtergrond en caret van de tekst-editors op het canvas (#698).
//
// De inline editors (tekstvak/toelichting en de PDF-tekstbewerking) kregen
// een vaste witte achtergrond. Witte tekst op een donkere ondergrond (een
// titelblokkop) werd daardoor een witte rechthoek met onzichtbare tekst.
// Nu volgt de editor de vulling van het vak: zonder vulling is hij
// doorzichtig en blijft de pagina eronder zichtbaar. De caret krijgt een kleur
// die afsteekt tegen wat er werkelijk onder ligt: de vulling, of anders de
// pagina zoals die op het scherm staat.

import { hasFill } from '../annotations/fill-utils.js';

/** De CSS-achtergrond van de editor: de vulling, of doorzichtig. */
export function editorAchtergrond(fillColor) {
  return hasFill(fillColor) ? fillColor : 'transparent';
}

// '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(…)' of 'rgba(…)' naar [r, g, b] (0..255);
// null voor iets anders (namen, 'none', leeg).
export function parseKleur(kleur) {
  if (typeof kleur !== 'string') return null;
  const k = kleur.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(k);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(k);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(k);
  if (m) return [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, Number(v))));
  return null;
}

/** Relatieve luminantie (WCAG) van [r, g, b] in 0..255: 0 = zwart, 1 = wit. */
export function luminantie(rgb) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// Zwart of wit, wat het sterkst afsteekt tegen een ondergrond met deze
// luminantie (het kantelpunt van het WCAG-contrast ligt bij ~0,179).
function zwartOfWit(lum) {
  return lum > 0.179 ? '#000000' : '#ffffff';
}

/**
 * De caretkleur van de editor. Voorrang: de vulling van het vak, dan de
 * gemeten luminantie van de ondergrond (0..1), en anders de tekstkleur (de
 * standaard van de browser).
 * @param {{ fillColor?: string, ondergrond?: number|null, tekstKleur?: string }} o
 */
export function caretKleur({ fillColor, ondergrond, tekstKleur } = {}) {
  const vulling = hasFill(fillColor) ? parseKleur(fillColor) : null;
  if (vulling) return zwartOfWit(luminantie(vulling));
  if (Number.isFinite(ondergrond)) return zwartOfWit(ondergrond);
  return tekstKleur || '#000000';
}

/**
 * Meet de luminantie van wat er op het scherm onder een rechthoek
 * (clientcoördinaten) staat, uit de canvassen op die plek. Per meetpunt telt
 * het bovenste canvas met een niet-doorzichtige pixel; zonder canvas daar
 * geldt het wit van de pagina. De mediaan over een raster van meetpunten:
 * de letters zelf (die nog op het canvas staan) trekken hem niet weg van de
 * ondergrond. Null als er niets te meten valt.
 * Elementen die niet tot de pagina horen (de editor zelf, panelen) tellen
 * niet mee: alleen canvassen.
 * @param {{ left: number, top: number, width: number, height: number }} r
 * @param {Document} [doc]
 */
export function meetOndergrond(r, doc = globalThis.document) {
  if (!doc || typeof doc.elementsFromPoint !== 'function' || !r
    || !(r.width > 0) || !(r.height > 0)) return null;
  let proef = null;
  try {
    proef = doc.createElement('canvas');
    proef.width = 1;
    proef.height = 1;
  } catch (_) { return null; }
  const pctx = proef.getContext('2d', { willReadFrequently: true });
  if (!pctx) return null;
  // Een pixel van een canvas lezen zonder zijn eigen context aan te raken:
  // getContext('2d') op een canvas met een andere context (bitmaprenderer,
  // webgl) zou die breken. drawImage werkt voor elke soort.
  const pixel = (canvas, cx, cy) => {
    const b = canvas.getBoundingClientRect();
    if (!(b.width > 0) || !(b.height > 0) || !canvas.width || !canvas.height) return null;
    const px = Math.floor((cx - b.left) * canvas.width / b.width);
    const py = Math.floor((cy - b.top) * canvas.height / b.height);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    pctx.clearRect(0, 0, 1, 1);
    pctx.drawImage(canvas, px, py, 1, 1, 0, 0, 1, 1);
    return pctx.getImageData(0, 0, 1, 1).data;
  };
  const metingen = [];
  const N = 5;
  const M = 3;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const cx = r.left + r.width * (i + 0.5) / N;
      const cy = r.top + r.height * (j + 0.5) / M;
      let lum = null;
      try {
        for (const el of doc.elementsFromPoint(cx, cy)) {
          if (el.tagName !== 'CANVAS') continue;
          const d = pixel(el, cx, cy);
          if (d && d[3] > 0) {
            // Halfdoorzichtig: tegen wit mengen, zoals de pagina eronder.
            const a = d[3] / 255;
            lum = luminantie([0, 1, 2].map(k => d[k] * a + 255 * (1 - a)));
            break;
          }
        }
      } catch (_) { lum = null; }
      metingen.push(lum == null ? 1 : lum);
    }
  }
  if (!metingen.length) return null;
  metingen.sort((a, b) => a - b);
  return metingen[Math.floor(metingen.length / 2)];
}
