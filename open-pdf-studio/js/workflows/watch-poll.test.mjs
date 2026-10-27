import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {watchCandidates} from './document-workflow.js';
import {watchState,setWatchState,onWatchState} from './watch-status.js';
async function fixture(){const pdf=await PDFDocument.create();pdf.addPage([600,800]);return pdf.save({useObjectStreams:false});}
test('unchanged size and modification time are not read again',async()=>{
 const bytes=await fixture();let reads=0;const read=async()=>{reads++;return bytes;};
 const files=[{path:'a.pdf',size:bytes.length,mtimeMs:1000},{path:'b.pdf',size:bytes.length,mtimeMs:2000}];
 let r=await watchCandidates(files,read);assert.deepEqual(r.ready,[]);assert.equal(reads,0,'first sighting only records the file');
 r=await watchCandidates(files,read,r.next);assert.deepEqual(r.ready,['a.pdf','b.pdf']);assert.equal(reads,2,'hashed once when stable');
 for(let poll=0;poll<5;poll++){r=await watchCandidates(files,read,r.next);assert.deepEqual(r.ready,['a.pdf','b.pdf']);}
 assert.equal(reads,2,'no further reads while nothing changes');
 assert.match(r.next.get('a.pdf').hash,/^[a-f0-9]{64}$/);
});
test('a changed file waits for a stable observation and is hashed once more',async()=>{
 const bytes=await fixture();let reads=0;const read=async()=>{reads++;return bytes;};
 let r=await watchCandidates([{path:'a.pdf',size:10,mtimeMs:1}],read);
 r=await watchCandidates([{path:'a.pdf',size:bytes.length,mtimeMs:2}],read,r.next);assert.deepEqual(r.ready,[]);assert.equal(reads,0,'still being written');
 r=await watchCandidates([{path:'a.pdf',size:bytes.length,mtimeMs:2}],read,r.next);assert.deepEqual(r.ready,['a.pdf']);assert.equal(reads,1);
 r=await watchCandidates([{path:'a.pdf',size:bytes.length,mtimeMs:2}],read,r.next);assert.equal(reads,1);
});
test('incomplete or generated files never become ready',async()=>{
 const bytes=await fixture();const read=async p=>p==='partial.pdf'?bytes.subarray(0,bytes.length-10):bytes;
 const files=[{path:'partial.pdf',size:1,mtimeMs:1},{path:'a-opds-processed-'+'a'.repeat(64)+'.pdf',size:1,mtimeMs:1}];
 let r=await watchCandidates(files,read);r=await watchCandidates(files,read,r.next);r=await watchCandidates(files,read,r.next);
 assert.deepEqual(r.ready,[]);
});
test('the watch indicator follows start and stop, independent of any dialog',()=>{
 const seen=[];const off=onWatchState(s=>seen.push(s&&s.input));
 setWatchState({input:'C:\\in',output:'C:\\out',error:null});assert.equal(watchState().input,'C:\\in');
 setWatchState(null);assert.equal(watchState(),null);off();setWatchState({input:'x'});
 assert.deepEqual(seen,['C:\\in',null]);setWatchState(null);
});
