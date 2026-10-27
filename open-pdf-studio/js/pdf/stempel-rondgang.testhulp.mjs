// Testhulp voor stempels en afbeeldingen: opslaan met de echte saver en
// heropenen met de echte lader, MET de bitmap uit de appearance.
//
// rondgang.testhulp.mjs geeft de lader een lege beeldenkaart; een stempel komt
// dan terug als tekststempel. Hier haalt de lader de bitmaps via het echte
// pdf-lib-pad (extractStampImages); alleen het decoderen naar een data-URL
// (dat vraagt een canvas) is vervangen door een PNG van dezelfde pixelmaat.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { state } from './rondgang.testhulp.mjs';

const { zetPaginaAnnotatiesOm } = await import('./loader/annotaties-omzetten.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { extractStampImages } = await import('./loader/image-extraction.js');

// De converter maakt een Image voor de beeldcache; in node volstaat een leeg object.
globalThis.Image ??= class { constructor() { this.complete = true; } };

export { state };

// zlib.crc32 bestaat in Node 20 (CI) nog niet.
const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABEL[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function brok(soort, data) {
  const kop = Buffer.alloc(8);
  kop.writeUInt32BE(data.length, 0);
  kop.write(soort, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kop.subarray(4), data])), 0);
  return Buffer.concat([kop, data, crc]);
}

/**
 * Een RGB-PNG van b × h pixels: wit, met een rode pixel linksboven en een
 * blauwe rechtsboven (zo is boven/links in de bytes terug te vinden).
 * @returns {Uint8Array}
 */
export function maakPng(b, h) {
  const rij = 1 + b * 3;
  const ruw = Buffer.alloc(rij * h, 255);
  for (let y = 0; y < h; y++) ruw[y * rij] = 0; // filter: geen
  ruw.set([255, 0, 0], 1);
  ruw.set([0, 0, 255], 1 + (b - 1) * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(b, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    brok('IHDR', ihdr), brok('IDAT', zlib.deflateSync(ruw)), brok('IEND', Buffer.alloc(0)),
  ]));
}

export const pngDataUrl = (b, h) => `data:image/png;base64,${Buffer.from(maakPng(b, h)).toString('base64')}`;

/** Pixelmaat van een PNG-data-URL. */
export function pngMaat(dataUrl) {
  const bytes = Buffer.from(String(dataUrl).split(',')[1], 'base64');
  return { b: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

// Plaatsvervanger voor extractImageFromFormXObject: een PNG met de pixelmaat
// van de eerste afbeelding in de appearance.
function nepDecodeer(context, formStream) {
  const dict = formStream.dict || formStream;
  if (dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
    return pngDataUrl(dict.get(PDFName.of('Width')).asNumber(), dict.get(PDFName.of('Height')).asNumber());
  }
  const xo = context.lookup(context.lookup(dict.get(PDFName.of('Resources')))?.get(PDFName.of('XObject')));
  if (!xo) return null;
  for (const [, ref] of xo.entries()) {
    const img = context.lookup(ref);
    if (img?.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') {
      const b = img.dict.get(PDFName.of('Width')).asNumber();
      const h = img.dict.get(PDFName.of('Height')).asNumber();
      return pngDataUrl(b, h);
    }
  }
  return null;
}

/** De modellen van blad 1, met bitmaps uit de appearances. */
export async function laadMetBeelden(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const lib = await PDFDocument.load(bytes.slice());
  const beelden = await extractStampImages(1, lib, { decodeer: nepDecodeer });
  const kaart = await extractAnnotationColors(1, lib);
  const modellen = await zetPaginaAnnotatiesOm(await pagina.getAnnotations(), 1, viewport, beelden, kaart);
  await doc.loadingTask.destroy();
  return modellen;
}

/** Getallen van een PDF-array. */
export function getallen(arr) {
  return arr instanceof PDFArray ? arr.asArray().map((v) => v.asNumber()) : null;
}

/**
 * De appearance van een stempel-dict: /BBox, /Matrix en de inhoud als tekst.
 */
export function appearance(doc, dict) {
  const ctx = doc.context;
  const n = ctx.lookup(ctx.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  let bytes = Buffer.from(n.contents);
  if (String(n.dict.get(PDFName.of('Filter')) || '').includes('FlateDecode')) bytes = zlib.inflateSync(bytes);
  return {
    bbox: getallen(ctx.lookup(n.dict.get(PDFName.of('BBox')))),
    matrix: getallen(ctx.lookup(n.dict.get(PDFName.of('Matrix')))),
    inhoud: bytes.toString('latin1'),
  };
}
