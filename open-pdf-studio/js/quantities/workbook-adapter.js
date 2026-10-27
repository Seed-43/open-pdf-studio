// ECMA-376 SpreadsheetML adapter. Patch only mapped numeric cells and the
// workbook recalculation flag; retain all other ZIP member bytes unchanged.
// Members are written deflated, as spreadsheet applications write them.
import {zipDeflate} from '../bcf/bcf-zip.js';
import {parseXml,child,children,localName} from '../bcf/bcf-xml.js';
const decode=b=>new TextDecoder().decode(b),encode=s=>new TextEncoder().encode(s);
const tagAttrs=`(?:[^>"'/]|"[^"]*"|'[^']*')*`;
const element=name=>new RegExp(`<((?:[\\w.-]+:)?${name})\\b(${tagAttrs})(?:\\/>|>([\\s\\S]*?)<\\/\\1\\s*>)`,'g');
function xml(s){if(/<!DOCTYPE|<!ENTITY/i.test(s))throw new Error('UNSUPPORTED_XML');return parseXml(s);}
export function cellAddress(address){const m=/^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address||'');if(!m)throw new Error('INVALID_CELL');let column=0;for(const c of m[1])column=column*26+c.charCodeAt(0)-64;const row=Number(m[2]);if(column>16384||row>1048576)throw new Error('INVALID_CELL');return {row,column};}
function inRange(address,range){const parts=range.replace(/\$/g,'').split(':');const a=cellAddress(parts[0]),b=cellAddress(parts[1]||parts[0]),c=cellAddress(address);return c.row>=a.row&&c.row<=b.row&&c.column>=a.column&&c.column<=b.column;}
function attr(open,name,value){const re=new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`,'g');return open.replace(re,'').replace(/\s*\/?>(?=$)/,` ${name}="${value}">`);}
export function patchWorksheet(source,updates){
 if(typeof DOMParser!=='undefined'&&new DOMParser().parseFromString(source,'application/xml').getElementsByTagName('parsererror').length)throw new Error('INVALID_XML');
 if(/<!\[CDATA\[|<!--/.test(source))throw new Error('UNSUPPORTED_WORKSHEET_XML');
 const tree=xml(source);if(localName(tree.name)!=='worksheet')throw new Error('NOT_WORKSHEET');if(child(tree,'sheetProtection'))throw new Error('PROTECTED_SHEET');
 const entries=Object.entries(updates);if(!entries.length||entries.length>1000)throw new Error('INVALID_UPDATES');
 const data=child(tree,'sheetData');if(!data)throw new Error('MISSING_SHEET_DATA');
 for(const [address,value] of entries){cellAddress(address);if(typeof value!=='number'||!Number.isFinite(value))throw new Error('NUMERIC_VALUES_ONLY');for(const merge of children(child(tree,'mergeCells'),'mergeCell'))if(inRange(address,merge.attrs.ref))throw new Error('MERGED_TARGET');
  for(const row of children(data,'row'))for(const cell of children(row,'c')){const formula=child(cell,'f');if(formula&&(cell.attrs.r===address||(formula.attrs.ref&&inRange(address,formula.attrs.ref))))throw new Error('FORMULA_TARGET');}
 }
 let match=element('sheetData').exec(source);if(!match)throw new Error('MISSING_SHEET_DATA');const prefix=match[1].includes(':')?match[1].split(':')[0]+':':'';
 let body=match[3]||'';
 for(const [address,value] of entries.sort((a,b)=>cellAddress(a[0]).row-cellAddress(b[0]).row||cellAddress(a[0]).column-cellAddress(b[0]).column)){
  const coordinate=cellAddress(address),rows=[...body.matchAll(element('row'))],row=rows.find(r=>Number(xml(r[0]).attrs.r)===coordinate.row);
  const newCell=`<${prefix}c r="${address}" t="n"><${prefix}v>${String(value)}</${prefix}v></${prefix}c>`;
  if(!row){const higher=rows.find(r=>Number(xml(r[0]).attrs.r)>coordinate.row),at=higher?.index??body.length;body=body.slice(0,at)+`<${prefix}row r="${coordinate.row}">${newCell}</${prefix}row>`+body.slice(at);continue;}
  let cells=row[3]||'';const list=[...cells.matchAll(element('c'))],cell=list.find(c=>xml(c[0]).attrs.r===address);
  if(cell){const open=`<${cell[1]}${cell[2].replace(/\/\s*$/,'')}>`;const remaining=(cell[3]||'').replace(element('v'),'').replace(element('is'),'');const replacement=attr(open,'t','n')+`<${prefix}v>${String(value)}</${prefix}v>`+remaining+`</${cell[1]}>`;cells=cells.slice(0,cell.index)+replacement+cells.slice(cell.index+cell[0].length);}
  else{const higher=list.find(c=>cellAddress(xml(c[0]).attrs.r).column>coordinate.column),at=higher?.index??cells.length;cells=cells.slice(0,at)+newCell+cells.slice(at);}
  const open=`<${row[1]}${row[2].replace(/\/\s*$/,'')}>`;body=body.slice(0,row.index)+open+cells+`</${row[1]}>`+body.slice(row.index+row[0].length);
 }
 // Remove the optional dimension cache: readers derive the used range anew.
 const output=source.slice(0,match.index)+`<${match[1]}${match[2].replace(/\/\s*$/,'')}>${body}</${match[1]}>`+source.slice(match.index+match[0].length);
 return output.replace(element('dimension'),'');
}
async function unzipWorkbook(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>50*1024*1024)throw new Error('WORKBOOK_SIZE_LIMIT');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}if(end<0)throw new Error('INVALID_XLSX');const count=v.getUint16(end+10,true);if(count>5000||count===65535)throw new Error('WORKBOOK_SIZE_LIMIT');let offset=v.getUint32(end+16,true),total=0;const entries=new Map();
 for(let i=0;i<count;i++){if(v.getUint32(offset,true)!==0x02014b50)throw new Error('INVALID_XLSX');const flags=v.getUint16(offset+8,true),method=v.getUint16(offset+10,true),compressed=v.getUint32(offset+20,true),size=v.getUint32(offset+24,true),names=v.getUint16(offset+28,true),extra=v.getUint16(offset+30,true),comments=v.getUint16(offset+32,true),local=v.getUint32(offset+42,true),name=decode(bytes.subarray(offset+46,offset+46+names));offset+=46+names+extra+comments;
  if(flags&1||size>50*1024*1024||total+size>100*1024*1024||entries.has(name)||name.split('/').includes('..')||name.startsWith('/'))throw new Error('UNSUPPORTED_XLSX');if(v.getUint32(local,true)!==0x04034b50)throw new Error('INVALID_XLSX');const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);if(start+compressed>bytes.length)throw new Error('INVALID_XLSX');const raw=bytes.subarray(start,start+compressed);let data;
  if(method===0)data=raw.slice();else if(method===8){const reader=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>size||total+length>100*1024*1024)throw new Error('WORKBOOK_SIZE_LIMIT');chunks.push(value);}}finally{await reader.cancel();}data=new Uint8Array(length);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}}
  else throw new Error('UNSUPPORTED_COMPRESSION');if(data.length!==size)throw new Error('INVALID_XLSX');total+=size;entries.set(name,data);
 }
 return entries;
}
function worksheets(entries){
 const workbook=entries.get('xl/workbook.xml'),rels=entries.get('xl/_rels/workbook.xml.rels');if(!workbook||!rels)throw new Error('INVALID_XLSX');
 const relationships=children(xml(decode(rels)),'Relationship');
 return children(child(xml(decode(workbook)),'sheets'),'sheet').map(s=>{const id=Object.entries(s.attrs).find(([k])=>k.endsWith(':id'))?.[1],rel=relationships.find(r=>r.attrs.Id===id);if(!rel||rel.attrs.TargetMode==='External')throw new Error('UNSUPPORTED_SHEET');let path=rel.attrs.Target.startsWith('/')?rel.attrs.Target.slice(1):'xl/'+rel.attrs.Target;const parts=[];for(const part of path.split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}path=parts.join('/');if(!entries.has(path))throw new Error('MISSING_SHEET');return {name:s.attrs.name,path};});
}
export async function inspectWorkbook(bytes){return worksheets(await unzipWorkbook(bytes)).map(s=>s.name);}
export async function refreshWorkbook(bytes,mappings){
 const entries=await unzipWorkbook(bytes);if([...entries.keys()].some(k=>k.startsWith('_xmlsignatures/')||/vbaProject\.bin$/i.test(k)))throw new Error('SIGNED_OR_MACRO_WORKBOOK');
 const sheets=worksheets(entries),bySheet=new Map();
 for(const m of mappings){if(!sheets.some(s=>s.name===m.sheet))throw new Error('SHEET_NOT_FOUND');const key=m.sheet;const cells=bySheet.get(key)||{};if(Object.hasOwn(cells,m.cell))throw new Error('DUPLICATE_TARGET');cells[m.cell]=m.value;bySheet.set(key,cells);}
 for(const [sheet,updates] of bySheet){const path=sheets.find(s=>s.name===sheet).path;entries.set(path,encode(patchWorksheet(decode(entries.get(path)),updates)));}
 let workbook=decode(entries.get('xl/workbook.xml'));const calc=element('calcPr').exec(workbook),root=xml(workbook),prefix=root.name.includes(':')?root.name.split(':')[0]+':':'',tag=calc?`<${calc[1]}${calc[2].replace(/\/\s*$/,'')}/>`:`<${prefix}calcPr/>`;let replacement=attr(attr(attr(tag,'fullCalcOnLoad','1'),'forceFullCalc','1'),'calcMode','auto').replace(/>$/,'/>');if(calc)workbook=workbook.slice(0,calc.index)+replacement+workbook.slice(calc.index+calc[0].length);else workbook=workbook.replace(/<\/(?:[\w.-]+:)?workbook\s*>/,replacement+'$&');entries.set('xl/workbook.xml',encode(workbook));
 return zipDeflate([...entries].map(([name,data])=>({name,data})));
}
const pad=n=>String(n).padStart(2,'0');
/** Backup next to the workbook: `<file>.<yyyymmdd-hhmmss>.bak` (UTC), `-n` added on a clash. */
export function backupPathFor(path,now=new Date(),attempt=0){
 const stamp=`${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
 return `${path}.${stamp}${attempt?'-'+attempt:''}.bak`;
}
/**
 * Replace the source workbook only after its previous bytes are safe in a new
 * backup file. io: {writeNew(path,bytes) refusing existing files with
 * CHOOSE_NEW_FILE, writeAtomic(path,bytes)}.
 */
export async function commitWorkbookRefresh(path,previous,output,io,now=new Date()){
 let backupPath=null;
 for(let attempt=0;!backupPath;attempt++){
  const candidate=backupPathFor(path,now,attempt);
  try{await io.writeNew(candidate,previous);backupPath=candidate;}
  catch(e){if(e?.message!=='CHOOSE_NEW_FILE'||attempt>=20)throw e;}
 }
 await io.writeAtomic(path,output);
 return {path,backupPath};
}
