// Snellere pdf-lib-standaarden voor inlezen en opslaan (#581).
//
// pdf-lib geeft de event-loop standaard elke 100 objecten ruimte bij het
// inlezen (parseSpeed ParseSpeeds.Slow) en elke 50 objecten bij het
// wegschrijven (objectsPerTick), telkens met een setTimeout van in een WebView
// minstens 4 ms. Een grote tekeningenset telt al snel 100.000+ objecten, dus
// ging het grootste deel van een opslag op aan die pauzes: een set van 156
// pagina's en 140.000 objecten deed 19 s over inlezen en 28 s over opslaan,
// tegen 2,4 s en 1,6 s met partijen van 5000 objecten (zelfde uitvoer).
//
// Dit module verhoogt die standaarden één keer voor ELKE PDFDocument.load en
// save in de app; saveAsBase64 loopt via save en profiteert mee, net als
// pagina's invoegen, verwijderen, herschikken en bijsnijden. Met partijen van
// 5000 objecten krijgt de event-loop op enorme bestanden nog enkele tientallen
// keren ruimte, zodat de opslaan-melding blijft bewegen. Een aanroeper die zelf
// een waarde meegeeft, houdt die. main.js importeert dit module als eerste.
import { PDFDocument } from 'pdf-lib';

export const OBJECTEN_PER_TIK = 5000;

const VERSNELD = Symbol.for('open-pdf-studio.pdfLibSnelheid');

// Idempotent: een tweede aanroep (of een tweede kopie van dit module) wikkelt
// load en save niet nog eens in.
export function versnelPdfLib(Klasse = PDFDocument) {
  if (!Klasse || Klasse[VERSNELD]) return;
  const laad = Klasse.load;
  Klasse.load = function load(bytes, opties) {
    return laad.call(Klasse, bytes, { parseSpeed: OBJECTEN_PER_TIK, ...(opties || {}) });
  };
  const bewaar = Klasse.prototype.save;
  Klasse.prototype.save = function save(opties) {
    return bewaar.call(this, { objectsPerTick: OBJECTEN_PER_TIK, ...(opties || {}) });
  };
  Klasse[VERSNELD] = true;
}

versnelPdfLib();
