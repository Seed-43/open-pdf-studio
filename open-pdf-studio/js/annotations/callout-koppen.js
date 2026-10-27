// Koppen van de aanhaallijn van een callout (#612). De lijn loopt van het
// tekstvak (arm) via de knie naar de punt; End is de kop op de punt, Start de
// kop waar de lijn het tekstvak verlaat. Het scherm (rendering.js) en de
// opgeslagen appearance (saver.js) tekenen met deze uitkomst. Puur: geen DOM,
// geen app-state.

import { splineArrowEndTangent } from './spline-arrow-geometry.js';

// Hoe ver de lijn een gevulde kop in loopt, als deel van de kopgrootte: tot
// waar de vorm breed genoeg is om het lijneinde te bedekken (zie
// decorations.js drawArrowheadOnCanvas voor de vormen).
const INKORTING_GEVULD = { closed: 0.5, diamond: 0.5, circle: 1 / 3, square: 0.5 };

const zelfdePunt = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/**
 * @param {{arm:{x,y}, knie:{x,y}, tip:{x,y}, startHead?:string, endHead?:string,
 *   headSize:number, lineWidth:number, hol?:boolean, gebogen?:boolean}} o
 * @returns {{lijn:{x,y}[], begin:null|{x,y,hoek,stijl}, eind:null|{x,y,hoek,stijl}}}
 *   lijn: [arm, knie, tip], bij een rechte lijn ingekort voor de koppen.
 *   hoek: de richting waarin de kop wijst (naar buiten), in app-ruimte.
 */
export function calloutLeiderKoppen({ arm, knie, tip, startHead, endHead, headSize, lineWidth, hol = false, gebogen = false }) {
  const begin = startHead && startHead !== 'none' ? startHead : null;
  const eind = endHead && endHead !== 'none' ? endHead : null;
  // Valt de knie samen met een uiteinde, dan geeft het andere uiteinde de richting.
  const voorTip = zelfdePunt(knie, tip) ? arm : knie;
  const voorArm = zelfdePunt(knie, arm) ? tip : knie;
  const pts = [arm, knie, tip];
  const eindHoek = gebogen ? splineArrowEndTangent(pts) : Math.atan2(tip.y - voorTip.y, tip.x - voorTip.x);
  const beginHoek = gebogen ? splineArrowEndTangent([...pts].reverse()) : Math.atan2(arm.y - voorArm.y, arm.x - voorArm.x);

  let lijn = pts;
  if (!gebogen && (begin || eind)) {
    const lw = lineWidth || 1;
    const inkorting = (stijl) => (!hol && INKORTING_GEVULD[stijl] ? INKORTING_GEVULD[stijl] * headSize : Math.min(lw * 0.5, 1));
    const terug = (p, van, stijl) => {
      if (!stijl) return p;
      const lengte = Math.hypot(p.x - van.x, p.y - van.y);
      if (!(lengte > 0)) return p;
      const d = Math.min(inkorting(stijl), lengte);
      return { x: p.x - ((p.x - van.x) / lengte) * d, y: p.y - ((p.y - van.y) / lengte) * d };
    };
    const a = terug(arm, voorArm, begin);
    const t = terug(tip, voorTip, eind);
    // Een knie op een uiteinde schuift mee, anders liep de lijn via de knie
    // toch tot in de punt.
    lijn = [a, zelfdePunt(knie, tip) ? t : zelfdePunt(knie, arm) ? a : knie, t];
  }
  return {
    lijn,
    begin: begin ? { x: arm.x, y: arm.y, hoek: beginHoek, stijl: begin } : null,
    eind: eind ? { x: tip.x, y: tip.y, hoek: eindHoek, stijl: eind } : null,
  };
}
