import test from 'node:test';
import assert from 'node:assert/strict';
import {zipStore,unzip} from '../bcf/bcf-zip.js';
import {refreshWorkbook,inspectWorkbook,commitWorkbookRefresh,backupPathFor} from './workbook-adapter.js';
const rows=Array.from({length:200},(_,i)=>`<row r="${i+2}"><c r="A${i+2}"><v>${i}</v></c></row>`).join('');
const sheet=`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row>${rows}</sheetData></worksheet>`;
const workbook=()=>zipStore([{name:'xl/workbook.xml',data:'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>'},{name:'xl/_rels/workbook.xml.rels',data:'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'},{name:'xl/worksheets/sheet1.xml',data:sheet},{name:'xl/styles.xml',data:'<styleSheet>'+'<numFmt/>'.repeat(100)+'</styleSheet>'}]);
function methods(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=bytes.length-22;while(v.getUint32(end,true)!==0x06054b50)end--;
 let at=v.getUint32(end+16,true);const out={};
 for(let i=0;i<v.getUint16(end+10,true);i++){const len=v.getUint16(at+28,true),name=new TextDecoder().decode(bytes.subarray(at+46,at+46+len));out[name]=v.getUint16(at+10,true);at+=46+len+v.getUint16(at+30,true)+v.getUint16(at+32,true);}
 return out;
}
test('refreshed workbooks are deflated and still parse',async()=>{
 const source=workbook();
 const output=await refreshWorkbook(source,[{sheet:'Budget',cell:'B1',value:42}]);
 const m=methods(output);
 assert.equal(m['xl/worksheets/sheet1.xml'],8);assert.equal(m['xl/styles.xml'],8);
 assert.ok(output.length<source.length,'smaller than the stored source');
 assert.deepEqual(await inspectWorkbook(output),['Budget']);
 const files=await unzip(output);assert.match(new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')),/<c r="B1" t="n"><v>42<\/v><\/c>/);
 assert.deepEqual(files.get('xl/styles.xml'),(await unzip(source)).get('xl/styles.xml'));
});
test('the round trip keeps a backup of the previous workbook before overwriting it',async()=>{
 const source=workbook(),output=await refreshWorkbook(source,[{sheet:'Budget',cell:'B1',value:7}]);
 const disk=new Map([['C:\\data\\budget.xlsx',source]]),order=[];
 const io={writeNew:async(p,b)=>{if(disk.has(p))throw new Error('CHOOSE_NEW_FILE');order.push('backup');disk.set(p,b);},writeAtomic:async(p,b)=>{order.push('replace');disk.set(p,b);}};
 const now=new Date('2026-10-21T09:08:07Z');
 const {backupPath}=await commitWorkbookRefresh('C:\\data\\budget.xlsx',source,output,io,now);
 assert.equal(backupPath,backupPathFor('C:\\data\\budget.xlsx',now));assert.match(backupPath,/^C:\\data\\budget\.xlsx\.\d{8}-\d{6}(-\d+)?\.bak$/);
 assert.deepEqual(order,['backup','replace']);
 assert.deepEqual(disk.get(backupPath),source);assert.deepEqual(disk.get('C:\\data\\budget.xlsx'),output);
 // A second refresh in the same second keeps the first backup.
 const again=await commitWorkbookRefresh('C:\\data\\budget.xlsx',output,source,io,now);
 assert.notEqual(again.backupPath,backupPath);assert.deepEqual(disk.get(backupPath),source);assert.deepEqual(disk.get(again.backupPath),output);
});
test('without a backup the workbook is not overwritten',async()=>{
 const source=workbook();let replaced=false;
 const io={writeNew:async()=>{throw new Error('DISK_FULL');},writeAtomic:async()=>{replaced=true;}};
 await assert.rejects(commitWorkbookRefresh('C:\\data\\budget.xlsx',source,source,io),/DISK_FULL/);
 assert.equal(replaced,false);
});
