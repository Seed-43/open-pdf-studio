import test from 'node:test';
import assert from 'node:assert/strict';
import {collectZones,locationFor,containsPoint,zoneDefinition} from './spatial-zones.js';
const zone=(id,name,parentId='',x=0,size=100)=>({type:'box',page:1,x,y:0,width:size,height:size,spatialZone:{version:1,id,name,parentId}});
const point=(x,y)=>({x,y,width:0,height:0});
test('nested paths, movement and boundaries use deepest/smallest zone',()=>{
 const outer=zone('a','Floor'),inner=zone('b','Room','a',10,20),ann={page:1};
 assert.equal(locationFor(ann,collectZones([outer,inner]),point(10,10)).path,'Floor / Room');
 assert.equal(locationFor(ann,collectZones([outer,inner]),point(90,90)).path,'Floor');
 inner.x=150;
 assert.equal(locationFor(ann,collectZones([outer,inner]),point(10,10)).path,'Floor');
});
test('overlaps break ties by stable identity; page and manual override are explicit',()=>{
 const zones=collectZones([zone('b','B'),zone('a','A')]);
 assert.equal(locationFor({page:1},zones,point(50,50)).path,'A');
 assert.equal(locationFor({page:2},zones,point(50,50)).source,'none');
 assert.deepEqual(locationFor({page:1,locationOverride:''},zones,point(50,50)),{path:'',source:'manual',zoneId:null});
});
test('cyclic, missing and duplicate identities cannot silently assign a location',()=>{
 const zones=collectZones([zone('a','A','b'),zone('b','B','a'),zone('c','C','missing'),zone('d','D'),zone('d','Duplicate')]);
 assert.ok(zones.every(z=>!z.valid));
});
test('concave polygons use real containment and include edges',()=>{
 const p=[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:5,y:5},{x:5,y:10},{x:0,y:10}];
 assert.equal(containsPoint(p,{x:8,y:8}),false);
 assert.equal(containsPoint(p,{x:5,y:8}),true);
 assert.equal(zoneDefinition({version:99,id:'a',name:'bad'}),null);
});

import { PDFDocument, PDFName } from 'pdf-lib';
import { schrijfAlgemeneSleutels } from '../pdf/saver/annotatie-algemeen.js';
import { extractAnnotationColors } from '../pdf/loader/color-extraction.js';
import { algemeneEigenschappen } from '../pdf/loader/annotatie-algemeen.js';
test('real PDF save/reopen preserves Unicode hierarchy and explicit empty override',async()=>{
 const pdf=await PDFDocument.create();const page=pdf.addPage();
 const a=zone('room','Verdieping / 房間','floor');a.locationOverride='';
 const dict=pdf.context.obj({Type:'Annot',Subtype:'Square',Rect:[0,0,100,100]});
 schrijfAlgemeneSleutels(dict,a);
 page.node.set(PDFName.of('Annots'),pdf.context.obj([pdf.context.register(dict)]));
 const reopened=await PDFDocument.load(await pdf.save());
 const colors=await extractAnnotationColors(1,reopened);
 const restored=algemeneEigenschappen(colors.get('0,0,100,100'),{type:'box'});
 assert.deepEqual(restored.spatialZone,a.spatialZone);assert.equal(restored.locationOverride,'');
 assert.equal(algemeneEigenschappen({},{}).locationOverride,undefined);
});
import {relinkCopiedZones} from './spatial-zones.js';
import {buildSchedule} from '../quantities/engine.js';
test('copying a subtree remaps zone identities; a lone child detaches',()=>{
 const sources=[zone('a','Floor'),zone('b','Room','a')];
 const copies=sources.map((z,i)=>({...z,id:'copy'+i}));
 relinkCopiedZones(sources,copies);
 assert.equal(copies[1].spatialZone.parentId,copies[0].spatialZone.id);
 assert.notEqual(copies[0].spatialZone.id,'a');
 const single=[{...sources[1],id:'single'}];relinkCopiedZones([sources[1]],single);
 assert.equal(single[0].spatialZone.parentId,'');
});
test('schedule can filter/group/export computed and manual locations',()=>{
 const rows=[{type:'box',id:'a',page:1,__location:{path:'Floor / Room',source:'computed'}},
 {type:'box',id:'b',page:1,__location:{path:'Site',source:'manual'}}];
 const r=buildSchedule(rows,{categories:['area'],fields:['location','locationSource'],filters:[{field:'location',op:'=',value:'Site'}]});
 assert.equal(r.count,1);
 assert.equal(r.groups[0].rows[0].vals.locationSource,'manual');
});
