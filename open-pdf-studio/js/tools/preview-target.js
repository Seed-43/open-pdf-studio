/**
 * Waar een gereedschapsvoorbeeld getekend wordt (#616).
 *
 * Enkele pagina: de overlay #annotation-canvas is het zichtbare canvas.
 * Doorlopende weergave (ook boek en dubbele pagina): elke pagina heeft een
 * eigen .annotation-canvas en de overlay staat niet op het scherm. Een
 * voorbeeld (rubberen kader, ruit, vormvoorbeeld, snap-indicator) moet dus op
 * het paginacanvas onder de cursor — dat lost resolvePointerCoords() al op als
 * `canvasCtx` — en de basishertekening moet de route van de weergave volgen,
 * anders blijft het vorige voorbeeld op het paginacanvas staan.
 */
import { state, getActiveDocument } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { annotationCtx } from '../ui/dom-elements.js';

/**
 * Hertekent de annotaties langs de route van de huidige weergave.
 * `lightweight` gaat ongewijzigd mee naar de hertekening.
 */
export function redrawForViewMode(lightweight = false) {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous(lightweight);
  else redrawAnnotations(lightweight);
}

/**
 * Het canvas voor een voorbeeld. Een meegegeven doel (de `canvasCtx` van de
 * gereedschapscontext) wint. Zonder doel: in de doorlopende weergave het
 * paginacanvas van de lopende gesture, anders de overlay — het oude gedrag
 * voor aanroepers die nog geen doel meegeven.
 */
export function previewCtx(doelCtx = null) {
  if (doelCtx) return doelCtx;
  if (getActiveDocument()?.viewMode === 'continuous') {
    const canvas = state.activeContinuousCanvas;
    const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (ctx) return ctx;
  }
  return annotationCtx || null;
}
