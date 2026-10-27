// #698: de tekst-editors volgen de vulling van het vak (doorzichtig zonder
// vulling) en krijgen een caret die afsteekt tegen de ondergrond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  editorAchtergrond, caretKleur, parseKleur, luminantie, meetOndergrond,
} from './editor-ondergrond.js';

const lees = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('zonder vulling is de editor doorzichtig, met vulling volgt hij de vulling', () => {
  for (const geen of [undefined, null, '', 'none', 'transparent']) {
    assert.equal(editorAchtergrond(geen), 'transparent', `vulling ${geen}`);
  }
  assert.equal(editorAchtergrond('#3b1f5e'), '#3b1f5e');
  assert.equal(editorAchtergrond('#ffffff'), '#ffffff');
});

test('kleuren lezen: hex kort en lang, rgb(a); de rest is onbekend', () => {
  assert.deepEqual(parseKleur('#fff'), [255, 255, 255]);
  assert.deepEqual(parseKleur('#3B1F5E'), [59, 31, 94]);
  assert.deepEqual(parseKleur('#3b1f5e80'), [59, 31, 94]);
  assert.deepEqual(parseKleur('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.deepEqual(parseKleur('rgba(10,20,30,0.5)'), [10, 20, 30]);
  assert.equal(parseKleur('none'), null);
  assert.equal(parseKleur(undefined), null);
  assert.equal(luminantie([0, 0, 0]), 0);
  assert.ok(Math.abs(luminantie([255, 255, 255]) - 1) < 1e-12);
});

test('caret: tegen de vulling, anders tegen de gemeten ondergrond, anders de tekstkleur', () => {
  // Donkerpaarse vulling met witte tekst: witte caret.
  assert.equal(caretKleur({ fillColor: '#3b1f5e', tekstKleur: '#ffffff' }), '#ffffff');
  // Lichte vulling: zwarte caret, ook als de tekst wit is.
  assert.equal(caretKleur({ fillColor: '#ffff00', tekstKleur: '#ffffff' }), '#000000');
  // Geen vulling, donkere ondergrond gemeten: witte caret.
  assert.equal(caretKleur({ fillColor: 'none', ondergrond: 0.02, tekstKleur: '#ffffff' }), '#ffffff');
  // Geen vulling, witte pagina: zwarte caret, ook bij witte tekst.
  assert.equal(caretKleur({ fillColor: 'none', ondergrond: 1, tekstKleur: '#ffffff' }), '#000000');
  // Niets gemeten: de tekstkleur (gedrag van de browser).
  assert.equal(caretKleur({ ondergrond: null, tekstKleur: '#ff0000' }), '#ff0000');
  assert.equal(caretKleur({}), '#000000');
});

// Nep-DOM: canvassen met één kleur per canvas, gestapeld van boven naar onder.
function nepDocument(lagen) {
  const proefCtx = {
    _bron: null,
    clearRect() { this._bron = null; },
    drawImage(bron) { this._bron = bron; },
    getImageData() { return { data: this._bron ? this._bron._pixel : [0, 0, 0, 0] }; },
  };
  return {
    createElement: () => ({ width: 0, height: 0, getContext: () => proefCtx }),
    elementsFromPoint: (x, y) => lagen.filter(l => l.raak(x, y)),
  };
}
function nepCanvas(pixel, raak = () => true) {
  return {
    tagName: 'CANVAS', width: 100, height: 100, _pixel: pixel, raak,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
}

test('ondergrond meten: het bovenste niet-doorzichtige canvas telt', () => {
  const overlay = nepCanvas([0, 0, 0, 0]); // doorzichtige annotatielaag
  const pagina = nepCanvas([40, 20, 70, 255]); // donkerpaarse kop
  const lum = meetOndergrond({ left: 10, top: 10, width: 50, height: 20 }, nepDocument([overlay, pagina]));
  assert.ok(lum < 0.05, `luminantie ${lum}`);
});

test('ondergrond meten: de mediaan negeert de letters die nog op het canvas staan', () => {
  // Een kwart van de meetpunten valt op witte letters (x < 22), de rest op donker.
  const letters = nepCanvas([255, 255, 255, 255], (x) => x < 22);
  const pagina = nepCanvas([30, 30, 30, 255]);
  const lum = meetOndergrond({ left: 10, top: 10, width: 50, height: 20 }, nepDocument([letters, pagina]));
  assert.ok(lum < 0.05, `luminantie ${lum}`);
});

test('ondergrond meten: zonder canvas geldt het wit van de pagina; zonder rechthoek niets', () => {
  assert.equal(meetOndergrond({ left: 0, top: 0, width: 10, height: 10 }, nepDocument([])), 1);
  assert.equal(meetOndergrond({ left: 0, top: 0, width: 0, height: 10 }, nepDocument([])), null);
  assert.equal(meetOndergrond(null, nepDocument([])), null);
});

// ── Bronwachters: de editors nemen hun achtergrond niet meer hard wit ──

test('tekstvak-editor: achtergrond en caret uit de annotatie, geen vast wit', () => {
  const src = lees('./text-editing.js');
  assert.match(src, /'background-color':\s*editorAchtergrond\(annotation\.fillColor\)/);
  assert.match(src, /'caret-color':\s*caretKleur\(/);
  assert.doesNotMatch(src, /'background-color':[^\n]*'#ffffff'/);
});

test('PDF-tekstbewerking: editor doorzichtig, caret afgestemd, canvas dekt af', () => {
  const css = lees('../../styles/layout.css');
  const blok = css.slice(css.indexOf('.pdf-text-editor {'));
  const regels = blok.slice(0, blok.indexOf('}'));
  assert.match(regels, /background:\s*transparent/);
  assert.doesNotMatch(regels, /background:\s*#fff/i);
  const tool = lees('./text-edit-tool.js');
  assert.equal((tool.match(/= pdfEditorCaret\(styleObj\)/g) || []).length, 2, 'beide editors');
  assert.equal((tool.match(/meldEditorOpCanvas\(pageNum/g) || []).length, 2, 'beide editors');
  assert.doesNotMatch(tool.replace(/function verbergPdfEditor\(\) \{[^}]*\}/, ''), /hidePdfTextEditor\(\)/,
    'elke sluiting meldt het canvas af');
});

test('canvas: tekst van het vak in de editor wordt niet getekend, alleen op het scherm', () => {
  const r = lees('../annotations/rendering.js');
  assert.equal((r.match(/if \(!tekstInEditor\(annotation\)\) drawTextboxContent\(ctx, annotation\);/g) || []).length, 2,
    'tekstvak en toelichting');
  assert.match(r, /function tekstInEditor\(annotation\) \{\s*if \(_lagen \|\| !state\.isEditingText\) return false;/);
  assert.match(r, /function tekstEditorOpCanvas\(pageNum\) \{\s*if \(_lagen\) return null;/);
  assert.match(r, /const newLines = inEditor \? \[\] :/);
});
