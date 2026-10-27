// Run against an already-started Vite server. No browser or app state is reused.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const dir=process.env.OPS_UNICODE_FONT_DIR;
if(!dir)throw new Error('Set OPS_UNICODE_FONT_DIR');
const assets=JSON.parse(await readFile(new URL('./unicode-fonts.json',import.meta.url),'utf8'));
const fonts={};
for(const a of assets.filter(a=>a.name.endsWith('.ttf'))) {
 const b=await readFile(path.join(dir,a.name));
 if(createHash('sha256').update(b).digest('hex')!==a.sha256)throw new Error(`Checksum: ${a.name}`);
 fonts[a.name]=Array.from(b);
}
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto(process.env.BASE_URL||'http://127.0.0.1:3042');
 const result=await page.evaluate(async fonts=>{
  const c=await import('/js/pdf/unicode-export-contract.js');
  const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const results=[];
  for(const item of c.UNICODE_CASES) {
   let bytes;
   try { bytes=await c.createUnicodeFixture(new Uint8Array(fonts[item.font]),item.text); }
   catch(e) {
    if(item.direction==='rtl' && e.code==='PDF_UNMAPPED_SHAPED_GLYPH') {results.push({text:item.text,status:'explicitly rejected: unmapped shaped glyph'});continue;}
    throw e;
   }
   if(item.direction==='rtl') throw new Error('Arabic guard no longer rejects; qualify shaping/extraction before changing the contract');
   try {await c.verifyUnicodeExtraction(pdfjs,bytes,item.text);results.push({text:item.text,status:'pass'});}
   catch(e){throw e;}
   // Independent real-browser canvas paint: visible page must contain ink.
   const task=pdfjs.getDocument({data:bytes.slice(),verbosity:0});
   try {
    const doc=await task.promise;const p=await doc.getPage(1);const v=p.getViewport({scale:1});
    const canvas=document.createElement('canvas');canvas.width=v.width;canvas.height=v.height;
    const ctx=canvas.getContext('2d');await p.render({canvasContext:ctx,viewport:v}).promise;
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let dark=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]<220&&rgba[i+3]>0)dark++;
    if(dark<30)throw new Error('Missing visible ink: '+item.text);
   } finally {await task.destroy();}
  }
  return results;
 },fonts);
 console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
