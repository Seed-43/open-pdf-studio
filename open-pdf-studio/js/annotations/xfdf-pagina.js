// Paginanummer uit het XFDF-attribuut `page`. XFDF telt vanaf 0; de app telt
// vanaf 1. Zonder of met een onbruikbaar attribuut: pagina 1.

/** @param {string|null} attr  waarde van `page` */
export function paginaUitXfdf(attr) {
  const n = parseInt(attr, 10);
  return Number.isInteger(n) && n >= 0 ? n + 1 : 1;
}
