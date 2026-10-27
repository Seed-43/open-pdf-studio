import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {defaultWorkflow,validateWorkflow,processWorkflow,runWorkflow,watchCandidates,completePdf} from './document-workflow.js';
async function fixture(){const pdf=await PDFDocument.create();pdf.addPage([600,800]);return pdf.save({useObjectStreams:false});}
test('three ordered operations produce deterministic copies and preserve input',async()=>{
 const bytes=await fixture(),original=bytes.slice(),w=defaultWorkflow();w.steps[0].angle=90;w.steps[1].left=20;w.steps[2].title='Reviewed';
 const output=await processWorkflow(bytes,w),again=await processWorkflow(bytes,w);assert.deepEqual(bytes,original);assert.deepEqual(output,again);
 const pdf=await PDFDocument.load(output);assert.equal(pdf.getTitle(),'Reviewed');assert.equal(pdf.getPage(0).getRotation().angle,90);assert.equal(pdf.getPage(0).getCropBox().width,580);
 assert.deepEqual(validateWorkflow(JSON.parse(JSON.stringify(w))),w);assert.throws(()=>validateWorkflow({...w,suffix:'../../bad'}));
});
test('restart skips completed content; collision and source changes fail without writes',async()=>{
 const bytes=await fixture(),files=new Map([['source.pdf',bytes]]);let writes=0;
 const io={read:async p=>files.get(p),exists:async p=>files.has(p),destination:n=>'out/'+n,publish:async(p,b)=>{assert(!files.has(p));files.set(p,b);writes++;}};
 let [r]=await runWorkflow(['source.pdf'],defaultWorkflow(),io);assert.equal(r.status,'completed');const output=r.output;
 [r]=await runWorkflow(['source.pdf','source.pdf'],defaultWorkflow(),io);assert.equal(r.status,'skipped');assert.equal(writes,1);
 files.set(output,new Uint8Array([1]));[r]=await runWorkflow(['source.pdf'],defaultWorkflow(),io);assert.equal(r.code,'OUTPUT_COLLISION');assert.equal(writes,1);
 let reads=0;[r]=await runWorkflow(['source.pdf'],defaultWorkflow(),{...io,read:async p=>p==='source.pdf'&&++reads>1?new Uint8Array([1]):bytes});assert.equal(r.code,'INPUT_CHANGED');assert.equal(writes,1);
});
test('cancellation and failed steps never publish; log has no PDF parser contents',async()=>{
 const bytes=await fixture(),c=new AbortController();let writes=0;const w=defaultWorkflow();w.steps[1].left=1000;
 const io={read:async()=>bytes,exists:async()=>false,destination:n=>n,publish:async()=>{writes++;}};
 const [r]=await runWorkflow(['source.pdf'],w,io);assert.equal(r.code,'STEP_FAILED');assert.equal(r.step,1);
 await assert.rejects(processWorkflow(bytes,defaultWorkflow(),{signal:c.signal,onStep:()=>c.abort()}),/CANCELLED/);assert.equal(writes,0);
 const [bad]=await runWorkflow(['broken.pdf'],defaultWorkflow(),{...io,read:async()=>new TextEncoder().encode('%PDF- secret customer data\n%%EOF')});assert.equal(bad.code,'PDF_LOAD_FAILED');assert(!JSON.stringify(bad).includes('secret'));
});
test('watch requires stable complete inputs and ignores generated outputs',async()=>{
 const bytes=await fixture();assert(completePdf(bytes));const paths=['a.pdf','partial.pdf','a-opds-processed-'+ 'a'.repeat(64)+'.pdf'];
 const read=async p=>p==='partial.pdf'?bytes.subarray(0,bytes.length-10):bytes;
 const first=await watchCandidates(paths,read);assert.equal(first.ready.length,0);const second=await watchCandidates(paths,read,first.next);assert.deepEqual(second.ready,['a.pdf']);
 const changed=await fixture();changed[20]^=1;assert.deepEqual((await watchCandidates(['a.pdf'],async()=>changed,second.next)).ready,[]);
});
