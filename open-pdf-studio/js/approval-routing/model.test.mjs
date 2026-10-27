import test from 'node:test';import assert from 'node:assert/strict';
import {createRequest,appendEvent,verifyRequest,recordReceipt,makeReceipt,digest} from './model.js';
const now='2026-10-21T10:00:00.000Z',later='2026-10-21T11:00:00.000Z';const bytes=new TextEncoder().encode('exact document');
async function draft(mode='sequential',expiresAt=null){return createRequest({title:'Review',mode,expiresAt,source:{name:'document.pdf',hash:await digest(bytes),pages:2,revision:'B'},recipients:[{id:'a',name:'Alice',email:'a@example.org'},{id:'b',name:'Bob',email:'b@example.org'}],fields:[{id:'f',recipientId:'a',page:1,x:20,y:20,width:100,height:40,label:'Review'}]},now);}
test('draft has no release; sequential receipts bind exact document and block wrong order',async()=>{
 let record=await draft();assert.equal((await verifyRequest(record,now)).status,'draft');await assert.rejects(makeReceipt(record,bytes,'a','approved','',later),/REQUEST_CLOSED/);record=await appendEvent(record,'submit',{},'Owner',now);
 await assert.rejects(makeReceipt(record,bytes,'b','approved','',later),/WAITING_FOR_PREVIOUS/);await assert.rejects(makeReceipt(record,new Uint8Array([1]),'a','approved','',later),/DOCUMENT_HASH/);
 const a=await makeReceipt(record,bytes,'a','approved','Looks good',later);record=await recordReceipt(record,a,later);assert.equal((await verifyRequest(record,later)).status,'in_progress');assert.deepEqual(await recordReceipt(record,a,later),record);
 const b=await makeReceipt(record,bytes,'b','approved','',later);record=await recordReceipt(record,b,later);const state=await verifyRequest(record,later);assert.equal(state.status,'completed');assert.equal(state.identityVerified,false);assert.equal(state.receipts.length,2);await assert.rejects(appendEvent(record,'cancel',{},'Owner',later),/REQUEST_CLOSED/);
});
test('parallel approvals, rejection, expiry, cancellation and supersession remain distinct',async()=>{
 let record=await appendEvent(await draft('parallel'),'submit',{},'Owner',now);const receipt=await makeReceipt(record,bytes,'b','rejected','Needs changes',later);record=await recordReceipt(record,receipt,later);assert.equal((await verifyRequest(record,later)).status,'rejected');
 const cancelled=await appendEvent(await draft(),'cancel',{},'Owner',now);assert.equal((await verifyRequest(cancelled,now)).status,'cancelled');
 const expired=await draft('sequential','2026-10-21T10:30:00.000Z');assert.equal((await verifyRequest(expired,later)).status,'expired');await assert.rejects(appendEvent(expired,'submit',{},'Owner',later),/REQUEST_EXPIRED/);
 const superseded=await appendEvent(record,'supersede',{replacementId:'new-version'},'Owner',later);assert.equal((await verifyRequest(superseded,later)).status,'superseded');
});
test('audit detects altered configuration, event payload and broken links',async()=>{
 const record=await appendEvent(await draft(),'submit',{},'Owner',now);let tampered=structuredClone(record);tampered.config.source.hash='f'.repeat(64);await assert.rejects(verifyRequest(tampered,now),/AUDIT_ROOT/);
 tampered=structuredClone(record);tampered.events[0].actor='Other';await assert.rejects(verifyRequest(tampered,now),/AUDIT_HASH/);tampered=structuredClone(record);tampered.events[0].previous='wrong';await assert.rejects(verifyRequest(tampered,now),/INVALID_AUDIT_EVENT/);
 assert.equal((await verifyRequest(JSON.parse(JSON.stringify(record)),now)).integrity,true);
});
