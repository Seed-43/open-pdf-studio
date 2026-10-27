// De appearance van een /Stamp lezen voor stempel-geometrie.js: /BBox,
// /Matrix, en uit de inhoud de plaats van de eerste afbeelding en de eerste
// rechthoek. Alleen pdf-lib: ook in node te testen.

import { PDFName, PDFArray } from 'pdf-lib';
import { pdfNum, inflateBytes } from './pdf-helpers.js';
import { analyseerInhoud } from './stempel-geometrie.js';

function getallen(context, raw, aantal) {
  const arr = raw ? context.lookup(raw) || raw : null;
  if (!(arr instanceof PDFArray) || arr.size() < aantal) return null;
  const uit = [];
  for (let i = 0; i < aantal; i++) {
    const v = pdfNum(context.lookup(arr.get(i)) || arr.get(i));
    uit.push(v === null ? 0 : v);
  }
  return uit.every(Number.isFinite) ? uit : null;
}

async function inhoudVan(stream) {
  let bytes;
  if (typeof stream.getContents === 'function') bytes = stream.getContents();
  else if (stream.contents instanceof Uint8Array) bytes = stream.contents;
  if (!bytes) return null;
  const dict = stream.dict || stream;
  const filter = dict.get(PDFName.of('Filter'))?.toString() || '';
  if (filter.includes('/FlateDecode')) {
    // Alleen een enkele Flate-filter; een keten met andere filters laten we liggen.
    if (filter.startsWith('[') && filter.replace(/\/FlateDecode/, '').match(/\/\w+/)) return null;
    bytes = await inflateBytes(bytes);
    if (!bytes) return null;
  } else if (filter) {
    return null;
  }
  return new TextDecoder('latin1').decode(bytes);
}

/**
 * @returns {Promise<null|{ matrix:number[]|null, bbox:number[], beeld:null|{ctm:number[],pixelW:number,pixelH:number},
 *   eersteRe:null|{ctm:number[],x:number,y:number,w:number,h:number} }>}
 */
export async function leesStempelAp(context, annotDict) {
  try {
    const apRaw = annotDict.get(PDFName.of('AP'));
    const ap = apRaw ? context.lookup(apRaw) : null;
    const nRaw = ap?.get?.(PDFName.of('N'));
    const stream = nRaw ? context.lookup(nRaw) : null;
    const dict = stream?.dict;
    if (!dict || dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') return null;
    const bbox = getallen(context, dict.get(PDFName.of('BBox')), 4);
    if (!bbox) return null;
    const matrix = getallen(context, dict.get(PDFName.of('Matrix')), 6);
    const inhoud = await inhoudVan(stream);
    if (inhoud === null) return null;
    const analyse = analyseerInhoud(inhoud);

    // De eerste Do die een afbeelding uit de eigen /Resources tekent. Tekent
    // de appearance eerst een geneste Form, dan is het vak niet eenduidig.
    let beeld = null;
    const resRaw = dict.get(PDFName.of('Resources'));
    const res = resRaw ? context.lookup(resRaw) : null;
    const xoRaw = res?.get?.(PDFName.of('XObject'));
    const xobjecten = xoRaw ? context.lookup(xoRaw) : null;
    for (const d of analyse.beeldDo) {
      const doelRaw = xobjecten?.get?.(PDFName.of(d.naam));
      const doel = doelRaw ? context.lookup(doelRaw) : null;
      const soort = doel?.dict?.get?.(PDFName.of('Subtype'))?.toString();
      if (soort === '/Image') {
        const pixelW = pdfNum(context.lookup(doel.dict.get(PDFName.of('Width'))) || doel.dict.get(PDFName.of('Width')));
        const pixelH = pdfNum(context.lookup(doel.dict.get(PDFName.of('Height'))) || doel.dict.get(PDFName.of('Height')));
        beeld = { ctm: d.ctm, pixelW: pixelW || 0, pixelH: pixelH || 0 };
        break;
      }
      if (soort === '/Form') break;
    }
    return { matrix, bbox, beeld, eersteRe: analyse.eersteRe };
  } catch (_) {
    return null;
  }
}
