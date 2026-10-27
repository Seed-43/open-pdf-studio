import {state,getActiveDocument} from '../core/state.js';
import {savePreferences} from '../core/preferences.js';
import {readBinaryFile,writeBinaryFileAtomic,writeBinaryFileNew,fileExists,isTauri} from '../core/platform.js';
import {getScheduleById,buildResultForSchedule} from '../solid/stores/schedulesStore.js';
import {inspectWorkbook,refreshWorkbook,commitWorkbookRefresh} from './workbook-adapter.js';
import {validateBinding,bindingValues,bindingStatus,configSignature,bindingCsv} from './workbook-bindings.js';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const sourcePathOf=doc=>doc?.saveTargetPath||doc?.filePath;
const list=()=>Array.isArray(state.preferences.spreadsheetBindings)?state.preferences.spreadsheetBindings:[];
function persist(items){state.preferences.spreadsheetBindings=items;savePreferences();}
export async function inspectBindings(){
 const out=[];
 for(const binding of list()){
  const item=JSON.parse(JSON.stringify(binding));item.status=bindingStatus(binding,{document:state.documents.map(d=>({id:d.id,inhoudRevisie:d.inhoudRevisie,filePath:sourcePathOf(d)})).find(d=>d.filePath===binding.sourcePath),schedule:getScheduleById(binding.scheduleId)});
  if(isTauri())try{
   if(!await fileExists(binding.sourcePath))item.status='source-missing';
   else if(!await fileExists(binding.workbookPath))item.status='workbook-missing';
   else if(binding.last){
    if(await hash(new Uint8Array(await readBinaryFile(binding.workbookPath)))!==binding.last.workbookHash)item.status='workbook-changed';
    else if(await hash(new Uint8Array(await readBinaryFile(binding.sourcePath)))!==binding.last.sourceHash)item.status='source-changed';
   }
  }catch{item.status='unavailable';}
  else if(item.status==='current')item.status='unverified';
  out.push(item);
 }
 return out;
}
export function bindWorkbook(request){
 const doc=getActiveDocument(),schedule=getScheduleById(request.scheduleId);if(!doc?.pdfDoc||doc.id!==request.documentId||!doc.filePath)throw new Error('SOURCE_REQUIRED');if(!schedule)throw new Error('SCHEDULE_REQUIRED');
 const binding=validateBinding({version:1,id:request.id||crypto.randomUUID(),name:request.name,sourcePath:sourcePathOf(doc),scheduleId:schedule.id,scheduleName:schedule.name,config:configSignature(schedule),workbookPath:request.workbookPath,sheet:request.sheet,mappings:request.mappings});
 if(list().some(b=>b.id!==binding.id&&b.workbookPath===binding.workbookPath&&b.sheet===binding.sheet&&b.mappings.some(m=>binding.mappings.some(n=>n.cell===m.cell))))throw new Error('DUPLICATE_TARGET');
 bindingValues(binding,buildResultForSchedule(schedule),schedule);persist([...list().filter(b=>b.id!==binding.id),binding]);return binding;
}
async function captureBinding(binding){
 validateBinding(binding);const doc=getActiveDocument(),schedule=getScheduleById(binding.scheduleId);if(!doc?.pdfDoc||sourcePathOf(doc)!==binding.sourcePath)throw new Error('OPEN_SOURCE_DOCUMENT');if(!schedule)throw new Error('SCHEDULE_REQUIRED');
 const pdf=doc.pdfDoc,revision=doc.inhoudRevisie||0;const check=()=>{if(getActiveDocument()!==doc||doc.pdfDoc!==pdf||sourcePathOf(doc)!==binding.sourcePath||(doc.inhoudRevisie||0)!==revision||!getScheduleById(binding.scheduleId)||configSignature(getScheduleById(binding.scheduleId))!==binding.config||getScheduleById(binding.scheduleId).name!==binding.scheduleName)throw new Error('SOURCE_CHANGED');};
 const {ensureAnnotationsForPage,getCachedPdfBytes}=await import('../pdf/loader.js');check();for(let page=1;page<=pdf.numPages;page++){await ensureAnnotationsForPage(page,doc);check();if(doc._annotationPagesReady&&!doc._annotationPagesReady.has(page))throw new Error('ANNOTATIONS_LOADING');}
 const values=bindingValues(binding,buildResultForSchedule(schedule),schedule),sourceHash=await hash(getCachedPdfBytes(binding.sourcePath)||await pdf.getData());check();return {values,check,csv:bindingCsv(binding,values,revision),last:{documentId:doc.id,revision,sourceHash,unsavedSource:!!doc.modified,refreshedAt:new Date().toISOString(),values}};
}
export async function prepareWorkbookBinding(binding,bytes){
 const result=await captureBinding(binding);const workbookHash=await hash(bytes),output=await refreshWorkbook(bytes,result.values);result.check();
 return {...result,bytes:output,workbookHash,last:{...result.last,workbookHash:await hash(output)}};
}
export async function previewBinding(id){const binding=list().find(b=>b.id===id);if(!binding)throw new Error('BINDING_NOT_FOUND');const result=await captureBinding(binding);return {binding:JSON.parse(JSON.stringify(binding)),values:result.values,csv:result.csv,provenance:result.last};}
export async function refreshBinding(id){
 if(!isTauri())throw new Error('DESKTOP_REFRESH_REQUIRED');const binding=list().find(b=>b.id===id);if(!binding)throw new Error('BINDING_NOT_FOUND');if(!/\.xlsx$/i.test(binding.workbookPath))throw new Error('XLSX_REQUIRED');
 if(!await fileExists(binding.sourcePath))throw new Error('SOURCE_FILE_MISSING');const bytes=new Uint8Array(await readBinaryFile(binding.workbookPath)),result=await prepareWorkbookBinding(binding,bytes);
 if(await hash(new Uint8Array(await readBinaryFile(binding.sourcePath)))!==result.last.sourceHash)throw new Error('SOURCE_FILE_CHANGED');
 if(await hash(new Uint8Array(await readBinaryFile(binding.workbookPath)))!==result.workbookHash)throw new Error('WORKBOOK_CHANGED');result.check();if(!list().some(b=>b.id===binding.id&&JSON.stringify(b)===JSON.stringify(binding)))throw new Error('BINDING_CHANGED');
 // The previous workbook goes to a new backup file before it is replaced.
 const {backupPath}=await commitWorkbookRefresh(binding.workbookPath,bytes,result.bytes,{writeNew:writeBinaryFileNew,writeAtomic:writeBinaryFileAtomic});
 const last={...result.last,backupPath};persist(list().map(b=>b.id===id?{...b,last}:b));return {id,path:binding.workbookPath,backupPath,values:result.values,last};
}
export async function workbookBindingRequest(request){
 if(request.action==='list')return {bindings:await inspectBindings()};
 if(request.action==='bind')return {binding:bindWorkbook(request)};
 if(request.action==='remove'){if(!list().some(b=>b.id===request.id))throw new Error('BINDING_NOT_FOUND');persist(list().filter(b=>b.id!==request.id));return {removed:request.id};}
 if(request.action==='preview')return previewBinding(request.id);
 if(request.action==='refresh')return refreshBinding(request.id);
 if(request.action==='inspectWorkbook'){return {sheets:await inspectWorkbook(new Uint8Array(await readBinaryFile(request.path)))};}
 if(request.action==='export'){const binding=list().find(b=>b.id===request.id);if(!binding)throw new Error('BINDING_NOT_FOUND');return {binding:JSON.parse(JSON.stringify(binding)),csv:binding.last?bindingCsv(binding,binding.last.values,binding.last.revision):null};}
 throw new Error('INVALID_ACTION');
}
