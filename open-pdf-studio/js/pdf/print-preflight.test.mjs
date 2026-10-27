import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {inspectPrint,fixPrintTrimBoxes,printProfile} from './print-preflight.js';
async function fixture(bad=false){
 const pdf=await PDFDocument.create();const p=pdf.addPage([300,300]);
 p.setTrimBox(0,0,300,300);
 if(bad){p.drawText('Unembedded standard font');p.node.set(PDFName.of('BleedBox'),pdf.context.obj([-10,0,310,300]));}
 const image=pdf.context.register(pdf.context.stream(new Uint8Array(3*10*10),{Type:'XObject',Subtype:'Image',Width:10,Height:10,BitsPerComponent:8,ColorSpace:'DeviceRGB'}));
 const resources=p.node.Resources();resources.set(PDFName.of('XObject'),pdf.context.obj({Im:image}));
 const size=bad?100:1;
 const content=pdf.context.register(pdf.context.stream('q '+size+' 0 0 '+size+' 0 0 cm /Im Do Q'));
 p.node.addContentStream(content);
 return pdf.save();
}
const profile={allowRgb:true,outputIntent:false,allowTransparency:true};
test('known good placements pass, low resolution and invalid boxes are located',async()=>{
 const good=await inspectPrint(await fixture(),profile);
 assert.equal(good.findings.length,0,JSON.stringify(good.findings));assert.equal(good.conformanceCertified,false);
 const bad=await inspectPrint(await fixture(true),profile);
 for(const code of ['imageDpi','pageBox','fontEmbedding'])assert.ok(bad.findings.some(f=>f.code===code&&f.page===1),code);
 assert.equal(bad.findings.find(f=>f.code==='imageDpi').observed,'7.2 dpi');
});
test('inspection is read-only; supported trim repair makes a copy and rechecks',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([300,300]);const bytes=await pdf.save(),original=bytes.slice();
 assert.ok((await inspectPrint(bytes,profile)).findings.some(f=>f.code==='trimBox'));
 const fixed=await fixPrintTrimBoxes(bytes,profile);assert.deepEqual(bytes,original);
 assert.ok(!fixed.report.findings.some(f=>f.code==='trimBox'));assert.equal(fixed.report.conformanceCertified,false);
 const reopened=await PDFDocument.load(fixed.bytes);assert.equal(reopened.getPageCount(),1);
});
test('profiles validate inputs and cancelled checks stop',async()=>{
 assert.throws(()=>printProfile({minDpi:-1}));
 const controller=new AbortController();controller.abort();
 await assert.rejects(inspectPrint(await fixture(),profile,{signal:controller.signal}),/CANCELLED/);
});
test('rotated nested form placements and user units contribute to effective DPI',async()=>{
 const pdf=await PDFDocument.create(),p=pdf.addPage([300,300]);p.setTrimBox(0,0,300,300);
 p.node.set(PDFName.of('UserUnit'),pdf.context.obj(2));
 const image=pdf.context.register(pdf.context.stream(new Uint8Array(100),{Type:'XObject',Subtype:'Image',Width:10,Height:10,BitsPerComponent:8,ColorSpace:'DeviceGray'}));
 const form=pdf.context.register(pdf.context.stream('/Im Do',{Type:'XObject',Subtype:'Form',BBox:[0,0,1,1],Matrix:[0,2,-2,0,0,0],Resources:{XObject:{Im:image}}}));
 p.node.Resources().set(PDFName.of('XObject'),pdf.context.obj({Fm:form}));
 p.node.addContentStream(pdf.context.register(pdf.context.stream('q 50 0 0 50 20 20 cm /Fm Do Q')));
 const r=await inspectPrint(await pdf.save(),profile);
 const finding=r.findings.find(f=>f.code==='imageDpi');
 assert.equal(finding.observed,'3.6 dpi');assert.match(finding.object,/Fm.*Im/);
 assert.deepEqual(finding.bounds,{minX:-80,minY:20,maxX:20,maxY:120});
});
