// Arceringsgegevens van een vlak: schrijven naar de annotatie en teruglezen.
//
// De arcering staat als lijnen in de appearance, zodat elke lezer hem toont.
// Om hem in de app te kunnen blijven bewerken moeten de parameters er ook als
// eigen sleutels bij: zonder die sleutels kent het model na heropenen geen
// arcering meer en schrijft de volgende save het vlak zonder arcering weg.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';

/** Zet OPS_HatchPattern/Color/Scale/Angle op de annotatie (niets bij 'none'). */
export function schrijfHatchMeta(annotDict, ann, context) {
  if (!ann?.hatchPattern || ann.hatchPattern === 'none') return false;
  annotDict.set(PDFName.of('OPS_HatchPattern'), pdfTextString(ann.hatchPattern));
  if (ann.hatchColor) annotDict.set(PDFName.of('OPS_HatchColor'), pdfTextString(ann.hatchColor));
  if (ann.hatchScale != null) annotDict.set(PDFName.of('OPS_HatchScale'), context.obj(ann.hatchScale));
  if (ann.hatchAngle != null) annotDict.set(PDFName.of('OPS_HatchAngle'), context.obj(ann.hatchAngle));
  return true;
}

/** De arceringsvelden voor het annotatiemodel, uit de gelezen OPS_-sleutels. */
export function hatchUitExtra(extra, standaardKleur = '#000000') {
  const e = extra || {};
  return {
    hatchPattern: e.opsHatchPattern || 'none',
    hatchColor: e.opsHatchColor || standaardKleur,
    hatchScale: e.opsHatchScale ?? 100,
    hatchAngle: e.opsHatchAngle ?? 0,
  };
}

// Namen die tekenpakketten in /PatternName zetten (een PDF-tegelpatroon in de
// appearance), naar de arceringen van de app (#621). Vergeleken zonder
// hoofdletters, spaties, streepjes en lage streepjes. 'Diagonal Up' loopt
// rechts omhoog: in app-coördinaten (y omlaag) is dat -45°, 'diagonal-right'.
const PATROONNAMEN = {
  horizontal: 'horizontal',
  vertical: 'vertical',
  cross: 'grid',
  grid: 'grid',
  square: 'grid',
  diagonalup: 'diagonal-right',
  forwarddiagonal: 'diagonal-right',
  diagonaldown: 'diagonal-left',
  backwarddiagonal: 'diagonal-left',
  diagonalcross: 'crosshatch',
  crosshatch: 'crosshatch',
  diamond: 'crosshatch',
  dots: 'dots',
  dot: 'dots',
  solid: 'solid',
  brick: 'brick-running',
};

/** De arcering van de app bij een /PatternName, of null als hij onbekend is. */
export function hatchUitPatroonNaam(naam) {
  if (typeof naam !== 'string') return null;
  return PATROONNAMEN[naam.toLowerCase().replace(/[\s_-]+/g, '')] || null;
}

/**
 * De arceringsvelden van een vorm (rechthoek, ellips, veelhoek, wolk) bij het
 * laden (#621): de eigen OPS_Hatch*-sleutels, anders een bekend /PatternName
 * van een ander programma (kleur uit /PatternColor). Zonder arcering niets, zodat
 * het model van een gewone vorm hetzelfde blijft.
 */
export function vormHatchUitExtra(extra) {
  const e = extra || {};
  if (e.opsHatchPattern && e.opsHatchPattern !== 'none') return hatchUitExtra(e);
  const patroon = hatchUitPatroonNaam(e.pdfPatternName);
  if (!patroon) return {};
  return { hatchPattern: patroon, hatchColor: e.pdfPatternColor || '#000000', hatchScale: 100, hatchAngle: 0 };
}
