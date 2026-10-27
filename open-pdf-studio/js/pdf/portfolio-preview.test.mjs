import test from 'node:test';
import assert from 'node:assert/strict';
import {openPortfolioPreview,previewDisplayName} from './portfolio-preview.js';
import {opslaanVraagtOpslaanAls,opslaanAlsStandaardPad} from './handtekeningen/opslaan.js';
const pdf=new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const DIR='C:\\Users\\me\\AppData\\Local\\app\\cad-import\\';
function host({desktop=true,dir=DIR}={}){
 const calls={tabs:[],loads:[],writes:[],scopes:[],temps:[]};
 const deps={
  desktop,now:()=>1760000000000,
  privateDir:async()=>dir,
  writeNew:async(path,bytes)=>{calls.writes.push(path);calls.scopes.push(path);},
  createTab:path=>{calls.tabs.push(path);const doc={id:'d1',filePath:path};return {doc,index:0};},
  // The loader grants a file-system scope for its path in the desktop app.
  loadPDF:async(path,index,bytes)=>{calls.loads.push(path);if(desktop&&path)calls.scopes.push(path);},
  rememberTemp:(doc,path)=>calls.temps.push(path),
 };
 return {deps,calls};
}
for(const name of ['..\\..\\Windows\\evil.pdf','../../../etc/x.pdf','C:\\Users\\Public\\Desktop\\plan.pdf','\\\\server\\share\\a.pdf','plan.pdf']){
 test('preview of "'+name+'" is an untitled document whose path never comes from the entry name',async()=>{
  const {deps,calls}=host();
  const doc=await openPortfolioPreview(pdf,name,deps);
  assert.equal(doc.isUntitled,true);
  for(const path of [...calls.tabs,...calls.loads,...calls.writes,...calls.scopes]){
   assert.ok(path.startsWith(DIR),path);
   assert.match(path.split(/[\\/]/).pop(),/^opds-import-\d{10,}-portfolio-preview\.pdf$/);
  }
  assert.deepEqual(calls.temps,calls.writes,'temporary file is removed with the tab');
  assert.ok(!/[\\/]/.test(doc.fileName),doc.fileName);
  assert.equal(opslaanVraagtOpslaanAls(doc),true,'Ctrl+S asks Save As');
  assert.equal(opslaanAlsStandaardPad(doc,'C:\\Docs'),'C:\\Docs\\'+doc.fileName.replace(/\.pdf$/i,'')+'.pdf');
 });
}
test('without a file system the preview is an in-memory tab without any path or scope grant',async()=>{
 const {deps,calls}=host({desktop:false});
 const doc=await openPortfolioPreview(pdf,'../../plan.pdf',deps);
 assert.deepEqual(calls.tabs,[null]);assert.deepEqual(calls.loads,['__memory__d1']);assert.deepEqual(calls.scopes,[]);
 assert.equal(doc.isUntitled,true);assert.equal(doc.fileName,'plan.pdf');assert.equal(opslaanVraagtOpslaanAls(doc),true);
});
test('display names keep only a plain file name',()=>{
 assert.equal(previewDisplayName('a/b\\c.pdf'),'c.pdf');assert.equal(previewDisplayName('\u0000\u0007x.pdf'),'x.pdf');
 assert.equal(previewDisplayName(''),'portfolio-component.pdf');assert.equal(previewDisplayName('..'),'portfolio-component.pdf');
});
test('a saved document saves in place; an untitled one asks Save As',()=>{
 assert.equal(opslaanVraagtOpslaanAls({filePath:'C:\\a.pdf'}),false);
 assert.equal(opslaanVraagtOpslaanAls({filePath:'C:\\a.pdf',isUntitled:true}),true);
 assert.equal(opslaanVraagtOpslaanAls({filePath:null}),true);
});
