import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString,PDFHexString} from 'pdf-lib';
import {inspectHiddenInformation,removeHiddenInformation} from './hidden-information.js';
import {scanRemovedClasses} from './hidden-information-scan.js';
const N=PDFName.of;
const has=(bytes,token)=>new TextDecoder('latin1').decode(bytes).includes(token);
// XFA with a script and form data, a private OCR review entry, a page
// thumbnail and an annotation that the structure tree references by OBJR.
async function fixture(){
 const pdf=await PDFDocument.create();const page=pdf.addPage([300,300]);
 page.drawText('PUBLIC_VISIBLE_TEXT',{x:20,y:200});
 pdf.getForm().createTextField('publicField').addToPage(page,{x:100,y:100,width:80,height:20});
 const template=pdf.context.register(pdf.context.stream('<template><subform><script>SECRET_XFA_SCRIPT</script></subform></template>'));
 const datasets=pdf.context.register(pdf.context.stream('<xfa:datasets><data>SECRET_XFA_DATA</data></xfa:datasets>'));
 pdf.catalog.lookup(N('AcroForm')).set(N('XFA'),pdf.context.obj([PDFString.of('template'),template,PDFString.of('datasets'),datasets]));
 page.node.set(N('OPS_OCRReview'),PDFHexString.fromText(JSON.stringify({version:1,words:[{originalText:'SECRET_OCR_ORIGINAL'}]})));
 page.node.set(N('Thumb'),pdf.context.register(pdf.context.stream('SECRET_THUMBNAIL',{Width:1,Height:1,BitsPerComponent:8,ColorSpace:'DeviceGray'})));
 const pageRef=page.ref;
 const note=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[10,10,30,30],Contents:PDFString.of('SECRET_TAGGED_COMMENT'),StructParent:0,P:pageRef}));
 pdf.context.lookup(page.node.get(N('Annots'))).push(note);
 const root=pdf.context.register(pdf.context.obj({Type:'StructTreeRoot'}));
 const doc=pdf.context.register(pdf.context.obj({Type:'StructElem',S:'Document',P:root}));
 const annotElem=pdf.context.register(pdf.context.obj({Type:'StructElem',S:'Annot',P:doc,Pg:pageRef,K:[pdf.context.obj({Type:'OBJR',Obj:note,Pg:pageRef})]}));
 pdf.context.lookup(doc).set(N('K'),pdf.context.obj([annotElem]));
 const rootDict=pdf.context.lookup(root);rootDict.set(N('K'),doc);rootDict.set(N('ParentTree'),pdf.context.obj({Nums:[0,annotElem]}));rootDict.set(N('ParentTreeNextKey'),pdf.context.obj(1));
 pdf.catalog.set(N('StructTreeRoot'),root);pdf.catalog.set(N('MarkInfo'),pdf.context.obj({Marked:true}));
 // Saving with field appearance updates would let pdf-lib drop the XFA packets.
 return pdf.save({useObjectStreams:false,updateFieldAppearances:false});
}
test('XFA, private application keys and thumbnails are reported in their categories',async()=>{
 const report=await inspectHiddenInformation(await fixture());
 assert.ok(report.findings.some(f=>f.category==='actions'&&/XFA/.test(f.detail)),'XFA under actions');
 assert.ok(report.findings.some(f=>f.category==='metadata'&&/OPS_OCRReview/.test(f.path+f.detail)),'OPS_ key under metadata');
 assert.ok(report.findings.some(f=>f.category==='metadata'&&/Thumb/.test(f.path)),'Thumb under metadata');
});
test('cleaning a tagged PDF removes XFA, private keys, thumbnails and the OBJR of the deleted comment',async()=>{
 const source=await fixture();
 for(const token of ['SECRET_XFA_SCRIPT','SECRET_XFA_DATA','SECRET_THUMBNAIL','SECRET_TAGGED_COMMENT','OPS_OCRReview'])assert.ok(has(source,token),'fixture has '+token);
 const {bytes,report}=await removeHiddenInformation(source,['metadata','comments','attachments','actions']);
 assert.equal(report.verified,true);
 for(const token of ['SECRET_XFA_SCRIPT','SECRET_XFA_DATA','SECRET_THUMBNAIL','SECRET_TAGGED_COMMENT','SECRET_OCR_ORIGINAL','OPS_OCRReview','/XFA','/Thumb','/OBJR'])
  assert.equal(has(bytes,token),false,token);
 assert.deepEqual(scanRemovedClasses(bytes,['metadata','comments','attachments','actions']),[]);
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 const acro=pdf.catalog.lookup(N('AcroForm'));
 assert.equal(acro.has(N('XFA')),false);assert.equal(String(acro.get(N('NeedAppearances'))),'true');
 assert.ok(pdf.getForm().getTextField('publicField'),'AcroForm field kept');
 assert.ok(pdf.catalog.lookup(N('StructTreeRoot')),'structure tree kept');
});
test('the post-scan reads the written bytes and reports what is still there',async()=>{
 const source=await fixture();
 const hits=scanRemovedClasses(source,['metadata','comments','actions']);
 for(const category of ['metadata','comments','actions'])assert.ok(hits.some(h=>h.category===category),category);
 assert.ok(hits.some(h=>/XFA/.test(h.detail)));assert.ok(hits.some(h=>/OPS_OCRReview/.test(h.detail)));assert.ok(hits.some(h=>/Thumb/.test(h.detail)));
 // Only the selected classes count.
 assert.ok(!scanRemovedClasses(source,['attachments']).some(h=>h.category!=='attachments'));
});
test('the post-scan does not trust the detector: an unreferenced leftover fails the check',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();
 pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[0,0,1,1]}));
 const hits=scanRemovedClasses(await pdf.save({useObjectStreams:false}),['comments']);
 assert.ok(hits.some(h=>h.category==='comments'));
});
