// Appearance van een stempel of afbeelding zoals de app hem toont.
//
// De app tekent een stempel of afbeelding rechtop in zijn vak en draait dat
// vak met de klok mee om het midden (`rotation`, op het scherm). De pagina kan
// daarbij zelf gedraaid zijn (/Rotate). Een stempel kent in de specificatie
// geen draaiing, dus gaat alles in de appearance, met dezelfde conventie als
// het tekstvak: één rotatie-cm om het midden van de /BBox, /Matrix blijft
// identiteit, /Rect is de omhullende van het gedraaide vak. Zo toont elke
// lezer de stempel precies zoals de app, en leest de lader de draaiing terug
// uit diezelfde cm (loader/stempel-geometrie.js). Er is geen /OPS_Rotation
// meer voor stempels en afbeeldingen.
//
// Pixelruimte (apImageSpace):
// - 'visual' of leeg: de pixels staan rechtop in het vak van de app. De inhoud
//   wordt in visuele maten (visW × visH) getekend en over
//   paginarotatie − draaiing tegen de klok in gedraaid (in PDF-ruimte).
// - 'pdf' zonder draaiing: rauwe pixels zoals de appearance ze in de
//   ongedraaide PDF-ruimte tekende (een pad dat het vak niet uit de
//   appearance kon afleiden). Die gaan ongedraaid en zonder clip terug,
//   anders draait de inhoud dubbel; zo blijft ook een tweede opslagronde
//   stabiel en toont de app ze daarna zoals voorheen.
//
// Puur: geen pdf-lib.

// Op 1e-9 afronden; wat dan kleiner is dan 1e-6 wordt 0: JavaScript schrijft
// zulke getallen in exponent-notatie, en dat is geen geldig PDF-getal.
const rondCosSin = (v) => {
  const r = Math.round(v * 1e9) / 1e9;
  return Math.abs(r) < 1e-6 ? 0 : r;
};

// Clip op het vak, direct na de prefix: tekent niets, en de lader herkent er
// een appearance van deze saver aan (stempel-geometrie.js, eigenAp).
const clipOp = (visW, visH) => `0 0 ${visW} ${visH} re W n\n`;

/**
 * @param {object} p
 * @param {number} p.w  breedte van het ongedraaide vak in de ongedraaide paginaruimte
 * @param {number} p.h  hoogte idem
 * @param {number} p.paginaRotatie  /Rotate van de pagina bij het opslaan
 * @param {number} [p.rotatie]  draaiing van het vak in de app (graden, met de klok mee)
 * @param {string} [p.ruimte]  apImageSpace van de bitmap
 * @returns {{ prefix:string, clip:string, visW:number, visH:number, bboxW:number, bboxH:number, gedraaid:boolean }}
 *   prefix: cm-operatoren binnen q…Q vóór de inhoud; clip: clip op het vak
 *   direct na de prefix, waaraan de lader een appearance van deze saver
 *   herkent (leeg bij rauwe PDF-pixels); visW/visH: maten waarin
 *   de inhoud tekent; bboxW/bboxH: /BBox en maat van de /Rect;
 *   gedraaid: het vak staat schuin t.o.v. het blad, /Rect wordt de omhullende.
 */
export function stempelAppearance({ w, h, paginaRotatie = 0, rotatie = 0, ruimte }) {
  const rot = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;
  const draai = Number.isFinite(rotatie) ? rotatie : 0;
  const gedraaid = Math.abs(((draai % 360) + 360) % 360) > 1e-9;
  if (ruimte === 'pdf' && !gedraaid) {
    return { prefix: '', clip: '', visW: w, visH: h, bboxW: w, bboxH: h, gedraaid: false };
  }
  const omgewisseld = rot === 90 || rot === 270;
  const visW = omgewisseld ? h : w;
  const visH = omgewisseld ? w : h;
  // Tegen de klok in, in PDF-ruimte: de pagina draait straks rot met de klok
  // mee, de app draait het vak `draai` met de klok mee.
  const hoek = ((rot - draai) * Math.PI) / 180;
  // Afronden: rechte hoeken moeten als exact 0/±1 serialiseren — rauwe
  // Math.cos geeft 6.1e-17 en exponent-notatie is geen geldig PDF-getal.
  const cos = rondCosSin(Math.cos(hoek));
  const sin = rondCosSin(Math.sin(hoek));
  const bboxW = visW * Math.abs(cos) + visH * Math.abs(sin);
  const bboxH = visW * Math.abs(sin) + visH * Math.abs(cos);
  if (sin === 0 && cos === 1) {
    return { prefix: '', clip: clipOp(visW, visH), visW, visH, bboxW: visW, bboxH: visH, gedraaid };
  }
  const prefix = `1 0 0 1 ${bboxW / 2} ${bboxH / 2} cm\n` +
    `${cos} ${sin} ${-sin} ${cos} 0 0 cm\n` +
    `1 0 0 1 ${-visW / 2} ${-visH / 2} cm\n`;
  return { prefix, clip: clipOp(visW, visH), visW, visH, bboxW, bboxH, gedraaid };
}

/**
 * /Rect van het gedraaide vak: de omhullende om hetzelfde midden. Zonder
 * draaiing blijft de /Rect van het vak precies zoals hij was.
 * @param {number[]} rect  [x1, y1, x2, y2] van het ongedraaide vak
 */
export function stempelRect(rect, { bboxW, bboxH, gedraaid }) {
  if (!gedraaid) return rect;
  const cx = (rect[0] + rect[2]) / 2;
  const cy = (rect[1] + rect[3]) / 2;
  return [cx - bboxW / 2, cy - bboxH / 2, cx + bboxW / 2, cy + bboxH / 2];
}
