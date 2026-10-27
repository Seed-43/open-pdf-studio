// 3D markup page: a new last page that shows the sheet of the 3D page (its
// page content, without the live 3D model) with a picture of the current 3D
// view over the 3D annotation's rectangle. Markups then go on that page with
// the normal tools, while the 3D page itself stays free to rotate. The page
// remembers the camera under /OPS_3DSnapshot (JSON: sourcePage, name, c2w,
// co, fov, ortho, hidden), so the model can later be reopened at that view.
import { PDFDocument, PDFName, PDFHexString, degrees, rgb } from 'pdf-lib';
import { SNAPSHOT_KEY } from './pdf-3d.js';

/**
 * Append the markup page to a pdf-lib document.
 * @param {PDFDocument} pdfDoc
 * @param {{sourcePage:number, rect:number[]|null, jpeg:Uint8Array, name:string, view:object}} snap
 * @returns {Promise<number>} the new page number (1-based)
 */
export async function appendSnapshotPage(pdfDoc, snap) {
  const src = pdfDoc.getPage(snap.sourcePage - 1);
  const media = src.getMediaBox();
  const crop = src.getCropBox();
  const rot = ((src.getRotation().angle % 360) + 360) % 360;

  // Same sheet: the source page's content (title block, frame, notes) as a
  // form XObject; annotations, the live 3D model among them, stay behind.
  // The new page keeps the source's boxes, so the 3D annotation's /Rect
  // lands on the same spot of the sheet.
  const sheet = await pdfDoc.embedPage(src);
  const newIdx = pdfDoc.getPageCount();
  const page = pdfDoc.insertPage(newIdx, [media.width, media.height]);
  page.setMediaBox(media.x, media.y, media.width, media.height);
  if (crop.x !== media.x || crop.y !== media.y || crop.width !== media.width || crop.height !== media.height) {
    page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  }
  if (rot) page.setRotation(degrees(rot));
  page.drawPage(sheet, { x: media.x, y: media.y, width: media.width, height: media.height });

  // The picture over the 3D area, turned against the page's /Rotate so it
  // reads the right way up on screen.
  const img = await pdfDoc.embedJpg(snap.jpeg);
  const [x1, y1, x2, y2] = snap.rect || [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height];
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
  page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color: rgb(1, 1, 1) });
  if (rot === 90) page.drawImage(img, { x: rx + rw, y: ry, width: rh, height: rw, rotate: degrees(90) });
  else if (rot === 180) page.drawImage(img, { x: rx + rw, y: ry + rh, width: rw, height: rh, rotate: degrees(180) });
  else if (rot === 270) page.drawImage(img, { x: rx, y: ry + rh, width: rh, height: rw, rotate: degrees(-90) });
  else page.drawImage(img, { x: rx, y: ry, width: rw, height: rh });

  page.node.set(PDFName.of(SNAPSHOT_KEY), PDFHexString.fromText(JSON.stringify({
    sourcePage: snap.sourcePage, name: snap.name, ...snap.view,
  })));
  return newIdx + 1;
}

/**
 * Add a markup page for the active document and go to it; undoable like
 * the other page operations.
 * @returns {Promise<number|null>} the new page number
 */
export async function insertThreeDSnapshotPage(snap) {
  const [{ getActiveDocument }, { getCachedPdfBytes }, pm, { recordPageStructure }, { showLoading, hideLoading }] = await Promise.all([
    import('../../core/state.js'),
    import('../loader.js'),
    import('../page-manager.js'),
    import('../../core/undo-manager.js'),
    import('../../ui/chrome/dialogs.js'),
  ]);
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  // The working bytes, or the open document's own data when they are not cached.
  const currentBytes = getCachedPdfBytes(pm.getCacheKey()) || new Uint8Array(await doc.pdfDoc.getData());
  if (!currentBytes?.length) return null;
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  showLoading('Creating 3D markup page...');
  try {
    const pdfDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true });
    const oldCount = pdfDoc.getPageCount();
    const targetPage = await appendSnapshotPage(pdfDoc, snap);
    const newBytes = new Uint8Array(await pdfDoc.save());
    // The page is appended: existing pages keep their numbers.
    const pageMapping = {};
    for (let p = 1; p <= oldCount; p++) pageMapping[p] = p;
    const newAnnotations = doc.annotations;
    const newRotations = { ...doc.pageRotations };
    const inModel = await pm.reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage, { pageMapping });
    recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, newRotations, targetPage);
    return targetPage;
  } finally {
    hideLoading();
  }
}
