// Shared by Node and real-browser regression runners. Exercises the app's font
// embedding and OCR writer, not text hidden in document metadata.
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { embedOcrFont, laadFontkit, writeOcrTextLayer } from './saver/ocr-text-layer.js';

export const UNICODE_CASES = [
  {font:'Inter-Regular.ttf', text:'Crème brûlée'},
  {font:'Inter-Regular.ttf', text:'Ελληνικά'},
  {font:'Inter-Regular.ttf', text:'Русский'},
  {font:'Inter-Regular.ttf', text:'Tiếng Việt'},
  {font:'NotoSansArabic.ttf', text:'العربية', direction:'rtl'},
  {font:'NotoSansThai[wdth,wght].ttf', text:'ภาษาไทย'},
];
const require = (condition, message) => { if(!condition) throw new Error(message); };

export async function createUnicodeFixture(bytes, text) {
  const kit=await laadFontkit();const face=kit.create(bytes);
  for(const char of text) if(char.trim()) require(face.hasGlyphForCodePoint(char.codePointAt(0)), `Missing glyph: ${char}`);
  const run=face.layout(text);
  for(const glyph of run.glyphs) require(glyph.id!==0,'Unexpected .notdef glyph');
  require(run.glyphs.some(g=>g.path.commands.length>0),'No visible glyph outlines');
  const pdf=await PDFDocument.create();
  const font=await embedOcrFont(pdf,bytes,{unicodeGuard:true});
  pdf.addPage([600,150]).drawText(text,{x:20,y:80,font,size:24});
  const ocr=pdf.addPage([600,150]);
  writeOcrTextLayer(ocr,[{text,left:20,top:40,width:300,height:24,confidence:90}],font);
  const output=await pdf.save();
  const reopened=await PDFDocument.load(output);
  const fonts=reopened.getPage(0).node.Resources().lookup(PDFName.of('Font'),PDFDict);
  let embedded=false;
  for(const [,ref] of fonts.entries()) {
    const f=reopened.context.lookup(ref,PDFDict);
    require(f.lookup(PDFName.of('ToUnicode')) instanceof PDFRawStream,'Missing ToUnicode stream');
    const descendant=f.lookup(PDFName.of('DescendantFonts')).lookup(0,PDFDict);
    const descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict);
    embedded ||= ['FontFile','FontFile2','FontFile3'].some(key=>descriptor.has(PDFName.of(key)));
  }
  require(embedded,'Font program not embedded');
  return output;
}

export async function verifyUnicodeExtraction(pdfjs, bytes, text) {
  const task=pdfjs.getDocument({data:bytes.slice(),verbosity:0,isEvalSupported:false});
  try {
    const pdf=await task.promise;
    for(const number of [1,2]) {
      const content=await (await pdf.getPage(number)).getTextContent();
      const actual=content.items.map(i=>i.str||'').join('').normalize('NFC');
      require(actual===text.normalize('NFC'),`Page ${number}: extracted ${JSON.stringify(actual)}, expected ${JSON.stringify(text)}`);
    }
  } finally {await task.destroy();}
}
