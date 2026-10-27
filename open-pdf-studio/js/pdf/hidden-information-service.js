import {getActiveDocument} from '../core/state.js';
import {fileExists,writeBinaryFileNew,isTauri} from '../core/platform.js';
import {inspectHiddenInformation,removeHiddenInformation} from './hidden-information.js';
async function source(documentId){
 const doc=getActiveDocument();
 if(!doc?.pdfDoc || doc.id!==documentId)throw new Error('DOCUMENT_CHANGED');
 if(doc.modified)throw new Error('SAVE_CHANGES_FIRST');
 const pdf=doc.pdfDoc;const revision=doc.inhoudRevisie||0;
 const check=()=>{if(getActiveDocument()!==doc||doc.pdfDoc!==pdf||doc.modified||(doc.inhoudRevisie||0)!==revision)throw new Error('DOCUMENT_CHANGED');};
 const bytes=await pdf.getData();check();
 return {doc,bytes,check};
}
export async function inspectCurrentHiddenInformation(documentId){
 const s=await source(documentId);
 const report=await inspectHiddenInformation(s.bytes);s.check();
 return {documentId,report};
}
export async function prepareHiddenCopy(documentId,categories){
 const s=await source(documentId);
 const result=await removeHiddenInformation(s.bytes,categories);s.check();
 return {...result,documentId,sourceName:s.doc.fileName,check:s.check};
}
export async function exportHiddenCopy(documentId,categories,path){
 if(!isTauri())throw new Error('DESKTOP_EXPORT_REQUIRED');
 if(typeof path!=='string'||!path.toLowerCase().endsWith('.pdf'))throw new Error('PDF_PATH_REQUIRED');
 const reportPath=path+'.report.json';
 // Never replace existing files, including aliases to the source: fail early,
 // and the writes themselves refuse a file that appeared in the meantime.
 if(await fileExists(path)||await fileExists(reportPath))throw new Error('CHOOSE_NEW_FILE');
 const result=await prepareHiddenCopy(documentId,categories);
 result.check();
 // The PDF first: a failed PDF leaves no report behind.
 await writeBinaryFileNew(path,result.bytes);
 await writeBinaryFileNew(reportPath,new TextEncoder().encode(JSON.stringify(result.report,null,2)));
 return {documentId,path,reportPath,report:result.report};
}
