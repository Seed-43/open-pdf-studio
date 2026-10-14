import { state, getActiveDocument } from '../core/state.js';
import { parsePageRange } from '../pdf/exporter.js';
import {
  KOPVOET_VAKKEN, vakPositie, vulKopVoetIn, kopVoetWaarden, toegepastePaginas, kopVoetInWeergave,
} from './kopvoet-tekst.js';

const imageCache = new Map();

function shouldRenderOnPage(watermark, pageNum, totalPages) {
  if (!watermark.enabled) return false;
  if (watermark.pageRange === 'all') return true;
  if (watermark.pageRange === 'first') return pageNum === 1;
  if (watermark.pageRange === 'custom' && watermark.customPages) {
    const pages = parsePageRange(watermark.customPages, totalPages);
    return pages.includes(pageNum);
  }
  return true;
}

function getPosition(position, customX, customY, pageWidth, pageHeight, objWidth, objHeight) {
  switch (position) {
    case 'center':
      return { x: pageWidth / 2, y: pageHeight / 2 };
    case 'top-left':
      return { x: objWidth / 2 + 40, y: objHeight / 2 + 40 };
    case 'top-right':
      return { x: pageWidth - objWidth / 2 - 40, y: objHeight / 2 + 40 };
    case 'bottom-left':
      return { x: objWidth / 2 + 40, y: pageHeight - objHeight / 2 - 40 };
    case 'bottom-right':
      return { x: pageWidth - objWidth / 2 - 40, y: pageHeight - objHeight / 2 - 40 };
    case 'custom':
      return { x: customX || pageWidth / 2, y: customY || pageHeight / 2 };
    default:
      return { x: pageWidth / 2, y: pageHeight / 2 };
  }
}

function renderTextWatermark(ctx, wm, pageWidth, pageHeight) {
  const pos = getPosition(wm.position, wm.customX, wm.customY, pageWidth, pageHeight, 0, 0);
  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.3;
  ctx.translate(pos.x, pos.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  ctx.font = `${wm.fontSize || 72}px ${wm.fontFamily || 'Helvetica'}`;
  ctx.fillStyle = wm.color || '#ff0000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(wm.text || '', 0, 0);
  ctx.restore();
}

function renderImageWatermark(ctx, wm, pageWidth, pageHeight) {
  if (!wm.imageData) return;

  let img = imageCache.get(wm.imageData);
  if (!img) {
    img = new Image();
    img.src = wm.imageData;
    imageCache.set(wm.imageData, img);
  }

  if (!img.complete) return;

  const scale = wm.scale || 1;
  const w = (wm.width || img.naturalWidth || 200) * scale;
  const h = (wm.height || img.naturalHeight || 200) * scale;
  const pos = getPosition(wm.position, wm.customX, wm.customY, pageWidth, pageHeight, w, h);

  ctx.save();
  ctx.globalAlpha = wm.opacity !== undefined ? wm.opacity : 0.2;
  ctx.translate(pos.x, pos.y);
  ctx.rotate((wm.rotation || 0) * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Dezelfde vakken, variabelen en basislijnen als in het bestand
// (pdf/saver/kopvoet.js), zodat het scherm toont wat er wordt opgeslagen.
function renderHeaderFooter(ctx, wm, pageNum, totalPages, pageWidth, pageHeight) {
  const doc = getActiveDocument();
  const waarden = kopVoetWaarden(wm, {
    pagina: pageNum,
    paginas: totalPages,
    toegepast: toegepastePaginas(wm, totalPages, parsePageRange),
    bestandsnaam: doc ? doc.fileName : '',
    titel: doc?.pdfTitel || '',
  });
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `${wm.fontSize || 10}px ${wm.fontFamily || 'Helvetica'}`;
  ctx.fillStyle = wm.color || '#000000';
  ctx.textBaseline = 'alphabetic';
  for (const vak of KOPVOET_VAKKEN) {
    const tekst = vulKopVoetIn(wm[vak.sleutel], waarden).replace(/[\r\n]+/g, ' ');
    if (!tekst.trim()) continue;
    const { x, basislijn } = vakPositie(wm, vak, pageWidth, pageHeight);
    ctx.textAlign = vak.uitlijning;
    ctx.fillText(tekst, x, basislijn);
  }
  ctx.restore();
}

function renderWatermarksForLayer(ctx, layer, pageNum, pageWidth, pageHeight) {
  const doc = getActiveDocument();
  const watermarks = doc?.watermarks;
  if (!watermarks || watermarks.length === 0) return;

  const totalPages = doc?.pdfDoc ? doc.pdfDoc.numPages : 1;

  for (const wm of watermarks) {
    if (!wm.enabled) continue;
    if ((wm.layer || 'behind') !== layer && wm.type !== 'headerFooter') continue;
    if (wm.type === 'headerFooter' && layer !== 'infront') continue;
    if (!shouldRenderOnPage(wm, pageNum, totalPages)) continue;
    // Al als pagina-inhoud in het weergegeven bestand: niet dubbel tekenen.
    if (wm.type === 'headerFooter' && kopVoetInWeergave(doc, wm)) continue;

    switch (wm.type) {
      case 'textWatermark':
        renderTextWatermark(ctx, wm, pageWidth, pageHeight);
        break;
      case 'imageWatermark':
        renderImageWatermark(ctx, wm, pageWidth, pageHeight);
        break;
      case 'headerFooter':
        renderHeaderFooter(ctx, wm, pageNum, totalPages, pageWidth, pageHeight);
        break;
    }
  }
}

export function renderWatermarksBehind(ctx, pageNum, pageWidth, pageHeight) {
  renderWatermarksForLayer(ctx, 'behind', pageNum, pageWidth, pageHeight);
}

export function renderWatermarksInFront(ctx, pageNum, pageWidth, pageHeight) {
  renderWatermarksForLayer(ctx, 'infront', pageNum, pageWidth, pageHeight);
}
