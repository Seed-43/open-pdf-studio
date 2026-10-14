// Sleutel en geldigheid van de lage-resolutievoorvertoningen in de doorlopende
// weergave (renderer.js).
//
// De voorvertoningen worden op de achtergrond voor maximaal 200 pagina's
// gemaakt. Die lus liep door nadat er een ander document werd geopend, en de
// cachesleutel kwam van het ACTIEVE document: de pagina's van het vorige
// document kwamen zo onder de sleutel van het nieuwe in de cache (een
// verkeerde voorvertoning), en de PDF.js-worker bleef bezig met het vorige
// document terwijl de pagina's van het nieuwe wachtten (#506).
//
// Daarom hoort de sleutel bij het document dat gerenderd wordt, en stopt de
// lus zodra dat document niet meer voor staat of een nieuwere lus begint.

import { normaliseerRotatie } from './weergave-rotatie.js';

/**
 * Cachesleutel van de voorvertoning van `pageNum` van `doc`: het bestand, de
 * pagina en de stand waarin de pagina op het scherm staat (paginarotatie in
 * de app plus de weergaverotatie, #262 en #200).
 */
export function voorvertoningSleutel(doc, pageNum) {
  return `${doc?.filePath || 'blank'}|${pageNum}|${voorvertoningRotatie(doc, pageNum)}`;
}

/** De stand van de pagina op het scherm, bovenop haar eigen /Rotate. */
export function voorvertoningRotatie(doc, pageNum) {
  return normaliseerRotatie((Number(doc?.pageRotations?.[pageNum]) || 0)
    + normaliseerRotatie(doc?.viewRotation));
}

/**
 * Een wachter voor één achtergrondlus: geldig zolang er geen nieuwere lus is
 * gestart en het document met deze PDF nog voor staat.
 * @param {() => object|null} actiefDocument
 */
export function maakVoorvertoningLus(actiefDocument) {
  let generatie = 0;
  return function start(pdfDoc) {
    const mijn = ++generatie;
    return () => mijn === generatie && !!pdfDoc && actiefDocument()?.pdfDoc === pdfDoc;
  };
}
