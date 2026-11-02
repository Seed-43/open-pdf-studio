// Explorer right-click actions (installer: src-tauri/nsis/hooks.nsh).
//
// "Combine into one PDF" on selected PDFs and "Convert to PDF" on images and
// CAD drawings. Explorer starts the app once per selected file; the first
// start brings its own file (get_shell_action), the others reach the running
// app through the single-instance plugin ("shell-action" event). The files of
// one multi-select are collected for a moment and then handled together.
import { invoke, isTauri } from './platform.js';

const WACHT_MS = 900;
const wachtrij = { combine: [], convert: [] };
let timer = null;
let klaar = false;

function voegToe(actie) {
  if (!actie || !Array.isArray(actie.files)) return;
  const lijst = wachtrij[actie.mode];
  if (!lijst) return;
  for (const f of actie.files) if (!lijst.includes(f)) lijst.push(f);
  if (klaar) planVerwerking();
}

function planVerwerking() {
  clearTimeout(timer);
  timer = setTimeout(verwerk, WACHT_MS);
}

const naam = (p) => p.split(/[\\/]/).pop();
const opNaam = (a, b) => naam(a).localeCompare(naam(b), undefined, { numeric: true, sensitivity: 'base' });

async function verwerk() {
  const combineren = wachtrij.combine.splice(0).sort(opNaam);
  const omzetten = wachtrij.convert.splice(0).sort(opNaam);
  if (combineren.length) {
    const { openDialog } = await import('../solid/stores/dialogStore.js');
    openDialog('merge-pdfs', { files: combineren, combineNew: true });
  }
  for (const pad of omzetten) {
    try { await zetOmNaarPdf(pad); } catch (e) { console.error('[convert-to-pdf]', pad, e); }
  }
}

const AFBEELDING = /\.(jpe?g|png|bmp|gif|webp)$/i;
const CAD = /\.(dwg|dxf)$/i;

// One file to PDF: a drawing goes through the CAD import window; an image
// becomes a PDF next to it (same name, .pdf; "(2)" etc. when taken), which
// then opens.
async function zetOmNaarPdf(pad) {
  if (CAD.test(pad)) {
    const { openAlsCadTekening } = await import('../pdf/cad-import.js');
    await openAlsCadTekening(pad);
    return;
  }
  if (!AFBEELDING.test(pad)) return;
  try { await invoke('allow_fs_scope', { path: pad }); } catch {}
  const { readBinaryFile, writeBinaryFile, fileExists } = await import('./platform.js');
  const bytes = new Uint8Array(await readBinaryFile(pad));
  const pdfBytes = await afbeeldingNaarPdf(bytes, pad);
  const basis = pad.replace(/\.[^.\\/]+$/, '');
  let doel = `${basis}.pdf`;
  for (let n = 2; await fileExists(doel); n++) doel = `${basis} (${n}).pdf`;
  try { await invoke('allow_fs_scope', { path: doel }); } catch {}
  await writeBinaryFile(doel, pdfBytes);
  const { createTab } = await import('../ui/chrome/tabs.js');
  const { loadPDFIfNeeded } = await import('../pdf/loader.js');
  const { index } = createTab(doel);
  await loadPDFIfNeeded(doel, index);
}

// Image bytes to a one-page PDF the size of the image at 96 dpi. JPEG and PNG
// are embedded as they are; other formats are drawn to a canvas first.
async function afbeeldingNaarPdf(bytes, pad) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  let beeld;
  if (/\.jpe?g$/i.test(pad)) beeld = await pdf.embedJpg(bytes);
  else if (/\.png$/i.test(pad)) beeld = await pdf.embedPng(bytes);
  else {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    beeld = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
  }
  const w = beeld.width * 0.75, h = beeld.height * 0.75;
  const pagina = pdf.addPage([w, h]);
  pagina.drawImage(beeld, { x: 0, y: 0, width: w, height: h });
  return pdf.save();
}

/** Call once the app is ready to open documents and dialogs. */
export async function startShellActies() {
  if (!isTauri()) return;
  klaar = true;
  try {
    const acties = await invoke('get_shell_action');
    for (const a of acties || []) voegToe(a);
  } catch (e) {
    console.warn('[shell-action] start action unavailable', e);
  }
  if (wachtrij.combine.length || wachtrij.convert.length) planVerwerking();
}

// Listen right away so launches that arrive during start-up are kept.
if (typeof window !== 'undefined' && window.__TAURI__?.event) {
  window.__TAURI__.event.listen('shell-action', (event) => voegToe(event.payload));
}
