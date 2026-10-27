export const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=object=>digest(new TextEncoder().encode(JSON.stringify(object)));
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=code=>{throw new Error(code);};
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validateConfiguration(config){
 if(!config||!text(config.title,200)||!config.title.trim()||!['sequential','parallel'].includes(config.mode)||!text(config.source?.name,500)||! /^[a-f0-9]{64}$/.test(config.source?.hash)||!Number.isInteger(config.source?.pages)||config.source.pages<1||!text(config.source?.revision,100))fail('INVALID_REQUEST');
 if(config.expiresAt!==null&&!date(config.expiresAt))fail('INVALID_EXPIRY');if(!Array.isArray(config.recipients)||!config.recipients.length||config.recipients.length>50)fail('INVALID_RECIPIENTS');
 const ids=new Set(),emails=new Set();const recipients=config.recipients.map(r=>{if(!text(r.id,100)||!r.id||ids.has(r.id)||!text(r.name,200)||!r.name.trim()||!text(r.email,254)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)||emails.has(r.email.toLowerCase()))fail('INVALID_RECIPIENT');ids.add(r.id);emails.add(r.email.toLowerCase());return {id:r.id,name:r.name.trim(),email:r.email};});
 if(!Array.isArray(config.fields)||config.fields.length>500)fail('INVALID_FIELDS');const fieldIds=new Set();const fields=config.fields.map(f=>{if(!text(f.id,100)||!f.id||fieldIds.has(f.id)||!ids.has(f.recipientId)||!Number.isInteger(f.page)||f.page<1||f.page>config.source.pages||!text(f.label,200)||!f.label.trim()||![f.x,f.y,f.width,f.height].every(Number.isFinite)||f.x<0||f.y<0||f.width<=0||f.height<=0)fail('INVALID_FIELD');fieldIds.add(f.id);return {id:f.id,recipientId:f.recipientId,page:f.page,x:f.x,y:f.y,width:f.width,height:f.height,label:f.label};});
 return {title:config.title.trim(),mode:config.mode,expiresAt:config.expiresAt,source:{name:config.source.name,hash:config.source.hash,pages:config.source.pages,revision:config.source.revision},recipients,fields};
}
const header=record=>({version:1,adapter:'local-file-v1',id:record.id,createdAt:record.createdAt,config:record.config});
export async function createRequest(config,now=new Date().toISOString()){
 config=validateConfiguration(config);if(!date(now)||config.expiresAt&&Date.parse(config.expiresAt)<=Date.parse(now))fail('INVALID_EXPIRY');const record={...header({id:crypto.randomUUID(),createdAt:now,config}),events:[]};record.root=await hash(header(record));return record;
}
function receiptCheck(record,receipt){
 if(receipt?.version!==1||!text(receipt.id,100)||!receipt.id||receipt.requestId!==record.id||receipt.documentHash!==record.config.source.hash||!record.config.recipients.some(r=>r.id===receipt.recipientId)||!['approved','rejected'].includes(receipt.decision)||!date(receipt.at)||!text(receipt.comment,2000))fail('INVALID_RECEIPT');
}
function applyEvent(record,state,event){
 const terminal=['completed','rejected','expired','cancelled','superseded'];const expired=record.config.expiresAt&&Date.parse(event.at)>=Date.parse(record.config.expiresAt);
 if(event.kind==='submit'){if(state.status!=='draft'||expired)fail('INVALID_TRANSITION');state.status='submitted';}
 else if(event.kind==='receipt'){
  const receipt=event.payload.receipt;receiptCheck(record,receipt);if(!['submitted','in_progress'].includes(state.status)||expired)fail('REQUEST_CLOSED');if(state.receipts.some(r=>r.id===receipt.id||r.recipientId===receipt.recipientId))fail('DUPLICATE_RECEIPT');
  const next=record.config.recipients.find(r=>!state.receipts.some(x=>x.recipientId===r.id));if(record.config.mode==='sequential'&&next.id!==receipt.recipientId)fail('WAITING_FOR_PREVIOUS_RECIPIENT');state.receipts.push(copy(receipt));
  state.status=receipt.decision==='rejected'?'rejected':state.receipts.length===record.config.recipients.length?'completed':'in_progress';
 }else if(event.kind==='cancel'){if(terminal.includes(state.status)||expired)fail('REQUEST_CLOSED');state.status='cancelled';}
 else if(event.kind==='supersede'){if(state.status==='superseded'||!text(event.payload.replacementId,100)||!event.payload.replacementId||event.payload.replacementId===record.id)fail('INVALID_REPLACEMENT');state.status='superseded';state.replacementId=event.payload.replacementId;}
 else if(event.kind==='expire'){if(terminal.includes(state.status)||!expired)fail('INVALID_EXPIRY');state.status='expired';}
 else fail('INVALID_EVENT');
}
export async function verifyRequest(input,now=new Date().toISOString()){
 if(input?.version!==1||input.adapter!=='local-file-v1'||!text(input.id,100)||!input.id||!date(input.createdAt)||!Array.isArray(input.events)||input.events.length>200)fail('INVALID_AUDIT');
 const record=copy(input),config=validateConfiguration(record.config);if(JSON.stringify(config)!==JSON.stringify(record.config))fail('INVALID_CONFIGURATION');const root=await hash(header(record));if(root!==record.root)fail('AUDIT_ROOT_MISMATCH');
 let previous=root,lastAt=Date.parse(record.createdAt);const state={status:'draft',receipts:[]};
 for(let seq=0;seq<record.events.length;seq++){
  const event=record.events[seq];if(event.seq!==seq||event.previous!==previous||!date(event.at)||Date.parse(event.at)<lastAt||!text(event.actor,300)||typeof event.payload!=='object'||event.payload===null)fail('INVALID_AUDIT_EVENT');
  const body={seq:event.seq,at:event.at,kind:event.kind,actor:event.actor,payload:event.payload,previous:event.previous};if(await hash(body)!==event.hash)fail('AUDIT_HASH_MISMATCH');applyEvent(record,state,event);previous=event.hash;lastAt=Date.parse(event.at);
 }
 if(['draft','submitted','in_progress'].includes(state.status)&&record.config.expiresAt&&Date.parse(now)>=Date.parse(record.config.expiresAt))state.status='expired';
 return {...state,root,head:previous,integrity:true,identityVerified:false,delivery:'manual-file-handoff'};
}
export async function appendEvent(input,kind,payload={},actor='Local operator',now=new Date().toISOString()){
 const state=await verifyRequest(input,now),record=copy(input);if(state.status==='expired'&&kind!=='expire'&&kind!=='supersede')fail('REQUEST_EXPIRED');
 const event={seq:record.events.length,at:now,kind,actor,payload:copy(payload),previous:state.head};event.hash=await hash(event);record.events.push(event);await verifyRequest(record,now);return record;
}
export async function recordReceipt(input,receipt,now=new Date().toISOString(),actor='Local operator (reported receipt)'){
 receiptCheck(input,receipt);await verifyRequest(input,now);const existing=input.events.find(e=>e.kind==='receipt'&&e.payload.receipt.id===receipt.id);if(existing){if(JSON.stringify(existing.payload.receipt)!==JSON.stringify(receipt))fail('RECEIPT_ID_CONFLICT');return copy(input);}
 return appendEvent(input,'receipt',{receipt},actor,now);
}
export async function makeReceipt(record,bytes,recipientId,decision,comment='',now=new Date().toISOString()){
 const state=await verifyRequest(record,now);if(!['submitted','in_progress'].includes(state.status))fail('REQUEST_CLOSED');if(await digest(bytes)!==record.config.source.hash)fail('DOCUMENT_HASH_MISMATCH');
 const receipt={version:1,id:crypto.randomUUID(),requestId:record.id,documentHash:record.config.source.hash,recipientId,decision,at:now,comment};receiptCheck(record,receipt);
 // Validate route eligibility, but do not mutate the sender's request.
 await recordReceipt(record,receipt,now);return receipt;
}
