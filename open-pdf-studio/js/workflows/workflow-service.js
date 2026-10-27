import {state} from '../core/state.js';
import {savePreferences} from '../core/preferences.js';
import {isTauri,readBinaryFile,writeBinaryFileNew,fileExists,listPdfFileStats} from '../core/platform.js';
import {validateWorkflow,runWorkflow,watchCandidates} from './document-workflow.js';
import {setWatchState} from './watch-status.js';
let controller=null,timer=null,watch=null,polling=false;
const read=async path=>new Uint8Array(await readBinaryFile(path));
const preferences=()=>state.preferences.documentWorkflows||{saved:[],results:[]};
function persist(value){state.preferences.documentWorkflows=value;savePreferences();}
export function workflowStatus(){return {...JSON.parse(JSON.stringify(preferences())),running:!!controller,watch:watch?{input:watch.input,output:watch.output,error:watch.error}:null};}
function remember(result){persist({...preferences(),results:[...preferences().results,{...result,at:new Date().toISOString()}].slice(-500)});}
export async function executeWorkflow(paths,workflow,output){
 if(!isTauri())throw new Error('DESKTOP_REQUIRED');if(controller)throw new Error('WORKFLOW_BUSY');
 if(!Array.isArray(paths)||!paths.length||paths.length>1000||paths.some(p=>typeof p!=='string'||!p.toLowerCase().endsWith('.pdf')))throw new Error('INPUT_REQUIRED');
 if(typeof output!=='string'||!output.trim())throw new Error('OUTPUT_REQUIRED');workflow=validateWorkflow(workflow);
 controller=new AbortController();try{return await runWorkflow(paths,workflow,{read,exists:fileExists,publish:writeBinaryFileNew,destination:name=>output.replace(/[\\/]+$/,'')+'/'+name},{signal:controller.signal,onResult:remember});}finally{controller=null;}
}
export function stopWorkflow(){if(timer)clearInterval(timer);timer=null;watch=null;setWatchState(null);controller?.abort();return workflowStatus();}
export async function startWorkflowWatch(input,output,workflow){
 if(!isTauri())throw new Error('DESKTOP_REQUIRED');if(controller||watch)throw new Error('WORKFLOW_BUSY');
 if(typeof input!=='string'||!input||typeof output!=='string'||!output||input.replace(/[\\/]+$/,'').toLowerCase()===output.replace(/[\\/]+$/,'').toLowerCase())throw new Error('SEPARATE_FOLDERS_REQUIRED');
 workflow=validateWorkflow(workflow);const session={input,output,workflow,previous:new Map(),completed:new Map(),error:null};watch=session;setWatchState(session);
 const poll=async()=>{
  if(polling||controller||watch!==session)return;polling=true;
  // Size and modification time first: only new or changed files are read and hashed.
  try{const {next,ready}=await watchCandidates(await listPdfFileStats(input),read,session.previous);session.previous=next;
   if(watch!==session)return;
   const pending=ready.filter(path=>session.completed.get(path)!==next.get(path).hash);
   if(pending.length){const results=await executeWorkflow(pending,workflow,output);for(const r of results)if(r.status==='completed'||r.status==='skipped')session.completed.set(r.path,next.get(r.path).hash);}
   session.error=null;
  }catch{session.error='WATCH_FAILED';}finally{polling=false;if(watch===session)setWatchState(session);}
 };
 timer=setInterval(poll,5000);await poll();return workflowStatus();
}
export async function workflowRequest(request){
 if(request.action==='list')return workflowStatus();
 if(request.action==='save'){const workflow=validateWorkflow(request.workflow);persist({...preferences(),saved:[...preferences().saved.filter(w=>w.name!==workflow.name),workflow].slice(-100)});return {workflow};}
 if(request.action==='remove'){persist({...preferences(),saved:preferences().saved.filter(w=>w.name!==request.name)});return workflowStatus();}
 if(request.action==='run')return {results:await executeWorkflow(request.paths,request.workflow,request.output)};
 if(request.action==='watch')return startWorkflowWatch(request.input,request.output,request.workflow);
 if(request.action==='stop')return stopWorkflow();
 throw new Error('INVALID_ACTION');
}
