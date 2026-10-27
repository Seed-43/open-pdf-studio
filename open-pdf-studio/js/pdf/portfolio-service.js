import { PDFDocument } from 'pdf-lib';
import { getActiveDocument } from '../core/state.js';
import { readBinaryFile, writeBinaryFileNew, writeDownloadedFileNew, isTauri } from '../core/platform.js';
import { inspectPortfolio, changePortfolio, extractComponent } from './portfolio.js';
import { exportPathProblem, inputPathProblem } from './export-path-policy.js';
export async function openPortfolioSession(documentId) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.id !== documentId) throw new Error('DOCUMENT_CHANGED');
  if (doc.modified) throw new Error('SAVE_CHANGES_FIRST');
  const original = doc.pdfDoc, revision = doc.inhoudRevisie || 0;
  const check = () => { if (getActiveDocument() !== doc || doc.pdfDoc !== original || doc.modified || (doc.inhoudRevisie || 0) !== revision) throw new Error('DOCUMENT_CHANGED'); };
  let bytes = (await original.getData()).slice(); check();
  let pdf = await PDFDocument.load(bytes.slice()); check();
  return {
    check,
    inspect: () => { check(); return inspectPortfolio(pdf); },
    extract: key => { check(); return extractComponent(pdf,key); },
    bytes: () => { check(); return bytes.slice(); },
    async change(changes) { check(); const result = await changePortfolio(bytes,changes); check(); const next = await PDFDocument.load(result.bytes.slice()); check(); pdf=next; bytes=result.bytes; return result.portfolio; },
  };
}
export async function writePortfolioCopy(session,path) {
  if (!isTauri()) throw new Error('DESKTOP_EXPORT_REQUIRED');
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.pdf')) throw new Error('PDF_PATH_REQUIRED');
  const bytes=session.bytes();
  // Refuses an existing file, also when one appears after the dialog.
  await writeBinaryFileNew(path,bytes);
  return {path,portfolio:session.inspect()};
}
export async function portfolioRequest(request) {
  const session=await openPortfolioSession(request.documentId);
  if (request.action === 'inspect') return {documentId:request.documentId,portfolio:session.inspect()};
  if (request.action === 'exportComponent') {
    if (!isTauri()) throw new Error('DESKTOP_EXPORT_REQUIRED');
    // Automation clients choose both the bytes (via the collection) and the
    // path: only document and data types, never autostart folders.
    const problem = exportPathProblem(request.outputPath);
    if (problem) throw new Error(problem);
    await writeDownloadedFileNew(request.outputPath,session.extract(request.key),{restrict:true});
    return {path:request.outputPath};
  }
  if (request.action !== 'saveCopy') throw new Error('INVALID_ACTION');
  const add=[];
  // Added files are read from explicit absolute local paths of document or
  // data types; the tool is marked as modifying, so every call is confirmed.
  for (const file of request.add || []) {
    const problem = inputPathProblem(file?.path);
    if (problem) throw new Error(problem);
    const bytes=await readBinaryFile(file.path); session.check(); add.push({...file,bytes:new Uint8Array(bytes)});
  }
  await session.change({folders:request.folders,add,remove:request.remove,descriptions:request.descriptions});
  return writePortfolioCopy(session,request.outputPath);
}
