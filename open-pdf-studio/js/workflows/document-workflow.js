import {PDFDocument,degrees,PDFName} from 'pdf-lib';
export const hashBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const fail=code=>{throw new Error(code);};
export function validateWorkflow(input){
 if(input?.version!==1||typeof input.name!=='string'||!input.name.trim()||input.name.length>100)fail('INVALID_WORKFLOW');
 if(typeof input.suffix!=='string'||! /^[a-zA-Z0-9_-]{1,32}$/.test(input.suffix))fail('INVALID_SUFFIX');
 if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>30)fail('INVALID_STEPS');
 const steps=input.steps.map(step=>{
  if(step?.type==='rotate'&&[0,90,180,270].includes(step.angle))return {type:'rotate',angle:step.angle};
  if(step?.type==='cropMargins'&&['left','right','top','bottom'].every(k=>Number.isFinite(step[k])&&step[k]>=0&&step[k]<=1000))return {type:'cropMargins',left:step.left,right:step.right,top:step.top,bottom:step.bottom};
  if(step?.type==='metadata'&&['title','author','subject'].every(k=>typeof step[k]==='string'&&step[k].length<=500))return {type:'metadata',title:step.title,author:step.author,subject:step.subject};
  fail('INVALID_STEP');
 });return {version:1,name:input.name.trim(),suffix:input.suffix,steps};
}
export const defaultWorkflow=()=>({version:1,name:'Document workflow',suffix:'processed',steps:[{type:'rotate',angle:0},{type:'cropMargins',left:0,right:0,top:0,bottom:0},{type:'metadata',title:'',author:'',subject:''}]});
export function completePdf(bytes){return bytes.length>8&&new TextDecoder('latin1').decode(bytes.subarray(0,1024)).includes('%PDF-')&&/%%EOF\s*$/.test(new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-2048))));}
export async function processWorkflow(bytes,input,{signal,onStep=()=>{}}={}){
 const workflow=validateWorkflow(input);const check=()=>{if(signal?.aborted)fail('CANCELLED');};check();
 if(bytes.length>100*1024*1024)fail('FILE_TOO_LARGE');if(!completePdf(bytes))fail('INCOMPLETE_PDF');
 let pdf;try{pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch{fail('PDF_LOAD_FAILED');}
 if(pdf.catalog.has(PDFName.of('Perms')))fail('SIGNED_PDF_UNSUPPORTED');
 for(let index=0;index<workflow.steps.length;index++){
  check();onStep(index);await new Promise(resolve=>setTimeout(resolve,0));check();const step=workflow.steps[index];
  try{
   if(step.type==='rotate')for(const page of pdf.getPages())page.setRotation(degrees((page.getRotation().angle+step.angle)%360));
   if(step.type==='cropMargins')for(const page of pdf.getPages()){
    const box=page.getCropBox(),width=box.width-step.left-step.right,height=box.height-step.top-step.bottom;
    if(width<=0||height<=0)fail('CROP_EMPTY');page.setCropBox(box.x+step.left,box.y+step.bottom,width,height);
   }
   if(step.type==='metadata'){pdf.setTitle(step.title);pdf.setAuthor(step.author);pdf.setSubject(step.subject);}
  }catch{throw Object.assign(new Error('STEP_FAILED'),{step:index});}
 }
 check();const result=await pdf.save({useObjectStreams:false});check();return result;
}
export async function runWorkflow(inputs,workflow,io,{signal,onResult=()=>{}}={}){
 workflow=validateWorkflow(workflow);const results=[];const seen=new Set();
 for(const path of inputs){
  if(signal?.aborted)break;if(seen.has(path))continue;seen.add(path);let step=null;
  const result={path,status:'failed',step:null};
  try{
   const bytes=await io.read(path);const sourceHash=await hashBytes(bytes);
   const key=await hashBytes(new TextEncoder().encode(JSON.stringify(workflow)+sourceHash));
   const base=path.split(/[\\/]/).pop().replace(/\.pdf$/i,'').replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80);
   const name=`${base}-opds-${workflow.suffix}-${key}.pdf`;result.output=io.destination(name);
   if(result.output===path)fail('INPUT_OUTPUT_SAME');
   const output=await processWorkflow(bytes,workflow,{signal,onStep:index=>{step=index;}});const outputHash=await hashBytes(output);
   if(signal?.aborted)fail('CANCELLED');
   if(await hashBytes(await io.read(path))!==sourceHash)fail('INPUT_CHANGED');
   if(await io.exists(result.output)){
    if(await hashBytes(await io.read(result.output))!==outputHash)fail('OUTPUT_COLLISION');result.status='skipped';
   }else{await io.publish(result.output,output);result.status='completed';}
   result.key=key;result.outputHash=outputHash;
  }catch(error){result.status=error.message==='CANCELLED'?'cancelled':'failed';result.code=['CANCELLED','INCOMPLETE_PDF','FILE_TOO_LARGE','PDF_LOAD_FAILED','SIGNED_PDF_UNSUPPORTED','INPUT_CHANGED','INPUT_OUTPUT_SAME','OUTPUT_COLLISION','STEP_FAILED'].includes(error.message)?error.message:'IO_FAILED';result.step=error.step??step;}
  results.push(result);onResult(result);if(result.status==='cancelled')break;
 }
 return results;
}
const LIMIT=100*1024*1024;
const generated=path=>/-opds-[a-zA-Z0-9_-]+-[a-f0-9]{64}\.pdf$/i.test(path);
// Require two stable observations. Changing files and outputs never enter a run.
// With size and modification time ({path,size,mtimeMs}) a file is read and
// hashed only once its size and time stay the same between two polls, and
// not again until they change. Plain paths are read and hashed every poll.
// Returns next: Map(path -> {hash,size,mtimeMs}) for the next poll.
export async function watchCandidates(files,read,previous=new Map()){
 const next=new Map(),ready=[];
 for(const file of files.slice(0,1000)){
  const entry=typeof file==='string'?{path:file}:file||{},path=entry.path;
  if(typeof path!=='string'||!/\.pdf$/i.test(path)||generated(path))continue;
  const prev=previous.get(path),stat=Number.isFinite(entry.size)&&Number.isFinite(entry.mtimeMs);
  try{
   if(stat){
    const seen={size:entry.size,mtimeMs:entry.mtimeMs,hash:null};
    if(entry.size>LIMIT||!prev||prev.size!==entry.size||prev.mtimeMs!==entry.mtimeMs){next.set(path,seen);continue;}
    if(prev.hash){next.set(path,prev);ready.push(path);continue;}
    if(prev.incomplete){next.set(path,prev);continue;}
    next.set(path,seen);
    const bytes=await read(path);
    if(bytes.length>LIMIT||!completePdf(bytes)){next.set(path,{...seen,incomplete:true});continue;}
    next.set(path,{...seen,hash:await hashBytes(bytes)});ready.push(path);
   }else{
    const bytes=await read(path);if(bytes.length>LIMIT||!completePdf(bytes))continue;
    const hash=await hashBytes(bytes);next.set(path,{hash});if(prev?.hash===hash)ready.push(path);
   }
  }catch{/* A copying or locked file is checked again next poll. */}
 }return {next,ready};
}
