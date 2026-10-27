import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {inspectPrint} from './print-preflight.js';
const profile={allowRgb:true,outputIntent:false,allowTransparency:true};
// A chain of 16 nested forms where every form places the next one four
// times: 4^16 placements when every path is walked separately. With
// distinct offsets every path has its own transform.
async function nestedForms({distinct}){
 const pdf=await PDFDocument.create(),p=pdf.addPage([300,300]);p.setTrimBox(0,0,300,300);
 const image=pdf.context.register(pdf.context.stream(new Uint8Array(100),{Type:'XObject',Subtype:'Image',Width:10,Height:10,BitsPerComponent:8,ColorSpace:'DeviceGray'}));
 let child=image,childName='Im';
 for(let level=0;level<16;level++){
  const uses=[0,1,2,3].map(i=>`q 1 0 0 1 ${distinct?i*4**level:0} 0 cm /${childName} Do Q`).join(' ');
  child=pdf.context.register(pdf.context.stream(uses,{Type:'XObject',Subtype:'Form',BBox:[0,0,300,300],Resources:{XObject:{[childName]:child}}}));
  childName='F'+level;
 }
 p.node.Resources().set(PDFName.of('XObject'),pdf.context.obj({[childName]:child}));
 // Scaled so the 10 x 10 image ends up at 7.2 dpi.
 p.node.addContentStream(pdf.context.register(pdf.context.stream(`q 100 0 0 100 0 0 cm /${childName} Do Q`)));
 return pdf.save();
}
test('repeated identical placements of nested forms are inspected once',{timeout:20000},async()=>{
 const started=Date.now();
 const r=await inspectPrint(await nestedForms({distinct:false}),profile);
 assert.ok(Date.now()-started<5000,'finished in '+(Date.now()-started)+' ms');
 assert.equal(r.findings.filter(f=>f.code==='imageDpi').length,1);
});
test('distinct placements stop at the visit budget with a coverage finding',{timeout:20000},async()=>{
 const started=Date.now();
 const r=await inspectPrint(await nestedForms({distinct:true}),profile);
 assert.ok(Date.now()-started<10000,'finished in '+(Date.now()-started)+' ms');
 const coverage=r.findings.filter(f=>f.code==='coverage'&&/budget/i.test(f.observed));
 assert.equal(coverage.length,1,JSON.stringify(r.findings.filter(f=>f.code==='coverage').slice(0,3)));
 assert.ok(r.findings.length<20000);
});
test('the inspection yields to the event loop and can be cancelled while walking forms',{timeout:20000},async()=>{
 const bytes=await nestedForms({distinct:true}),controller=new AbortController();let ticks=0;
 const timer=setInterval(()=>{ticks++;if(ticks===2)controller.abort();},0);
 try{await assert.rejects(inspectPrint(bytes,profile,{signal:controller.signal}),/CANCELLED/);}finally{clearInterval(timer);}
 assert.ok(ticks>=2);
});
