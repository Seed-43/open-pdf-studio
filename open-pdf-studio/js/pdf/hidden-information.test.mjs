import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString,decodePDFRawStream,PDFRawStream,PDFArray} from 'pdf-lib';
import {inspectHiddenInformation,removeHiddenInformation} from './hidden-information.js';
async function fixture(){
 const pdf=await PDFDocument.create();const page=pdf.addPage();
 pdf.setAuthor('SECRET_AUTHOR');
 page.drawText('PUBLIC_VISIBLE_TEXT');
 pdf.getForm().createTextField('publicField').addToPage(page,{x:100,y:100,width:80,height:20});
 const metadata=pdf.context.register(pdf.context.stream('SECRET_XMP',{Type:'Metadata',Subtype:'XML'}));
 pdf.catalog.set(PDFName.of('Metadata'),metadata);
 const js=pdf.context.register(pdf.context.obj({S:'JavaScript',JS:PDFString.of('SECRET_SCRIPT')}));
 pdf.catalog.set(PDFName.of('OpenAction'),js);
 const note=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[10,10,30,30],Contents:PDFString.of('SECRET_COMMENT')}));
 pdf.context.lookup(page.node.get(PDFName.of('Annots'))).push(note);
 await pdf.attach(new TextEncoder().encode('SECRET_ATTACHMENT'),'private.txt');
 pdf.context.register(pdf.context.stream('SECRET_ORPHAN'));
 const layer=pdf.context.register(pdf.context.obj({Type:'OCG',Name:PDFString.of('Hidden')}));
 pdf.catalog.set(PDFName.of('OCProperties'),pdf.context.obj({OCGs:[layer],D:{OFF:[layer]}}));
 return pdf.save({useObjectStreams:false});
}
test('inventory distinguishes supported categories from unsupported optional content',async()=>{
 const report=await inspectHiddenInformation(await fixture());
 for(const c of ['metadata','comments','actions','attachments','hiddenContent'])assert.ok(report.findings.some(f=>f.category===c),c);
 assert.ok(report.findings.filter(f=>f.category==='hiddenContent').every(f=>!f.removable));
 assert.ok(report.unreachableObjects>0);
});
test('rewritten output removes selected objects and unreachable prior data; original stays unchanged',async()=>{
 const source=await fixture();const copy=source.slice();
 const {bytes,report}=await removeHiddenInformation(source,['metadata','comments','actions','attachments']);
 assert.deepEqual(source,copy);assert.equal(report.verified,true);
 assert.equal(report.after.unreachableObjects,0);
 for(const token of ['SECRET_AUTHOR','SECRET_XMP','SECRET_SCRIPT','SECRET_COMMENT','SECRET_ATTACHMENT','SECRET_ORPHAN'])
   assert.equal(new TextDecoder().decode(bytes).includes(token),false,token);
 assert.ok(report.after.findings.some(f=>f.category==='hiddenContent'));
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});assert.equal(pdf.getPageCount(),1);
 assert.ok(pdf.getForm().getTextField('publicField'));
 const kept=pdf.context.lookup(pdf.getPage(0).node.get(PDFName.of('Annots')));
 assert.equal(kept.size(),1);
 assert.equal(pdf.context.lookup(kept.get(0)).get(PDFName.of('Subtype')).decodeText(),'Widget');
 const original=await PDFDocument.load(source,{updateMetadata:false});
 const contents=p=>{
   const value=p.context.lookup(p.getPage(0).node.get(PDFName.of('Contents')));
   const streams=value instanceof PDFArray?value.asArray().map(v=>p.context.lookup(v)):[value];
   return streams.filter(v=>v instanceof PDFRawStream).map(v=>Array.from(decodePDFRawStream(v).decode()));
 };
 assert.deepEqual(contents(pdf),contents(original),'visible page content streams unchanged');
});
test('selective removal retains nonselected categories',async()=>{
 const {report}=await removeHiddenInformation(await fixture(),['metadata']);
 assert.ok(!report.after.findings.some(f=>f.category==='metadata'));
 for(const c of ['comments','attachments','actions'])assert.ok(report.after.findings.some(f=>f.category===c));
});
test('reject unsupported removal instead of implying hidden content was cleaned',async()=>{
 await assert.rejects(removeHiddenInformation(await fixture(),['hiddenContent']),/INVALID_REMOVAL/);
});
