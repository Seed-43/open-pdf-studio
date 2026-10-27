import {getActiveDocument} from '../core/state.js';
import {fileExists,writeBinaryFileNew,isTauri} from '../core/platform.js';
import {inspectPrint,fixPrintTrimBoxes} from './print-preflight.js';
async function source(documentId){
 const doc=getActiveDocument();if(!doc?.pdfDoc||doc.id!==documentId)throw new Error('DOCUMENT_CHANGED');
 if(doc.modified)throw new Error('SAVE_CHANGES_FIRST');
 const pdf=doc.pdfDoc,revision=doc.inhoudRevisie||0;
 const check=()=>{if(getActiveDocument()!==doc||doc.pdfDoc!==pdf||doc.modified||(doc.inhoudRevisie||0)!==revision)throw new Error('DOCUMENT_CHANGED');};
 const bytes=await pdf.getData();check();return {bytes,check};
}
export async function preflightCurrent(documentId,profile,options){
 const s=await source(documentId),report=await inspectPrint(s.bytes,profile,options);s.check();return {documentId,report};
}
export async function prepareTrimCopy(documentId,profile){
 const s=await source(documentId),result=await fixPrintTrimBoxes(s.bytes,profile);s.check();return {...result,documentId,check:s.check};
}
export async function exportTrimCopy(documentId,profile,path){
 if(!isTauri())throw new Error('DESKTOP_EXPORT_REQUIRED');
 if(typeof path!=='string'||!path.toLowerCase().endsWith('.pdf'))throw new Error('PDF_PATH_REQUIRED');
 const reportPath=path+'.report.json';
 // Fail early; the writes themselves refuse a file that appeared in the meantime.
 if(await fileExists(path)||await fileExists(reportPath))throw new Error('CHOOSE_NEW_FILE');
 const result=await prepareTrimCopy(documentId,profile);
 result.check();
 // The PDF first: a failed PDF leaves no report behind.
 await writeBinaryFileNew(path,result.bytes);
 await writeBinaryFileNew(reportPath,new TextEncoder().encode(JSON.stringify(result.report,null,2)));
 return {documentId,path,reportPath,report:result.report};
}
