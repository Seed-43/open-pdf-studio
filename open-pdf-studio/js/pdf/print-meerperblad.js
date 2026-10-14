// Meerdere pagina's per vel ("Pages per sheet", n-up).
//
// Werkt op de al gebouwde print-PDF (print-job.js: één pagina per bronpagina,
// op het gekozen vel gelegd): die pagina's worden ingebed en in een raster van
// kolommen x rijen op nieuwe vellen gezet, elk verkleind tot de cel. Zo werken
// raster- en vectorpad allebei zonder eigen n-up-code.
//
// Het voorbeeld in de printdialoog (voorbeeldMeerPerBlad) rekent met dezelfde
// regels: dezelfde plaatsing van elke pagina op haar eigen printpagina
// (print-plaatsing.js), hetzelfde vel (kiesBlad) en dezelfde cellen
// (velIndeling). Wat het voorbeeld toont is dus wat er uit de printer komt.

import { PDFDocument, rgb } from 'pdf-lib';
import { berekenPlaatsing, printPaginaMaat, margesVoor } from './print-plaatsing.js';

const PT_PER_MM = 72 / 25.4;
const MM_PER_PT = 25.4 / 72;
/** Witruimte rond het raster (buiten het bedrukbare gebied van de meeste printers). */
export const BLAD_MARGE_PT = 8 * PT_PER_MM;
/** Witruimte tussen twee cellen. */
export const CEL_TUSSENRUIMTE_PT = 4 * PT_PER_MM;

export const MAX_PER_AS = 10;

/** Vaste keuzes: pagina's per vel -> [kolommen, rijen]. */
export const MEER_PER_BLAD_STANDAARD = Object.freeze({
  1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4],
});

export const PAGINAVOLGORDES = ['horizontal', 'horizontal-reversed', 'vertical', 'vertical-reversed'];

function geheel(n, terugval) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_PER_AS, Math.max(1, v)) : terugval;
}

/**
 * Kolommen en rijen uit de dialoogkeuze: een vast aantal (1, 2, 4, 6, 9, 16)
 * of 'custom' met eigen kolommen en rijen. Onbekend telt als 1 per vel.
 * @returns {{kolommen:number, rijen:number}}
 */
export function rasterVan({ perBlad = 1, kolommen = 1, rijen = 1 } = {}) {
  if (perBlad === 'custom') return { kolommen: geheel(kolommen, 1), rijen: geheel(rijen, 1) };
  const vast = MEER_PER_BLAD_STANDAARD[Number(perBlad)];
  return vast ? { kolommen: vast[0], rijen: vast[1] } : { kolommen: 1, rijen: 1 };
}

/** Is er meer dan één pagina per vel? */
export function isMeerPerBlad(raster) {
  return !!raster && raster.kolommen * raster.rijen > 1;
}

/** Cel (kolom, rij; rij 0 = bovenaan) van de k-de pagina op een vel. */
export function celVoorVolgnummer(k, kolommen, rijen, volgorde = 'horizontal') {
  switch (volgorde) {
    case 'horizontal-reversed':
      return { kol: kolommen - 1 - (k % kolommen), rij: Math.floor(k / kolommen) };
    case 'vertical':
      return { kol: Math.floor(k / rijen), rij: k % rijen };
    case 'vertical-reversed':
      return { kol: kolommen - 1 - Math.floor(k / rijen), rij: k % rijen };
    default:
      return { kol: k % kolommen, rij: Math.floor(k / kolommen) };
  }
}

/**
 * De cellen van één vel (PDF-coördinaten, oorsprong linksonder) en waar een
 * pagina van `paginaB` x `paginaH` erin komt: passend, gecentreerd.
 */
export function celGeometrie({ bladB, bladH, kolommen, rijen }) {
  const celB = (bladB - 2 * BLAD_MARGE_PT - (kolommen - 1) * CEL_TUSSENRUIMTE_PT) / kolommen;
  const celH = (bladH - 2 * BLAD_MARGE_PT - (rijen - 1) * CEL_TUSSENRUIMTE_PT) / rijen;
  return { celB, celH };
}

export function plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB, paginaH }) {
  const { celB, celH } = celGeometrie({ bladB, bladH, kolommen, rijen });
  const celX = BLAD_MARGE_PT + kol * (celB + CEL_TUSSENRUIMTE_PT);
  const celBoven = bladH - BLAD_MARGE_PT - rij * (celH + CEL_TUSSENRUIMTE_PT);
  const schaal = Math.min(celB / paginaB, celH / paginaH);
  const b = paginaB * schaal;
  const h = paginaH * schaal;
  return {
    x: celX + (celB - b) / 2,
    y: celBoven - celH + (celH - h) / 2,
    breedte: b,
    hoogte: h,
    schaal,
  };
}

/**
 * Het vel: afmetingen en stand. `papier` is {breedteMm, hoogteMm} als het vel
 * bekend is, anders volgt het de eerste pagina. `orientatie` 'portrait' /
 * 'landscape' staat vast; 'auto' kiest de stand waarin de eerste pagina het
 * grootst in zijn cel komt.
 */
export function kiesBlad({ papier, orientatie = 'auto', eerstePagina, kolommen, rijen }) {
  let kort;
  let lang;
  if (papier && papier.breedteMm > 0 && papier.hoogteMm > 0) {
    kort = Math.min(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
    lang = Math.max(papier.breedteMm, papier.hoogteMm) * PT_PER_MM;
  } else {
    kort = Math.min(eerstePagina.breedte, eerstePagina.hoogte);
    lang = Math.max(eerstePagina.breedte, eerstePagina.hoogte);
  }
  const staand = { bladB: kort, bladH: lang };
  const liggend = { bladB: lang, bladH: kort };
  if (orientatie === 'portrait') return staand;
  if (orientatie === 'landscape') return liggend;
  const schaalIn = (blad) => {
    const { celB, celH } = celGeometrie({ ...blad, kolommen, rijen });
    return Math.min(celB / eerstePagina.breedte, celH / eerstePagina.hoogte);
  };
  return schaalIn(liggend) > schaalIn(staand) + 1e-9 ? liggend : staand;
}

/**
 * De cellen van één vel: per pagina op dat vel (`maten`, in printvolgorde,
 * {breedte, hoogte} in pt) haar cel en haar plek (plaatsInCel, PDF-
 * coördinaten in pt). De afdruk en het voorbeeld gebruiken allebei deze regel.
 * @returns {{k:number, kol:number, rij:number, x:number, y:number,
 *            breedte:number, hoogte:number, schaal:number}[]}
 */
export function velIndeling({ bladB, bladH, kolommen, rijen, volgorde = 'horizontal', maten }) {
  return maten.slice(0, kolommen * rijen).map((m, k) => {
    const { kol, rij } = celVoorVolgnummer(k, kolommen, rijen, volgorde);
    return {
      k, kol, rij,
      ...plaatsInCel({ bladB, bladH, kolommen, rijen, kol, rij, paginaB: m.breedte, paginaH: m.hoogte }),
    };
  });
}

/** Pagina's per vel: kolommen x rijen, of 1 zonder raster. */
function perVel(raster) {
  return isMeerPerBlad(raster) ? raster.kolommen * raster.rijen : 1;
}

/** Hoeveel vellen `aantalPaginas` pagina's worden (zonder raster: één per pagina). */
export function aantalVellen(aantalPaginas, raster) {
  return Math.ceil(Math.max(0, aantalPaginas) / perVel(raster));
}

/** De pagina's (uit `paginas`, in printvolgorde) op vel `velIndex` (vanaf 0). */
export function paginasOpVel(paginas, velIndex, raster) {
  const n = perVel(raster);
  return paginas.slice(velIndex * n, velIndex * n + n);
}

/**
 * Per vel meerdere pagina's: de schaalkeuze telt dan niet. Elke bronpagina
 * wordt passend en gecentreerd op haar printpagina gezet, die daarna in zijn
 * cel komt.
 */
export function schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren) {
  return isMeerPerBlad(meerPerBlad)
    ? { schaling: 'fit', zoom: 100, centreren: true }
    : { schaling, zoom, centreren };
}

/**
 * Het voorbeeld van één vel bij meerdere pagina's per vel, zoals de
 * printopdracht het bouwt: elke pagina eerst op haar printpagina
 * (berekenPlaatsing met de keuzes van de dialoog, de schaalkeuze vervalt),
 * dan het vel (kiesBlad, uit de eerste pagina van de hele afdruk) en de
 * cellen (velIndeling).
 *
 * @param {{ meerPerBlad: {kolommen:number, rijen:number, volgorde?:string, rand?:boolean}|null,
 *           keuzes: { papier: object|'pagina'|null, orientatie?: string,
 *                     schaling?: string, zoom?: number, centreren?: boolean },
 *           eerstePagina: {breedtePt:number, hoogtePt:number},
 *           paginas: {breedtePt:number, hoogtePt:number}[] }} p
 *   eerstePagina = de eerste pagina van de afdruk (zoals getoond, met
 *   draaiing); paginas = de pagina's op dit vel, in printvolgorde.
 * @returns {null | {
 *   bekend: boolean,
 *   vel: {breedteMm:number, hoogteMm:number, orientatie:'portrait'|'landscape'},
 *   marges: {links:number, boven:number, rechts:number, onder:number},
 *   bedrukbaar: {x:number, y:number, breedte:number, hoogte:number},
 *   rand: boolean, schaal: number|null,
 *   cellen: { k:number, plaatsing:object, schaal:number,
 *             opVel:{x:number, y:number, breedte:number, hoogte:number} }[] }}
 *   Rechthoeken in mm vanaf de linkerbovenhoek van het vel. Per cel:
 *   plaatsing = de pagina op haar printpagina (print-plaatsing.js), opVel =
 *   waar die printpagina op het vel komt, schaal = de verkleining daarbij.
 *   schaal = de schaal van de eerste pagina van het vel op het papier.
 *   null bij één pagina per vel of een onbruikbare paginamaat.
 */
export function voorbeeldMeerPerBlad({ meerPerBlad, keuzes, eerstePagina, paginas }) {
  if (!isMeerPerBlad(meerPerBlad) || !keuzes) return null;
  const { kolommen, rijen, volgorde = 'horizontal', rand = false } = meerPerBlad;
  const { papier: vel = null, orientatie = 'auto', schaling, zoom, centreren } = keuzes;
  const celKeuzes = { papier: vel, orientatie, ...schaalVoorMeerPerBlad(meerPerBlad, schaling, zoom, centreren) };
  const plaats = (pagina) => berekenPlaatsing({ ...celKeuzes, pagina });
  const maat = (plaatsing) => {
    const [breedte, hoogte] = printPaginaMaat(plaatsing);
    return { breedte, hoogte };
  };

  const eerste = plaats(eerstePagina);
  const plaatsingen = (paginas || []).map(plaats);
  if (!eerste || plaatsingen.some((p) => !p)) return null;

  // Zoals metMeerPerBlad in print-job.js: alleen een vel met maten telt als
  // papier; anders volgt het vel de eerste printpagina.
  const papier = vel && typeof vel === 'object' ? vel : null;
  const { bladB, bladH } = kiesBlad({ papier, orientatie, eerstePagina: maat(eerste), kolommen, rijen });
  const velB = bladB * MM_PER_PT;
  const velH = bladH * MM_PER_PT;
  const stand = bladB > bladH ? 'landscape' : 'portrait';

  const cellen = velIndeling({ bladB, bladH, kolommen, rijen, volgorde, maten: plaatsingen.map(maat) })
    .map((c) => ({
      k: c.k,
      plaatsing: plaatsingen[c.k],
      schaal: c.schaal,
      opVel: {
        x: c.x * MM_PER_PT,
        y: (bladH - c.y - c.hoogte) * MM_PER_PT,
        breedte: c.breedte * MM_PER_PT,
        hoogte: c.hoogte * MM_PER_PT,
      },
    }));

  const marges = margesVoor(papier && papier.bedrukbaar, stand, velB, velH);
  return {
    bekend: eerste.bekend,
    vel: { breedteMm: velB, hoogteMm: velH, orientatie: stand },
    marges,
    bedrukbaar: {
      x: marges.links,
      y: marges.boven,
      breedte: velB - marges.links - marges.rechts,
      hoogte: velH - marges.boven - marges.onder,
    },
    rand: !!rand,
    schaal: cellen.length ? cellen[0].plaatsing.schaal * cellen[0].schaal : null,
    cellen,
  };
}

/**
 * Bouw de print-PDF met meerdere pagina's per vel uit `pdf` (één pagina per
 * bronpagina). Geeft een nieuw PDFDocument; zonder meer dan één per vel komt
 * `pdf` zelf terug.
 * @param {PDFDocument} pdf
 * @param {{ kolommen:number, rijen:number, volgorde?:string, rand?:boolean,
 *           papier?:{breedteMm:number, hoogteMm:number}|null,
 *           orientatie?:'auto'|'portrait'|'landscape' }} opties
 */
export async function maakMeerPerBlad(pdf, opties) {
  const { kolommen, rijen, volgorde = 'horizontal', rand = false, papier = null, orientatie = 'auto' } = opties;
  if (!isMeerPerBlad({ kolommen, rijen })) return pdf;
  const bron = pdf.getPages();
  if (bron.length === 0) return pdf;

  const maten = bron.map((p) => {
    const { width, height } = p.getSize();
    return { breedte: width, hoogte: height };
  });
  const { bladB, bladH } = kiesBlad({ papier, orientatie, eerstePagina: maten[0], kolommen, rijen });

  // pdf-lib schrijft lui ingebedde afbeeldingen en fonts (embedJpg/embedFont
  // in bouwPrintPdf) pas bij flush()/save() weg. Zonder flush kopieert
  // embedPdf alleen de verwijzingen en blijven de cellen leeg.
  await pdf.flush();
  const uit = await PDFDocument.create();
  const ingebed = await uit.embedPdf(pdf, bron.map((_, i) => i));
  const perBlad = kolommen * rijen;
  for (let start = 0; start < bron.length; start += perBlad) {
    const blad = uit.addPage([bladB, bladH]);
    const cellen = velIndeling({
      bladB, bladH, kolommen, rijen, volgorde, maten: maten.slice(start, start + perBlad),
    });
    for (const p of cellen) {
      blad.drawPage(ingebed[start + p.k], { x: p.x, y: p.y, width: p.breedte, height: p.hoogte });
      if (rand) {
        blad.drawRectangle({
          x: p.x, y: p.y, width: p.breedte, height: p.hoogte,
          borderColor: rgb(0, 0, 0), borderWidth: 0.5,
        });
      }
    }
  }
  return uit;
}
