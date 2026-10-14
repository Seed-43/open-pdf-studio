// Renderschaal van één pagina in de doorlopende weergave (issue #549).
//
// De PDFium-bitmap hoort in APPARAAT-pixels gerenderd te worden: zoom × dpr,
// net als de enkele-paginaweergave (bitmap-orchestrator.js). Zonder de
// dpr-factor kreeg een pagina op 150% Windows-schaal een backing store van
// 1 px per CSS-pixel die de browser 1,5× oprekte: tekst zichtbaar wazig
// t.o.v. de enkele pagina op dezelfde zoom.
//
// De as-cap geldt voor de bitmap zelf (apparaat-pixels). Past de pagina er
// niet in, dan rendert hij op de grootste schaal die wel past en rekt CSS de
// rest — geheugen en canvaslimieten blijven zo begrensd.
//
// viewWidth/viewHeight: paginamaat in CSS-px op `scale` (PDF.js-viewport).
export function continuousRenderScale({ scale, dpr, viewWidth, viewHeight, maxAxisPx }) {
  const factor = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const doel = scale * factor;
  const asPx = Math.max(viewWidth, viewHeight) * factor;
  return asPx > maxAxisPx ? doel * (maxAxisPx / asPx) : doel;
}
