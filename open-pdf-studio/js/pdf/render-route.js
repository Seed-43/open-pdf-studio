// Wie tekent de pagina: het Rust-pad (PDFium) of PDF.js?
//
// De bureaubladversie rastert elke pagina met PDFium. Dat pad heeft twee
// dingen nodig: de Tauri-brug én een bestandspad op schijf — PDFium leest het
// bestand zelf, het krijgt geen bytes aangereikt.
//
// In de webversie (open-pdf-studio.open-aec.com) bestaat geen van beide. Een
// bestand dat via de browser-bestandskiezer binnenkomt heeft alleen een NAAM;
// `doc.filePath` is daar dus wél gevuld, maar met "Contract.pdf" in plaats van
// een pad. Dat is precies waar issue #355 op stukliep: de terugval naar PDF.js
// stond op "géén bestandspad", en die voorwaarde was in de browser onwaar.
// Gevolg: het Rust-pad werd overgeslagen (geen Tauri) én de terugval ook, dus
// er tekende niemand. Het canvas bleef op 300x150 staan — de standaardmaat van
// een <canvas> waar nooit naartoe geschreven is — en dat is het "kleine witte
// vlak" uit de melding.
//
// De regel hoort dus te zijn: PDF.js tekent zodra het Rust-pad niet kán, om
// wélke van de twee redenen dan ook.

// Op Android (#593) is er wél een Tauri-brug, maar géén PDFium: de APK bevat
// alleen libapp_lib.so, er wordt geen libpdfium.so meegebouwd (release.yml,
// job build-android). Bovendien is een bestand daar een content://-URI, die
// std::fs in Rust niet kan openen. Elke Rust-render of -analyse faalt dus;
// de pagina bleef wit omdat het rasterpad het canvas al had geclaimd. Mobiel
// tekent daarom altijd met PDF.js, net als de webversie.

/**
 * Kan het Rust-pad (PDFium-raster, paginaclassificatie, vectorextractie,
 * tekstspans) hier draaien? Alleen in de bureaubladschil.
 *
 * @param {object} o
 * @param {boolean} o.inTauri Draait de app in de Tauri-schil?
 * @param {boolean} [o.mobiel] Android/iOS: Tauri zonder PDFium.
 * @returns {boolean}
 */
export function rustRenderPadBeschikbaar({ inTauri, mobiel = false }) {
  return !!inTauri && !mobiel;
}

/**
 * Moet PDF.js deze pagina tekenen?
 *
 * @param {object} o
 * @param {boolean} o.inTauri            Draait de app in de Tauri-schil?
 * @param {boolean} o.hasFilePath        Heeft het document een pad op schijf?
 * @param {boolean} [o.mobiel]           Android/iOS: Tauri zonder PDFium.
 * @param {boolean} [o.viewportNamHetOver] Heeft het viewport-pad (vector of
 *   raster) de pagina al geclaimd? Dan tekent de RAF-lus en moet PDF.js
 *   afblijven — anders vechten twee tekenaars om hetzelfde canvas.
 * @returns {boolean}
 */
export function pdfjsFallbackNodig({ inTauri, hasFilePath, mobiel = false, viewportNamHetOver = false }) {
  if (viewportNamHetOver) return false;
  return !rustRenderPadBeschikbaar({ inTauri, mobiel }) || !hasFilePath;
}
