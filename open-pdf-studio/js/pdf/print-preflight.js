import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,PDFRef,decodePDFRawStream} from 'pdf-lib';
import {interpretContentStreams,tokenizeContentStream,xobjectBBox} from '../text/content-stream-text.js';
const N=PDFName.of;
const ID=[1,0,0,1,0,0];
export const DEFAULT_PRINT_PROFILE=Object.freeze({version:1,name:'Print review',minDpi:300,embeddedFonts:true,allowRgb:false,allowTransparency:false,outputIntent:true});
export function printProfile(value={}){
 const p={...DEFAULT_PRINT_PROFILE,...value};
 if(p.version!==1||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!Number.isFinite(p.minDpi)||p.minDpi<36||p.minDpi>2400)throw new Error('INVALID_PROFILE');
 for(const k of ['embeddedFonts','allowRgb','allowTransparency','outputIntent'])if(typeof p[k]!=='boolean')throw new Error('INVALID_PROFILE');
 return p;
}
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const n=v=>v?.asNumber?.();
const nm=v=>v?.decodeText?.()||'';
const arr=v=>v instanceof PDFArray?v.asArray().map(n):null;
const decode=s=>new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());
export async function inspectPrint(bytes,rawProfile={}, {signal,onProgress=()=>{}}={}){
 const profile=printProfile(rawProfile);const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
 const findings=[];const add=(page,object,code,severity,expected,observed,bounds)=>findings.push({page,object,code,severity,expected,observed,...(bounds?{bounds}:{} )});
 const get=(d,k)=>d instanceof PDFDict?pdf.context.lookup(d.get(N(k))):undefined;
 const intents=get(pdf.catalog,'OutputIntents');
 if(profile.outputIntent&&(!(intents instanceof PDFArray)||!intents.size()))add(null,'Catalog/OutputIntents','outputIntent','warning','Embedded output intent','Absent');
 if(intents instanceof PDFArray)for(let i=0;i<intents.size();i++){
  const d=pdf.context.lookup(intents.get(i));
  if(!(get(d,'DestOutputProfile') instanceof PDFRawStream))add(null,'Catalog/OutputIntents/'+i,'outputIntent','warning','Embedded ICC stream','Missing or unreadable profile');
 }
 const resourceCheck=(resources,page,path)=>{
  const fonts=get(resources,'Font');
  if(fonts instanceof PDFDict&&profile.embeddedFonts)for(const [key,ref]of fonts.entries()){
   const font=pdf.context.lookup(ref);if(!(font instanceof PDFDict))continue;
   if(nm(get(font,'Subtype'))==='Type3')continue;
   const descendants=get(font,'DescendantFonts');
   const actual=descendants instanceof PDFArray?pdf.context.lookup(descendants.get(0)):font;
   const descriptor=get(actual,'FontDescriptor');
   if(!['FontFile','FontFile2','FontFile3'].some(k=>get(descriptor,k) instanceof PDFRawStream))
    add(page,path+'/Font/'+key.decodeText(),'fontEmbedding','warning','Embedded font program',nm(get(font,'BaseFont'))||'Unembedded font');
  }
  const states=get(resources,'ExtGState');
  if(states instanceof PDFDict&&!profile.allowTransparency)for(const [key,ref]of states.entries()){
   const d=pdf.context.lookup(ref);
   const alpha=[n(get(d,'ca')),n(get(d,'CA'))].filter(Number.isFinite);
   const smask=get(d,'SMask'),blend=nm(get(d,'BM'));
   if(alpha.some(v=>v<1)||(smask&&nm(smask)!=='None')||(blend&&blend!=='Normal'&&blend!=='Compatible'))
    add(page,path+'/ExtGState/'+key.decodeText(),'transparency','warning','Opaque normal blending','Transparency resource');
  }
  const colors=get(resources,'ColorSpace');
  if(colors instanceof PDFDict&&!profile.allowRgb)for(const [key,ref]of colors.entries()){
   const c=pdf.context.lookup(ref);
   if(nm(c)==='DeviceRGB'||(c instanceof PDFArray&&nm(pdf.context.lookup(c.get(0)))==='CalRGB'))
    add(page,path+'/ColorSpace/'+key.decodeText(),'rgb','warning','No device/calibrated RGB resources','RGB color space');
  }
  if(['Pattern','Shading'].some(k=>get(resources,k) instanceof PDFDict && get(resources,k).keys().length))add(page,path,'coverage','info','Complete resource analysis','Pattern/shading internals require external validation');
 };
 // Nested forms form a DAG: one form can place another many times. Each
 // (XObject, placement transform, page) is inspected once, every page has a
 // placement budget, and the walk yields to the event loop as it goes.
 const VISIT_BUDGET=10000,YIELD_EVERY=200;
 const parsed=new Map();
 let seen,visits,budgetReported;
 const ctmKey=m=>m.map(v=>Math.round(v*1e6)/1e6).join(',');
 const pause=async()=>{await new Promise(r=>setTimeout(r,0));if(signal?.aborted)throw new Error('CANCELLED');};
 // Decoding and interpreting a form stream does not depend on where it is placed.
 const analyse=(streams,identity)=>{
  if(identity&&parsed.has(identity))return parsed.get(identity);
  let result;
  try{
   const src=streams.map(decode),tokens=src.flatMap(tokenizeContentStream);
   result={inline:tokens.some(t=>t.t==='op'&&t.v==='BI..EI'),rgb:tokens.some(t=>t.t==='op'&&(t.v==='rg'||t.v==='RG')),uses:interpretContentStreams(src).xobjects};
  }catch{result=null;}
  if(identity)parsed.set(identity,result);
  return result;
 };
 const visit=async(streams,resources,parent,page,path,ancestors,userUnit,identity=null)=>{
  // Resource and stream findings depend on the object only, not on its placement.
  const once=!identity||!seen.has('stream|'+identity);
  if(identity)seen.add('stream|'+identity);
  if(once)resourceCheck(resources,page,path);
  const a=analyse(streams,identity);
  if(!a){if(once)add(page,path,'coverage','warning','Readable content streams','Unsupported compression or invalid stream');return;}
  if(once&&a.inline)add(page,path,'coverage','warning','Measured image resolution','Inline-image resolution not evaluated');
  if(once&&!profile.allowRgb&&a.rgb)add(page,path,'rgb','warning','No device RGB painting','RGB painting operator');
  const uses=a.uses;
  const xobjects=get(resources,'XObject');
  for(let i=0;i<uses.length;i++){
   if(visits>=VISIT_BUDGET){
    if(!budgetReported){budgetReported=true;add(page,path,'coverage','warning','Complete XObject analysis','Coverage incomplete: placement budget of '+VISIT_BUDGET+' reached; remaining placements not inspected');}
    return;
   }
   if(++visits%YIELD_EVERY===0)await pause();
   const use=uses[i];const raw=xobjects?.get?.(N(use.name));const obj=pdf.context.lookup(raw);
   if(!(obj instanceof PDFRawStream)){add(page,path+'/'+use.name,'coverage','warning','Resolvable XObject','Missing/unreadable XObject');continue;}
   const ctm=multiply(parent,use.ctm),objectPath=path+'/'+use.name+'@'+i;
   const ref=raw instanceof PDFRef?raw.toString():null;
   if(ref){const key=ref+'|'+ctmKey(ctm);if(seen.has(key))continue;seen.add(key);}
   if(nm(get(obj.dict,'Subtype'))==='Image'){
    const w=n(get(obj.dict,'Width')),h=n(get(obj.dict,'Height'));
    const width=Math.hypot(ctm[0],ctm[1])*userUnit,height=Math.hypot(ctm[2],ctm[3])*userUnit;
    const dpi=Math.min(w/width,h/height)*72;
    if(!Number.isFinite(dpi)||dpi<=0)add(page,objectPath,'coverage','warning','Finite effective image resolution','Invalid dimensions or transform');
    else if(dpi<profile.minDpi)add(page,objectPath,'imageDpi','warning','At least '+profile.minDpi+' dpi',Math.round(dpi*10)/10+' dpi',xobjectBBox(ctm));
    if(!profile.allowRgb&&nm(get(obj.dict,'ColorSpace'))==='DeviceRGB')add(page,objectPath,'rgb','warning','Non-RGB image','DeviceRGB',xobjectBBox(ctm));
    if(!profile.allowTransparency&&get(obj.dict,'SMask'))add(page,objectPath,'transparency','warning','No soft mask','Image soft mask',xobjectBBox(ctm));
   }else if(nm(get(obj.dict,'Subtype'))==='Form'){
    const identity=ref||objectPath;
    if(ancestors.includes(identity)||ancestors.length>=16){add(page,objectPath,'coverage','warning','Acyclic form tree','Cycle/depth limit');continue;}
    const matrix=arr(get(obj.dict,'Matrix'))||ID;
    if(matrix.length!==6||!matrix.every(Number.isFinite)){add(page,objectPath,'coverage','warning','Valid form matrix','Invalid matrix');continue;}
    if(!profile.allowTransparency&&nm(get(get(obj.dict,'Group'),'S'))==='Transparency'&&!seen.has('group|'+identity)){seen.add('group|'+identity);add(page,objectPath,'transparency','warning','No transparency group','Transparency group');}
    await visit([obj],get(obj.dict,'Resources')||resources,multiply(ctm,matrix),page,objectPath,[...ancestors,identity],userUnit,ref);
   }
  }
 };
 for(let i=0;i<pdf.getPageCount();i++){
  if(signal?.aborted)throw new Error('CANCELLED');
  const page=pdf.getPage(i),num=i+1,media=page.getMediaBox();
  for(const key of ['CropBox','TrimBox','BleedBox','ArtBox']){
   const box=arr(get(page.node,key));if(!box)continue;
   if(box.length!==4||!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1]||box[0]<media.x||box[1]<media.y||box[2]>media.x+media.width||box[3]>media.y+media.height)
    add(num,'Page/'+key,'pageBox','error','Positive box inside MediaBox',JSON.stringify(box));
  }
  if(!get(page.node,'TrimBox'))add(num,'Page/TrimBox','trimBox','warning','Explicit trim box','Absent (effective CropBox used)');
  const value=get(page.node,'Contents');
  const streams=value instanceof PDFArray?value.asArray().map(v=>pdf.context.lookup(v)):value?[value]:[];
  if(streams.some(v=>!(v instanceof PDFRawStream)))add(num,'Page/Contents','coverage','warning','Readable streams','Unsupported content object');
  else{seen=new Set();visits=0;budgetReported=false;await visit(streams,page.node.Resources(),ID,num,'Page',[],n(get(page.node,'UserUnit'))||1);}
  if(get(page.node,'Annots') instanceof PDFArray && get(page.node,'Annots').size())add(num,'Page/Annots','coverage','info','Appearance/form validation','Annotation appearances are not preflighted');
  onProgress({page:num,pages:pdf.getPageCount()});await new Promise(r=>setTimeout(r,0));
 }
 return {profile,pages:pdf.getPageCount(),findings,conformanceCertified:false,limitations:[
  'Checks are structural and profile-specific, not a PDF/X or PDF/A certification.',
  'Fonts/resources may be unused; image DPI uses each placement transform before clipping.',
  'Each page inspects at most 10000 XObject placements; identical placements of the same object are inspected once.',
  'Inline images, annotation appearances, complex color spaces, patterns and shading internals need external validation.',
 ]};
}
export async function fixPrintTrimBoxes(bytes,profile){
 const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
 for(const page of pdf.getPages()){
  const box=page.getCropBox(),media=page.getMediaBox();
  const x=Math.max(box.x,media.x),y=Math.max(box.y,media.y);
  const w=Math.min(box.x+box.width,media.x+media.width)-x,h=Math.min(box.y+box.height,media.y+media.height)-y;
  if(w<=0||h<=0)throw new Error('INVALID_CROP_BOX');
  page.setTrimBox(x,y,w,h);
 }
 const output=await pdf.save({updateFieldAppearances:false});
 return {bytes:output,report:await inspectPrint(output,profile)};
}
