// Spot Coord (tab Tekenen): een maatlijn-leidraad (measureDistance) waarvan
// het label de X,Y-positie van het beginpunt is, geen lengte. Gemarkeerd met
// dimKind 'spotCoord', zodat een herberekening (kalibreren, schaal wijzigen,
// een greep verslepen) de coördinaten opnieuw opbouwt in plaats van er de
// lengte van de leidraad in te schrijven. Puur: geen state, geen DOM.

export const SPOT_COORD = 'spotCoord';

/** Is dit een Spot Coord-label? */
export function isSpotCoord(ann) {
  return !!ann && ann.type === 'measureDistance' && ann.dimKind === SPOT_COORD;
}

/**
 * Het label: "X 12.5, Y 40 mm" in meeteenheden, zes significante cijfers.
 * @param {number} x
 * @param {number} y
 * @param {{pixelsPerUnit?: number, unit?: string}} schaal  zoals getMeasureScale()
 */
export function spotCoordTekst(x, y, schaal) {
  const k = schaal?.pixelsPerUnit > 0 ? schaal.pixelsPerUnit : 1;
  const unit = schaal?.unit || 'mm';
  const num = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '0');
  return `X ${num(x / k)}, Y ${num(y / k)} ${unit}`;
}
