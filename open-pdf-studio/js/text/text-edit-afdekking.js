// ── Afdekking van de oude tekst in de weergave van een tekstbewerking (#669) ──
//
// Tot een tekstbewerking opgeslagen is, toont de weergave de originele pagina
// met de bewerking erover getekend (painter in annotations/rendering.js).
// Waar de oude tekst stond, legt de painter een uitsnede van de pagina zónder
// tekst: PDF.js tekent dat gebied met alle tekst- en afbeeldingsoperaties
// overgeslagen (operationsFilter). Lijnen, vlakken en arceringen blijven zo
// gewoon staan, ook als ze de tekst raken of kruisen. Het witte vlak dat er
// eerst lag, wiste de tabelranden rond en door de bewerkte tekst.
//
// Afbeeldingen blijven in de uitsnede staan: zichtbare tekst over een foto
// of een vlak met een afbeelding zit niet in de pixels, en een wit gat in de
// afbeelding was er niet. Alleen op een pagina met onzichtbare tekst (een
// OCR-laag over een scan) zit de oude tekst wél in de pixels; daar valt de
// afbeelding weg, zoals de saver hem in het bestand wit afdekt (needsCover in
// saver/text-edit-inplace.js).
//
// Een uitsnede wordt per bewerking gerenderd op de dichtheid (pixels per
// punt) van het canvas waarop hij komt en gecachet; na een zoomwissel volgt
// een nieuwe. Tot die klaar is, tekent de painter de vorige (geschaald) of
// de strakke witte vlakken.

// Operaties die tekst tekenen. OPS = pdfjsLib.OPS (als parameter, zodat dit
// zonder PDF.js te testen is).
export function afdekTekstOps(OPS) {
  return new Set([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ].filter(op => op !== undefined));
}

// Operaties die tekst of afbeeldingen tekenen.
export function afdekOverslaanOps(OPS) {
  return new Set([
    ...afdekTekstOps(OPS),
    OPS.paintImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ].filter(op => op !== undefined));
}

// Heeft de pagina onzichtbare tekst (render-modus 3 of 7, een OCR-laag)?
export function heeftOnzichtbareTekst(operatorList, OPS) {
  const fn = operatorList?.fnArray || [];
  const args = operatorList?.argsArray || [];
  for (let i = 0; i < fn.length; i++) {
    if (fn[i] === OPS.setTextRenderingMode) {
      const modus = Number(args[i]?.[0]) & 7;
      if (modus === 3 || modus === 7) return true;
    }
  }
  return false;
}

// operationsFilter voor page.render(): true = operatie uitvoeren. Met
// afbeeldingen: false blijven afbeeldingen staan (alleen de tekst gaat weg).
export function maakAfdekFilter(OPS, { afbeeldingen = true } = {}) {
  const overslaan = afbeeldingen ? afdekOverslaanOps(OPS) : afdekTekstOps(OPS);
  return (index, operatorList) => !overslaan.has(operatorList.fnArray[index]);
}

// Grenzen aan één uitsnede: een canvas-as en het aantal pixels. Bij extreme
// zoom wordt de uitsnede dan iets zachter in plaats van onbegrensd groot.
export const MAX_UITSNEDE_AS = 4096;
export const MAX_UITSNEDE_PIXELS = 8e6;

// Renderdichtheid (pixels per punt) voor een kader van `kader.width` ×
// `kader.height` punten op een canvas met `pxPerPt` pixels per punt.
export function uitsnedeDichtheid(kader, pxPerPt) {
  const w = Math.max(Number(kader?.width) || 0, 1e-3);
  const h = Math.max(Number(kader?.height) || 0, 1e-3);
  let px = Math.max(Number(pxPerPt) || 1, 0.1);
  px = Math.min(px, MAX_UITSNEDE_AS / w, MAX_UITSNEDE_AS / h);
  const pixels = w * h * px * px;
  if (pixels > MAX_UITSNEDE_PIXELS) px *= Math.sqrt(MAX_UITSNEDE_PIXELS / pixels);
  return px;
}

// Is een uitsnede op dichtheid `gehad` goed genoeg voor `nodig`? Te grof
// wordt zacht, veel te fijn kost geheugen; kleine zoomstapjes niet opnieuw.
export function uitsnedeVoldoet(gehad, nodig) {
  return gehad >= nodig * 0.95 && gehad <= nodig * 1.6;
}

// Bevat kader a het kader b (met een kleine tolerantie)?
function bevat(a, b) {
  const eps = 1e-3;
  return !!a && !!b
    && a.x <= b.x + eps && a.y <= b.y + eps
    && a.x + a.width >= b.x + b.width - eps
    && a.y + a.height >= b.y + b.height - eps;
}

// Het kader op het pixelraster van de uitsnede: de randen op veelvouden van
// 1/px punt. De painter legt de oorsprong van het tekenkader op een hele
// devicepixel; dan vallen de pixels van de uitsnede precies op die van het
// canvas en worden lijnen in de uitsnede niet half-pixel uitgesmeerd.
export function uitsnedeKader(omhullende, px) {
  const x0 = Math.floor(omhullende.x * px) / px;
  const y0 = Math.floor(omhullende.y * px) / px;
  const x1 = Math.ceil((omhullende.x + omhullende.width) * px) / px;
  const y1 = Math.ceil((omhullende.y + omhullende.height) * px) / px;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const _caches = new WeakMap(); // doc → Map<sleutel, uitsnede>
let _herteken = null;

/** Wat er moet gebeuren als een uitsnede klaar is (weergave hertekenen). */
export function zetAfdekkingHerteken(fn) {
  _herteken = typeof fn === 'function' ? fn : null;
}

// Rendert het kader (tekenkader van de painter: x vanaf de linkerrand van de
// pagina-box, y omlaag vanaf de bovenrand, in punten) zonder tekst (en op een
// OCR-pagina zonder afbeeldingen). Het PDF.js-viewport zonder rotatie heeft hetzelfde kader.
async function renderUitsnede(pdfDoc, pageNum, kader, px) {
  const pdfjs = await import('pdfjs-dist');
  const page = await pdfDoc.getPage(pageNum);
  // Scan met OCR-laag: de oude tekst zit in de pixels, de afbeelding moet weg.
  // Anders blijft de afbeelding staan (geen wit gat in een foto).
  const ocrPagina = heeftOnzichtbareTekst(
    await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE }), pdfjs.OPS);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(kader.width * px));
  canvas.height = Math.max(1, Math.ceil(kader.height * px));
  await page.render({
    canvas,
    viewport: page.getViewport({ scale: px, rotation: 0 }),
    transform: [1, 0, 0, 1, -kader.x * px, -kader.y * px],
    annotationMode: pdfjs.AnnotationMode.DISABLE,
    background: '#ffffff',
    operationsFilter: maakAfdekFilter(pdfjs.OPS, { afbeeldingen: ocrPagina }),
  }).promise;
  return canvas;
}

function plan(doc, cache, sleutel, pageNum, kader, px) {
  let u = cache.get(sleutel);
  if (!u) {
    u = { pdfDoc: doc.pdfDoc, kader: null, px: 0, canvas: null, doel: null, wens: null, mislukt: null };
    cache.set(sleutel, u);
  }
  u.wens = { kader, px };
  if (u.doel) return;
  (async () => {
    while (u.wens) {
      u.doel = u.wens;
      u.wens = null;
      try {
        const canvas = await renderUitsnede(u.pdfDoc, pageNum, u.doel.kader, u.doel.px);
        if (cache.get(sleutel) !== u) break; // intussen vergeten
        u.canvas = canvas;
        u.kader = u.doel.kader;
        u.px = u.doel.px;
      } catch (err) {
        // Document gesloten of herladen, of PDF.js kon de pagina niet tekenen:
        // dan blijven de witte vlakken staan.
        u.mislukt = u.doel;
        console.warn('[tekstbewerking] uitsnede zonder tekst niet gerenderd:', err);
        break;
      }
    }
    u.doel = null;
    if (_herteken) {
      try { _herteken(); } catch (e) { console.warn('[tekstbewerking] hertekenen faalde:', e); }
    }
  })();
}

/**
 * De uitsnede zonder tekst voor één bewerking: { canvas, kader, px }, of null
 * zolang er geen bruikbare is. Plant zo nodig een render op de dichtheid van
 * het doelcanvas; is die klaar, dan volgt zetAfdekkingHerteken(). De
 * uitsnede hoort op `kader` getekend te worden (canvas.width/px breed).
 *
 * @param {object} doc       document met pdfDoc (PDF.js)
 * @param {number} pageNum
 * @param {string} sleutel   uniek per pagina en bewerking (afdekSleutel)
 * @param {{x:number,y:number,width:number,height:number}} omhullende
 *   gebied dat afgedekt moet worden, in het tekenkader (punten)
 * @param {number} pxPerPt   pixels per punt van het canvas waarop hij komt
 * @param {{plannen?: boolean}} [opties]  plannen:false = alleen uit de cache
 */
export function afdekUitsnede(doc, pageNum, sleutel, omhullende, pxPerPt, { plannen = true } = {}) {
  if (!doc?.pdfDoc || typeof doc.pdfDoc.getPage !== 'function' || !omhullende) return null;
  let cache = _caches.get(doc);
  if (!cache) {
    cache = new Map();
    _caches.set(doc, cache);
  }
  let u = cache.get(sleutel);
  if (u && u.pdfDoc !== doc.pdfDoc) { // document herladen: oude pixels gelden niet meer
    cache.delete(sleutel);
    u = null;
  }
  const nodig = uitsnedeDichtheid(omhullende, pxPerPt);
  const bruikbaar = u?.canvas && bevat(u.kader, omhullende) ? u : null;
  const klaarOfOnderweg = (bruikbaar && uitsnedeVoldoet(bruikbaar.px, nodig))
    || (u?.doel && bevat(u.doel.kader, omhullende) && uitsnedeVoldoet(u.doel.px, nodig))
    || (u?.mislukt && bevat(u.mislukt.kader, omhullende));
  if (plannen && !klaarOfOnderweg && typeof document !== 'undefined') {
    plan(doc, cache, sleutel, pageNum, uitsnedeKader(omhullende, nodig), nodig);
  }
  return bruikbaar ? { canvas: bruikbaar.canvas, kader: bruikbaar.kader, px: bruikbaar.px } : null;
}

/** Vergeet de uitsneden van een pagina die niet meer bij een bewerking horen. */
export function houdAfdekkingen(doc, pageNum, sleutels) {
  const cache = doc ? _caches.get(doc) : null;
  if (!cache) return;
  const houden = new Set(sleutels);
  const prefix = `${pageNum}|`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix) && !houden.has(k)) cache.delete(k);
  }
}

// Sleutel van een uitsnede: pagina en bewerking.
export function afdekSleutel(pageNum, editId) {
  return `${pageNum}|${editId}`;
}
