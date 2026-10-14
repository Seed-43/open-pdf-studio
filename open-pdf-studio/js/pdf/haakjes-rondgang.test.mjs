// Opslaan en heropenen van tekst met losse haakjes (#555), met de echte saver.
//
// Genummerde opmerkingen als '1) eerste' schreef de saver als literal string
// zonder escapes: '/Contents (1) eerste)' sluit na '1'. De rest van het
// woordenboek is dan ongeldig en omdat de annotatie in een objectstroom staat,
// raakt de lezer ook de objecten erna in diezelfde stroom kwijt. Een backslash
// vlak voor een haakje of aan het eind breekt de string op dezelfde manier.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { decodePdfTextObject } from './saver/pdf-text.js';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

/** Opslaan met de echte saver, op de bytes van het geopende bestand. */
async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'haakjes', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

/** pdf.js-annotaties van blad 1 en de modellen zoals js/pdf/loader.js ze maakt. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const annots = await pagina.getAnnotations();
  const modellen = [];
  for (const annot of annots) modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  await doc.loadingTask.destroy();
  return { annots, modellen };
}

const basis = {
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', fillColor: null, textColor: '#000000',
  lineWidth: 1, borderStyle: 'solid', opacity: 1,
};
const tekstvak = (id, y, text, author = 'User') => ({
  ...basis, id, type: 'textbox', x: 60, y, width: 220, height: 60, text, author,
  fontSize: 12, fontFamily: 'Arial', textPadding: 3,
});

// Elk geval naast gewone annotaties, zodat ook de buren in de objectstroom
// gecontroleerd worden.
const MODELLEN = [
  tekstvak('voor', 40, 'gewoon tekstvak ervoor'),
  tekstvak('genummerd', 140, '1) a\n\n2) b'),
  { ...basis, id: 'notitie', type: 'comment', x: 400, y: 60, text: '(concept', author: 'Piet (PL' },
  tekstvak('backslash', 240, 'map C:\\temp\\(oud) en pad C:\\', 'x)'),
  { ...basis, id: 'kader', type: 'box', x: 60, y: 340, width: 100, height: 50, subject: ')( omgekeerd' },
  tekstvak('gebalanceerd', 420, 'f(x) = (a)'),
  tekstvak('na', 520, 'gewoon tekstvak erna'),
];

test('tekst met losse haakjes of een backslash voor een haakje maakt het bestand niet stuk (#555)', async () => {
  const bytes = await opslaan(await leegBlad(), MODELLEN);
  const latin1 = Buffer.from(bytes).toString('latin1');
  assert.match(latin1, /\/Type\s*\/ObjStm/, 'de annotaties staan in een objectstroom');

  // pdf-lib: geen enkel ongeldig object, alle annotaties aanwezig.
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const ctx = doc.context;
  const subtypes = doc.getPage(0).node.Annots().asArray()
    .map((ref) => ctx.lookup(ref).get(PDFName.of('Subtype'))?.toString());
  assert.equal(subtypes.filter((s) => s === '/FreeText').length, 5, `FreeTexts in ${subtypes}`);
  assert.ok(subtypes.includes('/Text'), `notitie in ${subtypes}`);
  assert.ok(subtypes.includes('/Square'), `kader in ${subtypes}`);

  // pdf.js (andere lezers): elke annotatie met precies zijn tekst.
  const { annots, modellen } = await laad(bytes);
  const inhoud = (subtype) => annots.filter((a) => a.subtype === subtype).map((a) => a.contentsObj?.str);
  assert.deepEqual(inhoud('FreeText').sort(), [
    'gewoon tekstvak ervoor', '1) a\n\n2) b', 'map C:\\temp\\(oud) en pad C:\\', 'f(x) = (a)', 'gewoon tekstvak erna',
  ].sort());
  assert.deepEqual(inhoud('Text'), ['(concept']);
  assert.deepEqual(inhoud('Square'), [')( omgekeerd']);
  const notitie = annots.find((a) => a.subtype === 'Text');
  assert.equal(notitie.titleObj?.str, 'Piet (PL');
  const backslash = annots.find((a) => a.contentsObj?.str?.startsWith('map '));
  assert.equal(backslash?.titleObj?.str, 'x)');

  // De app zelf: dezelfde teksten terug in de modellen.
  const teksten = modellen.filter((m) => m?.type === 'textbox').map((m) => m.text);
  assert.ok(teksten.includes('1) a\n\n2) b'), `tekstvakken: ${JSON.stringify(teksten)}`);
  assert.ok(teksten.includes('map C:\\temp\\(oud) en pad C:\\'), `tekstvakken: ${JSON.stringify(teksten)}`);
  assert.ok(teksten.includes('f(x) = (a)'), `tekstvakken: ${JSON.stringify(teksten)}`);
  assert.equal(modellen.find((m) => m?.type === 'comment')?.text, '(concept');
  assert.equal(modellen.find((m) => m?.type === 'comment')?.author, 'Piet (PL');
});

test('een fontnaam met een haakje maakt /DA niet stuk (#555)', async () => {
  // De fontnaam komt uit de systeemfonts of uit /DS van een ander bestand en
  // staat als naam in /DA. Een los haakje sloot die literal string te vroeg.
  const modellen = [
    tekstvak('voor', 40, 'ervoor'),
    { ...tekstvak('font', 140, 'tekst'), fontFamily: 'Foo (Bar' },
    { ...tekstvak('font2', 240, 'tekst 2'), fontFamily: 'Baz) Qux\\' },
    tekstvak('na', 340, 'erna'),
  ];
  const bytes = await opslaan(await leegBlad(), modellen);
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const ctx = doc.context;
  const da = doc.getPage(0).node.Annots().asArray()
    .map((ref) => ctx.lookup(ref).get(PDFName.of('DA'))?.decodeText());
  assert.ok(da.some((s) => /\/Foo#28Bar 12 Tf/.test(s)), `DA: ${JSON.stringify(da)}`);
  const { annots, modellen: terug } = await laad(bytes);
  assert.deepEqual(annots.map((a) => a.contentsObj?.str).sort(), ['erna', 'ervoor', 'tekst', 'tekst 2']);
  // De fontnaam zelf reist mee in /DS.
  assert.deepEqual(terug.map((m) => m.fontFamily).sort(), ['Arial', 'Arial', 'Baz) Qux\\', 'Foo (Bar']);
});

test('een onbekende lijnkop met een haakje maakt /OPS_LineHeads niet stuk (#555)', async () => {
  // XFDF-import neemt head/tail ongecontroleerd over; koppenSleutel geeft een
  // kop die /LE niet kent ongewijzigd door aan /OPS_LineHeads.
  const pijl = (id, y, startHead, endHead, subject) => ({
    ...basis, id, type: 'arrow', startX: 60, startY: y, endX: 260, endY: y, startHead, endHead, subject,
  });
  const modellen = [
    tekstvak('voor', 40, 'ervoor'),
    pijl('kapot', 140, 'x)', 'open', 'pijl'),
    {
      ...basis, id: 'spline', type: 'splineArrow', startHead: 'none', endHead: '(y', subject: 'spline',
      points: [{ x: 60, y: 200 }, { x: 160, y: 240 }, { x: 260, y: 200 }],
    },
    pijl('stealth', 300, 'stealth', 'open', 'stealth'),
    tekstvak('na', 400, 'erna'),
  ];
  const bytes = await opslaan(await leegBlad(), modellen);
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  const ctx = doc.context;
  const koppen = doc.getPage(0).node.Annots().asArray()
    .map((ref) => ctx.lookup(ref).get(PDFName.of('OPS_LineHeads')))
    .filter(Boolean);
  assert.deepEqual(koppen.map((k) => decodePdfTextObject(k)).sort(), ['none,(y', 'stealth,open', 'x),open']);
  // Een gewone sleutel blijft dezelfde literal string als voorheen.
  const stealth = koppen.find((k) => decodePdfTextObject(k) === 'stealth,open');
  assert.ok(stealth instanceof PDFString, 'stealth-sleutel als PDFString');

  const { annots, modellen: terug } = await laad(bytes);
  assert.deepEqual(annots.map((a) => a.contentsObj?.str).sort(), ['erna', 'ervoor', 'pijl', 'spline', 'stealth']);
  assert.equal(terug.find((m) => m?.subject === 'stealth')?.startHead, 'stealth');
});

test('opslaan van het heropende bestand blijft heel (#555)', async () => {
  // Elke volgende opslag schreef weer kapotte stromen: sla het resultaat
  // opnieuw op met de modellen zoals de app ze terugleest.
  const eerste = await opslaan(await leegBlad(), MODELLEN);
  const { modellen } = await laad(eerste);
  const tweede = await opslaan(eerste, modellen.filter(Boolean));
  await PDFDocument.load(tweede, { throwOnInvalidObject: true });
  const { annots } = await laad(tweede);
  const teksten = annots.map((a) => a.contentsObj?.str);
  for (const verwacht of ['1) a\n\n2) b', '(concept', ')( omgekeerd', 'map C:\\temp\\(oud) en pad C:\\']) {
    assert.ok(teksten.includes(verwacht), `${JSON.stringify(verwacht)} in ${JSON.stringify(teksten)}`);
  }
});
