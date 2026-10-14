// Heeft een document formuliervelden? De gevlakte kopie (flattened-copy.js)
// tekent de pagina zonder annotaties en alleen de eigen markeringen van de
// app erbovenop; widgets van formuliervelden (en dus ingevulde waarden) komen
// niet mee. Daarom eerst kijken of er velden zijn en zo ja waarschuwen.

import { pdfjsRecord } from './pdfjs-record.js';

/**
 * @param {object} pdfDoc  het pdf.js-document (doc.pdfDoc)
 * @returns {Promise<boolean>} true als er minstens één formulierveld is
 */
export async function heeftFormuliervelden(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc.getFieldObjects !== 'function') return false;
  try {
    const velden = pdfjsRecord(await pdfDoc.getFieldObjects());
    if (!velden) return false;
    return Object.values(velden).some((lijst) => Array.isArray(lijst) && lijst.length > 0);
  } catch {
    return false;
  }
}
