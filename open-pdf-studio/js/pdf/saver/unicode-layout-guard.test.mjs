import test from 'node:test';
import assert from 'node:assert/strict';
import {withUnicodeLayoutGuard,UnicodeLayoutError} from './unicode-layout-guard.js';
const make=(glyphs,has=()=>true)=>withUnicodeLayoutGuard({create:()=>({hasGlyphForCodePoint:has,layout:()=>({glyphs,positions:[{xAdvance:20}]})})}).create(new Uint8Array());
test('valid shaped runs preserve glyphs and positions without replacing Unicode',()=>{
 const glyphs=[{id:4,codePoints:[0x66,0x69]}];const run=make(glyphs).layout('fi');
 assert.equal(run.glyphs,glyphs);assert.equal(run.positions[0].xAdvance,20);
});
test('reject missing characters, .notdef and unassigned components',()=>{
 assert.throws(()=>make([],()=>false).layout('中'), e=>e instanceof UnicodeLayoutError&&e.code==='PDF_MISSING_GLYPH');
 assert.throws(()=>make([{id:0,codePoints:[65]}]).layout('A'),/PDF_MISSING_GLYPH/);
 assert.throws(()=>make([{id:3,codePoints:[]}]).layout('ع'),/PDF_UNMAPPED_SHAPED_GLYPH/);
});
