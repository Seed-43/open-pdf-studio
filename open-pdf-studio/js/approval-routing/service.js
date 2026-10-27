import {state,getActiveDocument} from '../core/state.js';
import {savePreferences} from '../core/preferences.js';
import {isTauri,readBinaryFile,writeBinaryFileNew,fileExists} from '../core/platform.js';
import {documentRevisie} from '../core/undo-manager.js';
import {createRequest,verifyRequest,appendEvent,recordReceipt,makeReceipt,digest} from './model.js';
import {zipStore} from '../bcf/bcf-zip.js';
import {actorFor,checkAutomationRequest} from './origin.js';
const cache=new Map();let pending=Promise.resolve();
const prefs=()=>state.preferences.approvalRouting||{enabled:false,requests:[]};
const persist=value=>{state.preferences.approvalRouting=value;savePreferences();};
const copy=value=>JSON.parse(JSON.stringify(value));
const entry=id=>{const e=prefs().requests.find(e=>e.record.id===id);if(!e)throw new Error('REQUEST_NOT_FOUND');return e;};
const store=record=>{persist({...prefs(),requests:prefs().requests.map(e=>e.record.id===record.id?{...e,record}:e)});return record;};
async function sourceBytes(e){
 const found=cache.get(e.record.id);if(found)return found.slice();
 const {getCachedPdfBytes}=await import('../pdf/loader.js');
 for(const doc of state.documents){if(!doc.pdfDoc)continue;const bytes=getCachedPdfBytes(doc.saveTargetPath||doc.filePath)||await doc.pdfDoc.getData();if(await digest(bytes)===e.record.config.source.hash)return bytes.slice();}
 if(isTauri()&&e.sourcePath){const bytes=new Uint8Array(await readBinaryFile(e.sourcePath));if(await digest(bytes)===e.record.config.source.hash)return bytes;}
 throw new Error('OPEN_EXACT_DOCUMENT_VERSION');
}
export async function approvalState(){const requests=[];for(const e of prefs().requests){try{requests.push({record:copy(e.record),state:await verifyRequest(e.record)});}catch{requests.push({record:{id:e.record?.id,config:{title:'Invalid audit'}},state:{status:'invalid',integrity:false}});}}return {enabled:prefs().enabled,requests};}
async function draft(request){
 if(!prefs().enabled)throw new Error('CONFIGURE_ADAPTER_FIRST');if(prefs().requests.length>=100)throw new Error('REQUEST_LIMIT');const doc=getActiveDocument();if(!doc?.pdfDoc||doc.modified||Object.values(doc.pageRotations||{}).some(Boolean))throw new Error('OPEN_SAVED_SOURCE');const pdf=doc.pdfDoc,revision=documentRevisie(doc),path=doc.saveTargetPath||doc.filePath;
 const {getCachedPdfBytes}=await import('../pdf/loader.js');const bytes=(getCachedPdfBytes(path)||await pdf.getData()).slice();if(bytes.length>50*1024*1024)throw new Error('SIZE_LIMIT');
 const record=await createRequest({title:request.title,mode:request.mode,expiresAt:request.expiresAt??null,recipients:request.recipients,fields:request.fields||[],source:{name:path?.split(/[\\/]/).pop()||'document.pdf',hash:await digest(bytes),pages:pdf.numPages,revision:request.revision||''}});
 for(const f of record.config.fields){const page=await pdf.getPage(f.page),v=page.getViewport({scale:1});if(f.x+f.width>v.width||f.y+f.height>v.height)throw new Error('FIELD_OUTSIDE_PAGE');}
 if(getActiveDocument()!==doc||doc.pdfDoc!==pdf||documentRevisie(doc)!==revision||doc.modified)throw new Error('SOURCE_CHANGED');cache.set(record.id,bytes);while(cache.size>3)cache.delete(cache.keys().next().value);persist({...prefs(),requests:[...prefs().requests,{record,sourcePath:path}]});return record;
}
export async function approvalDocument(id){const e=entry(id);await verifyRequest(e.record);return sourceBytes(e);}
export async function renderApprovalPreview(record,bytes,pageNumber,canvas){
 await verifyRequest(record);if(await digest(bytes)!==record.config.source.hash)throw new Error('DOCUMENT_HASH_MISMATCH');const pdfjs=await import('pdfjs-dist');await import('../pdf/loader.js');const task=pdfjs.getDocument({data:bytes.slice()});
 try{const pdf=await task.promise,page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(1,900/Math.max(base.width,base.height))});canvas.width=viewport.width;canvas.height=viewport.height;const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#ef4444';ctx.lineWidth=2;for(const f of record.config.fields.filter(f=>f.page===pageNumber))ctx.strokeRect(f.x*viewport.scale,f.y*viewport.scale,f.width*viewport.scale,f.height*viewport.scale);ctx.restore();}finally{await task.destroy();}
}
export async function approvalPackage(id){
 const e=entry(id),verified=await verifyRequest(e.record);if(verified.status==='draft')throw new Error('RELEASE_FIRST');const bytes=await sourceBytes(e);return {bytes:zipStore([{name:'document.pdf',data:bytes},{name:'request.json',data:JSON.stringify(e.record,null,2)},{name:'audit-summary.json',data:JSON.stringify(verified,null,2)},{name:'README.txt',data:'Local file approval package. No document has been sent by this application. Hand this package to the next recipient(s) yourself. The PDF is the exact reviewed source, not a digitally signed derivative. Receipt identities are self-reported. The audit hash chain checks internal consistency, not sender identity, delivery or legal validity. Keep request.json and the PDF together. A recipient imports request.json and the PDF into the local approval receipt form; return the receipt JSON to the request owner. For sequential routing, forward an updated package after recording each receipt.'}]),record:copy(e.record),state:verified};
}
async function handle(request,origin){
 checkAutomationRequest(request,origin);const actor=actorFor(origin);
 if(request.action==='list')return approvalState();
 if(request.action==='configure'){if(request.adapter!=='local-file-v1'||request.enabled!==true)throw new Error('EXPLICIT_ADAPTER_REQUIRED');persist({...prefs(),enabled:true});return approvalState();}
 if(request.action==='draft')return {record:await draft(request)};
 if(request.action==='verify')return verifyRequest(request.record);
 if(request.action==='createReceipt'){const doc=getActiveDocument();if(!doc?.pdfDoc||doc.modified)throw new Error('OPEN_SAVED_SOURCE');const {getCachedPdfBytes}=await import('../pdf/loader.js');const bytes=getCachedPdfBytes(doc.saveTargetPath||doc.filePath)||await doc.pdfDoc.getData();return {receipt:await makeReceipt(request.record,bytes,request.recipientId,request.decision,request.comment||'')};}
 if(request.action==='submit'){const e=entry(request.id);if(!prefs().enabled)throw new Error('CONFIGURE_ADAPTER_FIRST');if(request.confirmedHash!==e.record.config.source.hash)throw new Error('CONFIRM_EXACT_VERSION');await sourceBytes(e);const record=store(await appendEvent(e.record,'submit',{},actor));return {record:copy(record),state:await verifyRequest(record)};}
 if(request.action==='receipt'){const e=entry(request.id),record=store(await recordReceipt(e.record,request.receipt,undefined,origin?actor:undefined));return {record:copy(record),state:await verifyRequest(record)};}
 if(request.action==='cancel'){const record=store(await appendEvent(entry(request.id).record,'cancel',{},actor));return {record:copy(record),state:await verifyRequest(record)};}
 if(request.action==='supersede'){entry(request.replacementId);const record=store(await appendEvent(entry(request.id).record,'supersede',{replacementId:request.replacementId},actor));return {record:copy(record),state:await verifyRequest(record)};}
 if(request.action==='export'){if(!isTauri()||typeof request.outputPath!=='string'||!request.outputPath.endsWith('.zip'))throw new Error('DESKTOP_ZIP_PATH_REQUIRED');if(await fileExists(request.outputPath))throw new Error('OUTPUT_EXISTS');const result=await approvalPackage(request.id);await writeBinaryFileNew(request.outputPath,result.bytes);return {path:request.outputPath,state:result.state};}
 throw new Error('INVALID_ACTION');
}
// origin: 'mcp' or 'plugin' for automation clients; the dialog passes none.
export function approvalRequest(request,{origin}={}){const result=pending.then(()=>handle(request,origin));pending=result.catch(()=>{});return result;}
export {makeReceipt,verifyRequest};
