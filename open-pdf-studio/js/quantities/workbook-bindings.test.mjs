import test from 'node:test';
import assert from 'node:assert/strict';
import {zipStore,unzip} from '../bcf/bcf-zip.js';
import {patchWorksheet,refreshWorkbook,inspectWorkbook} from './workbook-adapter.js';
import {bindingStatus,bindingValues,bindingCsv,configSignature} from './workbook-bindings.js';
import {buildSchedule} from './engine.js';
const worksheet='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1" s="2" t="n"><v>1</v></c><c r="B1"><f>A1*2</f><v>2</v></c><c r="C1" s="1"/></row><row r="3"><c r="A3"><v>3</v></c></row></sheetData></worksheet>';
function workbook(){return zipStore([{name:'xl/workbook.xml',data:'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget &amp; scope" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="123"/></workbook>'},{name:'xl/_rels/workbook.xml.rels',data:'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'},{name:'xl/worksheets/sheet1.xml',data:worksheet},{name:'xl/styles.xml',data:'keep these exact style bytes'},{name:'customXml/item1.xml',data:'keep custom metadata'}]);}
test('XLSX refresh changes mapped numeric cells only, including blank/new cells',async()=>{
 const bytes=workbook();assert.deepEqual(await inspectWorkbook(bytes),['Budget & scope']);
 const result=await refreshWorkbook(bytes,[{sheet:'Budget & scope',cell:'A1',value:1.25},{sheet:'Budget & scope',cell:'C1',value:0},{sheet:'Budget & scope',cell:'B2',value:42}]);
 const original=await unzip(bytes),files=await unzip(result),xml=new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
 assert.match(xml,/<c r="A1" s="2" t="n"><v>1.25<\/v><\/c>/);assert.match(xml,/<c r="C1" s="1" t="n"><v>0<\/v><\/c>/);assert.ok(xml.includes('<c r="B1"><f>A1*2</f><v>2</v></c>'));assert.ok(xml.indexOf('r="2"')<xml.indexOf('r="3"'));
 assert.deepEqual(files.get('xl/styles.xml'),original.get('xl/styles.xml'));assert.deepEqual(files.get('customXml/item1.xml'),original.get('customXml/item1.xml'));assert.match(new TextDecoder().decode(files.get('xl/workbook.xml')),/fullCalcOnLoad="1"/);
});
test('mapped formulas, array ranges, protected and merged cells are refused',()=>{
 assert.throws(()=>patchWorksheet(worksheet,{B1:5}),/FORMULA_TARGET/);
 assert.throws(()=>patchWorksheet(worksheet.replace('<f>A1*2</f>','<f t="array" ref="B1:C2">A1*2</f>'),{C2:5}),/FORMULA_TARGET/);
 assert.throws(()=>patchWorksheet(worksheet.replace('</worksheet>','<sheetProtection sheet="1"/></worksheet>'),{A1:5}),/PROTECTED/);
 assert.throws(()=>patchWorksheet(worksheet.replace('</worksheet>','<mergeCells><mergeCell ref="A1:A2"/></mergeCells></worksheet>'),{A1:5}),/MERGED/);
});
test('prefixed XML and empty sheetData are supported without losing formatting',()=>{
 const xml='<s:worksheet xmlns:s="urn:test"><s:sheetData/></s:worksheet>';assert.match(patchWorksheet(xml,{B2:3}),/<s:row r="2"><s:c r="B2" t="n"><s:v>3<\/s:v>/);
});
const schedule={id:'schedule',name:'Length',config:{categories:['line-based'],fields:['length']}};
const binding={version:1,id:'binding',name:'Budget',sourcePath:'a.pdf',scheduleId:'schedule',scheduleName:'Length',config:configSignature(schedule),workbookPath:'budget.xlsx',sheet:'Budget',mappings:[{field:'length',cell:'B2',unit:'mm'}]};
test('locale-independent numeric totals, explicit units and zero totals',()=>{
 const r=buildSchedule([{type:'measureDistance',measureValue:1250.25,measureUnit:'mm',page:1}],schedule.config);assert.equal(bindingValues(binding,r,schedule)[0].value,1250.25);
 const empty=buildSchedule([],schedule.config);assert.equal(bindingValues(binding,empty,schedule)[0].value,0);
 const csv=bindingCsv({...binding,sourcePath:'=unsafe.pdf'},bindingValues(binding,r,schedule),'d2');assert.ok(csv.includes(',1250.25,'));assert.ok(csv.includes("'=unsafe.pdf"));
 const mixed=buildSchedule([{type:'measureDistance',measureValue:2,measureUnit:'mm'},{type:'measureDistance',measureValue:2,measureUnit:'px'}],schedule.config);assert.throws(()=>bindingValues(binding,mixed,schedule),/MIXED_UNITS/);
});
test('multiple source identities, revisions, moved/deleted/renamed schedules never look current',()=>{
 const b={...binding,last:{documentId:'a',revision:3}},document={id:'a',filePath:'a.pdf',inhoudRevisie:3};assert.equal(bindingStatus(b,{document,schedule}),'current');
 assert.equal(bindingStatus(b,{document:{...document,filePath:'b.pdf'},schedule}),'source-unavailable');assert.equal(bindingStatus(b,{document:{...document,inhoudRevisie:4},schedule}),'stale');assert.equal(bindingStatus(b,{document,schedule:null}),'schedule-missing');assert.equal(bindingStatus(b,{document,schedule:{...schedule,name:'Changed'}}),'schedule-renamed');assert.equal(bindingStatus(b,{document,schedule,workbookExists:false}),'workbook-missing');
});
