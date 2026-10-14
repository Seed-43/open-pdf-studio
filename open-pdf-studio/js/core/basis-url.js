// Waar de app tijdens het draaien zijn eigen bestanden ophaalt (#545).
//
// De bundel kan onder een subpad staan (`vite build --base=/assets/…/pdf/`)
// en geladen worden door een pagina op een ander adres van dezelfde site. Een
// vast pad als '/pdfjs/web/cmaps/' wijst dan naar de wortel van de site, en
// een relatief pad naar de map van díé pagina — allebei fout. Alles wat de app
// zelf ophaalt (CMaps, standaardfonts en wasm van PDF.js, de Liberation-fonts)
// bouwt zijn URL daarom hier, vanaf de bouwbasis die Vite meegeeft.
//
// Deze module is vrij van DOM- en app-imports, zodat ze onder node te testen
// is; daar bestaat import.meta.env niet en is de basis gewoon '/'.

const env = import.meta.env || {};

/**
 * De basis als map-URL met een slash aan het eind.
 *
 * - absoluut pad ('/', '/assets/openaec/tools/pdf/') of volledige URL: zo laten
 * - relatief ('./', ''): ten opzichte van de bundel zelf. De gebouwde chunks
 *   staan in assets/ (zie vite.config.js), de basis is dus één map hoger.
 *
 * @param {string|undefined} basis    import.meta.env.BASE_URL
 * @param {string|undefined} moduleUrl import.meta.url van een gebouwde chunk
 */
export function bepaalBasis(basis, moduleUrl) {
  const b = typeof basis === 'string' ? basis : '/';
  if (b.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(b)) {
    return b.endsWith('/') ? b : `${b}/`;
  }
  try {
    return new URL('../', moduleUrl).href;
  } catch {
    return '/';
  }
}

const BASIS = bepaalBasis(env.BASE_URL, import.meta.url);

/** URL van een bestand uit de publieke map (`public/`), vanaf de bouwbasis. */
export function assetUrl(pad, basis = BASIS) {
  return basis + String(pad || '').replace(/^\/+/, '');
}

/**
 * De bronnen die PDF.js zelf ophaalt: CMaps (CJK-tekst), standaardfonts en
 * de wasm-decoders. Bij elke getDocument() uitspreiden, zodat geen enkele
 * aanroep een eigen pad meer meegeeft.
 */
export function pdfjsBronnen(basis = BASIS) {
  return {
    cMapUrl: assetUrl('pdfjs/web/cmaps/', basis),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdfjs/web/standard_fonts/', basis),
    wasmUrl: assetUrl('pdfjs/web/wasm/', basis),
  };
}
