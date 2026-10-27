// Appearance van een schaalgebied (#611). Zonder /AP tekende een andere lezer
// zelf een rand uit /C en /BS, zonder de tint, en bleef de vul-doorzichtigheid
// van de app onzichtbaar. Nu staan vulling en gestreepte rand in de
// appearance, met elk hun eigen alfa in een graphics-state: /ca voor de
// vulling, /CA voor de rand, dezelfde waarden als op het scherm
// (annotations/scale-region-style.js).
//
// Het label en de maatstok tekent alleen de app: ze staan buiten de /Rect
// (het label erboven) en een appearance wordt op de /Rect geschaald.
//
// Zuiver (geen pdf-lib): de saver maakt er de stroom van.

import { schaalgebiedStijl } from '../../annotations/scale-region-style.js';
import { hexToColorArray } from '../../utils/colors.js';

/** Streeppatroon van de rand, gelijk aan het scherm (ctx.setLineDash([6, 3])). */
export const SCHAALGEBIED_STREEP = [6, 3];

const g = (n) => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const rgb = (hex) => hexToColorArray(hex).map(g).join(' ');

/**
 * @param {object} ann schaalgebied in pagina-ruimte (na eventuele paginadraaiing)
 * @returns {{inhoud:string, bbox:number[], extGState:Record<string, {ca?:number, CA?:number}>}|null}
 */
export function schaalgebiedAppearance(ann) {
  const w = Math.abs(Number(ann?.width));
  const h = Math.abs(Number(ann?.height));
  if (!(w > 0) || !(h > 0)) return null;
  const s = schaalgebiedStijl(ann);
  const lw = Number.isFinite(Number(ann.lineWidth)) ? Number(ann.lineWidth) : 1.5;
  const extGState = {};
  let inhoud = '';
  if (s.vulAlfa > 0) {
    extGState.GSv = { ca: s.vulAlfa };
    inhoud += `q\n/GSv gs\n${rgb(s.vulKleur)} rg\n0 0 ${g(w)} ${g(h)} re f\nQ\n`;
  }
  if (lw > 0 && s.randAlfa > 0) {
    extGState.GSr = { CA: s.randAlfa };
    inhoud += `q\n/GSr gs\n${g(lw)} w\n[${SCHAALGEBIED_STREEP.join(' ')}] 0 d\n`
      + `${rgb(s.randKleur)} RG\n0 0 ${g(w)} ${g(h)} re S\nQ\n`;
  }
  // Niets te tekenen (doorzichtigheid 0): leg vast dat er bewust niets staat,
  // anders verzint een lezer zelf een rand uit /C.
  if (!inhoud) inhoud = `0 0 ${g(w)} ${g(h)} re n\n`;
  return { inhoud, bbox: [0, 0, w, h], extGState };
}
