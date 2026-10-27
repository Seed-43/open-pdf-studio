// Independent post-scan of a cleaned copy. It parses the written bytes with
// its own small PDF object reader (no pdf-lib, no object graph walk from the
// cleaner) and reports every object of a removed class that is still in the
// file, reachable or not. The cleaner writes classic cross-reference tables
// without object streams, so every dictionary is visible to this reader.

const WS=new Set([0,9,10,12,13,32]);
const DELIM=new Set([...'()<>[]{}/%'].map(c=>c.charCodeAt(0)));
const ANNOTATION_SUBTYPES=new Set(['Text','Link','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink','Popup','FileAttachment','Sound','Movie','Screen','PrinterMark','TrapNet','Watermark','3D','Redact','RichMedia','Projection']);
const ACTION_KEYS=['A','AA','OpenAction','JavaScript','JS','XFA'];
const ACTION_TYPES=new Set(['JavaScript','Launch','SubmitForm','ImportData','RichMediaExecute']);
const ATTACHMENT_KEYS=['EF','EmbeddedFiles','AF'];
const METADATA_KEYS=['Metadata','PieceInfo','Thumb'];

class Ref{constructor(num,gen){this.num=num;this.gen=gen;}get key(){return this.num+' '+this.gen;}}
class Name{constructor(value){this.value=value;}}
class Keyword{constructor(value){this.value=value;}}

function lexer(bytes){
 let pos=0;
 const latin1=new TextDecoder('latin1'),text=(a,b)=>latin1.decode(bytes.subarray(a,b));
 function skip(){
  for(;;){
   while(pos<bytes.length&&WS.has(bytes[pos]))pos++;
   if(bytes[pos]!==37)return;
   while(pos<bytes.length&&bytes[pos]!==10&&bytes[pos]!==13)pos++;
  }
 }
 function token(){
  skip();if(pos>=bytes.length)return null;
  const c=bytes[pos];
  if(c===47){
   let start=++pos;while(pos<bytes.length&&!WS.has(bytes[pos])&&!DELIM.has(bytes[pos]))pos++;
   return new Name(text(start,pos).replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))));
  }
  if(c===40){
   let depth=1,out='';pos++;
   while(pos<bytes.length&&depth){const b=bytes[pos++];if(b===92){out+=String.fromCharCode(bytes[pos++]);continue;}if(b===40)depth++;if(b===41&&!--depth)break;out+=String.fromCharCode(b);}
   return {string:out};
  }
  if(c===60&&bytes[pos+1]===60){pos+=2;return '<<';}
  if(c===62&&bytes[pos+1]===62){pos+=2;return '>>';}
  if(c===60){const start=++pos;while(pos<bytes.length&&bytes[pos]!==62)pos++;const hex=text(start,pos++).replace(/\s/g,'');let out='';for(let i=0;i<hex.length;i+=2)out+=String.fromCharCode(parseInt((hex.slice(i,i+2)+'0').slice(0,2),16));return {string:out};}
  if(c===91||c===93||c===123||c===125){pos++;return String.fromCharCode(c);}
  const start=pos;while(pos<bytes.length&&!WS.has(bytes[pos])&&!DELIM.has(bytes[pos]))pos++;
  if(pos===start){pos++;return new Keyword(text(start,pos));}
  const word=text(start,pos);
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)?Number(word):new Keyword(word);
 }
 return {
  get pos(){return pos;},set pos(v){pos=v;},
  next:token,
  peek(count=1){const at=pos,out=[];for(let i=0;i<count;i++)out.push(token());pos=at;return out;},
 };
}
const isInt=v=>typeof v==='number'&&Number.isInteger(v)&&v>=0;
const isKw=(v,w)=>v instanceof Keyword&&v.value===w;
function value(lex,first=lex.next()){
 if(isInt(first)){const [g,r]=lex.peek(2);if(isInt(g)&&isKw(r,'R')){lex.next();lex.next();return new Ref(first,g);}return first;}
 if(first==='<<'){const out=new Map();for(;;){const k=lex.next();if(k==='>>'||k===null)return out;if(!(k instanceof Name))continue;out.set(k.value,value(lex));}}
 if(first==='['){const out=[];for(;;){const t=lex.next();if(t===']'||t===null)return out;out.push(value(lex,t));}}
 return first;
}
function streamEnd(bytes,start,dict){
 const length=dict instanceof Map?dict.get('Length'):undefined;
 const tail=at=>new TextDecoder('latin1').decode(bytes.subarray(at,Math.min(bytes.length,at+12)));
 if(isInt(length)&&/^\s*endstream/.test(tail(start+length)))return start+length;
 const marker=[...'endstream'].map(c=>c.charCodeAt(0));
 for(let i=start;i<=bytes.length-marker.length;i++)if(marker.every((m,j)=>bytes[i+j]===m))return i;
 return bytes.length;
}
/** Parse the indirect objects and trailers of a classic-xref PDF. */
export function readObjects(bytes){
 const lex=lexer(bytes),objects=new Map(),trailers=[];
 for(;;){
  const t=lex.next();if(t===null)break;
  if(isKw(t,'trailer')){trailers.push(value(lex));continue;}
  if(!isInt(t))continue;
  const [g,o]=lex.peek(2);if(!isInt(g)||!isKw(o,'obj'))continue;
  lex.next();lex.next();
  const body=value(lex);let stream=false;
  const after=lex.peek(1)[0];
  if(isKw(after,'stream')){
   lex.next();let start=lex.pos;if(bytes[start]===13)start++;if(bytes[start]===10)start++;
   lex.pos=streamEnd(bytes,start,body);stream=true;
  }
  objects.set(t+' '+g,{value:body,stream});
 }
 return {objects,trailers};
}
const nameOf=v=>v instanceof Name?v.value:'';
function* containers(v,path){
 if(v instanceof Map){yield [v,path];for(const [k,c] of v)yield* containers(c,path+'/'+k);}
 else if(Array.isArray(v))for(let i=0;i<v.length;i++)yield* containers(v[i],path+'/'+i);
}
function* references(v){
 if(v instanceof Ref)yield v.key;
 else if(v instanceof Map)for(const c of v.values())yield* references(c);
 else if(Array.isArray(v))for(const c of v)yield* references(c);
}
/**
 * Report every remaining object of the given removal categories in the
 * written bytes. An empty list means the scan found nothing to remove.
 * Unreferenced objects are reported too: a cleaned copy has none.
 */
export function scanRemovedClasses(bytes,categories){
 const selected=new Set(categories),hits=[];
 const add=(category,path,detail)=>hits.push({category,path,detail});
 const {objects,trailers}=readObjects(bytes);
 for(const trailer of trailers){
  if(!(trailer instanceof Map))continue;
  if(selected.has('metadata')&&trailer.has('Info'))add('metadata','trailer','Document information dictionary');
 }
 for(const [id,{value:root}] of objects){
  for(const [d,path] of containers(root,id)){
   if(!(d instanceof Map))continue;
   const type=nameOf(d.get('Type')),subtype=nameOf(d.get('Subtype'));
   if(selected.has('metadata')){
    for(const k of d.keys())if(METADATA_KEYS.includes(k)||k.startsWith('OPS_'))add('metadata',path,'Key /'+k);
    if(type==='Metadata')add('metadata',path,'XMP metadata stream');
   }
   if(selected.has('actions')){
    for(const k of ACTION_KEYS)if(d.has(k))add('actions',path,'Key /'+k);
    if(type==='Action'||ACTION_TYPES.has(nameOf(d.get('S'))))add('actions',path,'Action dictionary');
   }
   if(selected.has('attachments')){
    for(const k of ATTACHMENT_KEYS)if(d.has(k))add('attachments',path,'Key /'+k);
    if(type==='EmbeddedFile'||subtype==='FileAttachment')add('attachments',path,'Embedded file');
   }
   if(selected.has('comments')){
    if(subtype!=='Widget'&&(type==='Annot'||(ANNOTATION_SUBTYPES.has(subtype)&&d.has('Rect'))))add('comments',path,'Annotation: '+subtype);
    const obj=d.get('Obj');
    if(type==='OBJR'&&obj instanceof Ref&&!objects.has(obj.key))add('comments',path,'Structure reference to a removed annotation');
   }
  }
 }
 // A cleaned copy carries no unreferenced objects: those can hold removed data.
 const seen=new Set(),stack=[];
 for(const trailer of trailers)for(const r of references(trailer))stack.push(r);
 while(stack.length){const key=stack.pop();if(seen.has(key))continue;seen.add(key);const o=objects.get(key);if(o)for(const r of references(o.value))stack.push(r);}
 for(const id of objects.keys())if(!seen.has(id))add([...selected][0]||'metadata',id,'Unreferenced object');
 return hits;
}
