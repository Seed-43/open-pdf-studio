// Draaiing van een veelhoek of wolk bij opslaan en heropenen (#619).
//
// Het scherm tekent zo'n vorm ongedraaid in zijn vak en draait hem daarna om
// het midden van dat vak (ctx.rotate, met de klok mee in app-coördinaten
// waarin y omlaag loopt). Het bestand krijgt de vorm zoals hij er dan uitziet:
// - /Vertices zijn de gedraaide hoekpunten (wat een andere lezer ook tekent);
// - de appearance van een wolk draait met één cm om het midden;
// - /Rect is de omhullende van de gedraaide vorm;
// - /OPS_Rotation bewaart de hoek, want de specificatie kent geen draaiing
//   van een veelhoek.
//
// Bij het laden draait ontdraaiVorm de hoekpunten terug, om het punt waarvan
// de lader het midden van het nieuwe vak maakt. Zo tekent de app na
// heropenen precies dezelfde vorm, ook als het vak niet de omhullende van de
// punten was (een regelmatige vijfhoek raakt de onderkant van zijn vak niet).
//
// Puur: geen pdf-lib, geen DOM.

const rad = (graden) => (graden * Math.PI) / 180;

/** Punt p om c gedraaid over `graden`, zoals ctx.rotate in app-coördinaten. */
export function draaiPunt(p, c, graden) {
  const a = rad(graden);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function omhullendeMidden(punten) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of punten) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Het draaipunt van een vorm: het midden van zijn vak, zonder bruikbaar vak
 * het midden van de omhullende van zijn punten.
 */
export function draaiMidden(ann, punten) {
  if ([ann?.x, ann?.y, ann?.width, ann?.height].every(Number.isFinite) && ann.width > 0 && ann.height > 0) {
    return { x: ann.x + ann.width / 2, y: ann.y + ann.height / 2 };
  }
  return omhullendeMidden(punten);
}

/**
 * De gedraaide hoekpunten (zoals op het scherm) terug naar de ongedraaide
 * vorm. Het draaipunt c is het punt waarvoor het midden van de omhullende
 * van de teruggedraaide punten weer c is: de app draait de geladen vorm om
 * dat midden, dus R_c(uitkomst) is precies de vorm uit het bestand.
 * Zonder hoek blijven de punten zoals ze zijn.
 * @param {{x:number,y:number}[]} gedraaid
 * @param {number} graden
 */
export function ontdraaiVorm(gedraaid, graden) {
  if (!graden || !Array.isArray(gedraaid) || gedraaid.length === 0) return gedraaid;
  const nul = { x: 0, y: 0 };
  // Terug om de oorsprong; daarna schuiven zodat het midden c = R(m) wordt.
  const q = gedraaid.map((p) => draaiPunt(p, nul, -graden));
  const m = omhullendeMidden(q);
  const c = draaiPunt(m, nul, graden);
  return q.map((p) => ({ x: p.x - m.x + c.x, y: p.y - m.y + c.y }));
}

const getal = (v) => String(Math.round(v * 1e6) / 1e6 || 0);

/**
 * cm-operator die de inhoud van een appearance (in PDF-coördinaten, y omhoog)
 * over `graden` met de klok mee om (cx, cy) draait, zoals het scherm.
 */
export function draaiCm(cx, cy, graden) {
  const a = rad(graden);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // In PDF-ruimte is met de klok mee een draaiing over -graden.
  const m = [cos, -sin, sin, cos];
  const e = cx - m[0] * cx - m[2] * cy;
  const f = cy - m[1] * cx - m[3] * cy;
  return `${[...m, e, f].map(getal).join(' ')} cm\n`;
}
