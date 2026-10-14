// Opslaan van een meetvlak (measureArea) met zijn eigen schaal en zijdematen
// (GitHub #536).
//
// - Eigen schaal (measureScale, eenheden per punt, in de lengte-eenheid van
//   measureUnit): een standaard /Measure-woordenboek met /X (lengte) en /A
//   (oppervlakte). De lader leest dat terug (loader/color-extraction.js en
//   annotation-converter.js, met vlakSchaalUitMeasure uit vlak-zijden.js, dat
//   de schaal van /X en de eenheid van /A op elkaar laat passen). Zonder
//   eigen schaal geen /Measure, zoals voorheen.
// - Zijdematen: de sleutel OPS_EdgeLengths staat in saver/plattegrond-meta.js
//   bij de andere meetvlak-sleutels; de maten zelf komen in de appearance
//   (appearance-vectors.js, buildMeasureAreaAP). De /Rect moet ze omvatten,
//   anders knipt een andere lezer ze weg: meetvlakRect hieronder.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { vlakRect } from './utils.js';
import { vlakZijden, zijdeLabel, zijdeLabelKader, lengteEenheid } from '../../annotations/vlak-zijden.js';

/**
 * Schrijft de eigen schaal van een meetvlak als /Measure. Geeft true als er
 * een eigen schaal was.
 */
export function schrijfMeetvlakSchaal(annotDict, ann, context) {
  const schaal = Number(ann?.measureScale);
  if (!annotDict || !(schaal > 0)) return false;
  const eenheid = lengteEenheid(ann.measureUnit) || 'mm';
  const precisie = Number.isInteger(ann.measurePrecision) && ann.measurePrecision >= 0
    ? Math.min(ann.measurePrecision, 9) : 2;
  const lengte = context.obj({ U: pdfTextString(eenheid), C: schaal });
  const oppervlakte = context.obj({ U: pdfTextString(`${eenheid}²`), C: 1, D: 10 ** precisie });
  annotDict.set(PDFName.of('Measure'), context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: pdfTextString(`1 pt = ${schaal} ${eenheid}`),
    X: context.obj([lengte]),
    A: context.obj([oppervlakte]),
  }));
  return true;
}

/**
 * De /Rect van een meetvlak: de omhullende van alle ringen (vlakRect) en,
 * met zijdematen, ook het vak van elke maat. `zijdeTeksten` is een lijst
 * { index, tekst } (measurement.js, vlakZijdeTeksten); `draaiing` de
 * paginarotatie in radialen, zoals de appearance hem gebruikt.
 */
export function meetvlakRect(ann, X, Y, zijdeTeksten, draaiing = 0) {
  const rect = vlakRect(ann, X, Y, 2);
  if (!Array.isArray(zijdeTeksten) || zijdeTeksten.length === 0) return rect;
  const tekstVan = new Map(zijdeTeksten.map((z) => [z.index, z.tekst]));
  const marge = 1;
  for (const zijde of vlakZijden(ann.points)) {
    const tekst = tekstVan.get(zijde.index);
    if (!tekst) continue;
    for (const p of zijdeLabelKader(zijdeLabel(zijde, { draaiing }), tekst)) {
      const px = X(p.x);
      const py = Y(p.y);
      rect[0] = Math.min(rect[0], px - marge);
      rect[1] = Math.min(rect[1], py - marge);
      rect[2] = Math.max(rect[2], px + marge);
      rect[3] = Math.max(rect[3], py + marge);
    }
  }
  return rect;
}
