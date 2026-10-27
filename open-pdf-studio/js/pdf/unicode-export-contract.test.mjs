import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {embedOcrFont, writeOcrTextLayer} from './saver/ocr-text-layer.js';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {UNICODE_CASES,createUnicodeFixture,verifyUnicodeExtraction} from './unicode-export-contract.js';
const directory=process.env.OPS_UNICODE_FONT_DIR;
const assets=JSON.parse(await readFile(new URL('../../scripts/unicode-fonts.json',import.meta.url),'utf8'));
const load=async name=>{
 const b=await readFile(path.join(directory,name));
 assert.equal(createHash('sha256').update(b).digest('hex'),assets.find(a=>a.name===name).sha256);
 return b;
};
for(const c of UNICODE_CASES) test(`${c.direction==='rtl'?'Unsupported Arabic export rejected':'Unicode visible + OCR roundtrip'}: ${c.text}`,{skip:directory?false:'Set OPS_UNICODE_FONT_DIR; CI provisions pinned fonts'},async()=>{
 const fontBytes=await load(c.font);
 if(c.direction==='rtl') {
  await assert.rejects(createUnicodeFixture(fontBytes,c.text), error=>error.code==='PDF_UNMAPPED_SHAPED_GLYPH');
  return;
 }
 const output=await createUnicodeFixture(fontBytes,c.text);
 await verifyUnicodeExtraction(pdfjs,output,c.text);
 const doc=mupdf.Document.openDocument(output,'application/pdf');
 try {
  for(const number of [0,1]) {
   const page=doc.loadPage(number);let pix;
   try {
    pix=page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,false);
    const dark=pix.getPixels().reduce((n,v)=>n+(v<220?1:0),0);
    if(number===0)assert.ok(dark>100,'Visible page has ink');
    else assert.equal(dark,0,'OCR remains invisible');
   } finally {pix?.destroy();page.destroy();}
  }
 } finally {doc.destroy();}
});
test('fixture contract rejects absent glyphs instead of claiming a successful Unicode roundtrip',{skip:!directory},async()=>{
 await assert.rejects(createUnicodeFixture(await load('Inter-Regular.ttf'),'中文'),/Missing glyph/);
});

for (const [name, text, code] of [
 ['Inter-Regular.ttf', '中文', 'PDF_MISSING_GLYPH'],
 ['NotoSansArabic.ttf', 'العربية', 'PDF_UNMAPPED_SHAPED_GLYPH'],
]) test(`OCR skips a ${code} word and keeps the rest of the layer`, {skip:!directory}, async()=>{
 const doc=await PDFDocument.create();
 const page=doc.addPage();
 const font=await embedOcrFont(doc,await load(name),{unicodeGuard:true});
 const word=text=>({text,left:10,top:10,width:100,height:12});
 assert.throws(()=>font.encodeText(text),error=>error.code===code);
 assert.doesNotThrow(()=>writeOcrTextLayer(page,[word('123'),word(text)],font));
 const task=pdfjs.getDocument({data:await doc.save(),verbosity:0,isEvalSupported:false});
 try {
  const items=(await (await (await task.promise).getPage(1)).getTextContent()).items.map(i=>i.str||'').join('');
  assert.equal(items,'123');
 } finally {await task.destroy();}
});
