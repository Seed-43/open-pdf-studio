// ruimOngebruikteObjectenOp: onbereikbare objecten weg, nieuwe objecten op
// de vrijgekomen nummers, bestaande objecten en hangende verwijzingen ongemoeid.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFString } from 'pdf-lib';

import { ruimOngebruikteObjectenOp } from './objecten-opruimen.js';

const N = (s) => PDFName.of(s);

/** Een blad met drie annotaties; geeft ook hun refs terug. */
async function bron() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([200, 200]);
  const ctx = doc.context;
  const refs = [1, 2, 3].map((i) => {
    const ap = ctx.register(ctx.stream(`0 0 ${i} ${i} re f`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, i, i] }));
    return ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [0, 0, i, i], AP: { N: ap } }));
  });
  p.node.set(N('Annots'), ctx.obj(refs));
  return PDFDocument.load(await doc.save({ useObjectStreams: false }));
}

const annots = (doc) => doc.getPage(0).node.lookup(N('Annots'), PDFArray);
const nummers = (doc) => doc.context.enumerateIndirectObjects().map(([r]) => r.objectNumber);

test('vervangen annotaties en hun appearances verdwijnen, nieuwe nemen hun nummers', async () => {
  const doc = await bron();
  const ctx = doc.context;
  const grens = ctx.largestObjectNumber;
  const voor = nummers(doc);
  const oudeAnnots = annots(doc).asArray();

  // Zoals de saver: oude annotaties uit /Annots, nieuwe uit het model erbij.
  const nieuw = [1, 2, 3].map((i) => {
    const ap = ctx.register(ctx.stream(`0 0 ${i} ${i} re S`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, i, i] }));
    return ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [0, 0, i, i], AP: { N: ap } }));
  });
  doc.getPage(0).node.set(N('Annots'), ctx.obj(nieuw));

  const r = ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  assert.equal(r.verwijderd, 6, 'drie annotaties en drie appearances weg');
  assert.equal(r.hernummerd, 6);
  assert.deepEqual(nummers(doc), voor, 'precies dezelfde nummers als vóór de save');
  assert.ok(ctx.largestObjectNumber <= grens, '/Size groeit niet');
  for (const ref of oudeAnnots) assert.equal(ctx.lookup(ref)?.get(N('Subtype'))?.toString(), '/Circle');

  // Elke verwijzing wijst naar een bestaand object van de goede soort.
  for (const ref of annots(doc).asArray()) {
    const d = ctx.lookup(ref, PDFDict);
    assert.equal(d.get(N('Subtype')).toString(), '/Circle');
    const ap = d.lookup(N('AP'), PDFDict).get(N('N'));
    assert.ok(ap instanceof PDFRef && ctx.lookup(ap)?.dict.get(N('Subtype')).toString() === '/Form');
  }
  const opnieuw = await PDFDocument.load(await doc.save());
  assert.equal(annots(opnieuw).size(), 3);
});

test('bestaande objecten houden hun nummer, ook als er gaten voor liggen', async () => {
  const doc = await bron();
  const ctx = doc.context;
  const grens = ctx.largestObjectNumber;
  const [eerste, tweede, derde] = annots(doc).asArray();
  // Alleen de eerste vervangen: de andere twee moeten blijven waar ze staan.
  const nieuw = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [0, 0, 9, 9] }));
  doc.getPage(0).node.set(N('Annots'), ctx.obj([nieuw, tweede, derde]));
  ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  assert.equal(ctx.lookup(tweede).get(N('Subtype')).toString(), '/Square');
  assert.equal(ctx.lookup(derde).get(N('Subtype')).toString(), '/Square');
  const [nieuwRef] = annots(doc).asArray();
  assert.ok(nieuwRef.objectNumber <= grens, `nieuw object op een vrij nummer (${nieuwRef.objectNumber})`);
  assert.notEqual(nieuwRef.objectNumber, tweede.objectNumber);
  assert.notEqual(nieuwRef.objectNumber, derde.objectNumber);
  assert.equal(ctx.lookup(eerste) === undefined || nieuwRef.objectNumber === eerste.objectNumber, true,
    'het oude nummer is leeg of draagt nu het nieuwe object');
});

test('een nummer met een hangende verwijzing wordt niet hergebruikt', async () => {
  const doc = await bron();
  const ctx = doc.context;
  const [eerste, ...rest] = annots(doc).asArray();
  // De eerste annotatie verdwijnt, maar de catalogus wijst er nog (hangend) naar.
  const apRef = ctx.lookup(eerste).lookup(N('AP'), PDFDict).get(N('N'));
  ctx.delete(eerste);
  ctx.delete(apRef);
  doc.catalog.set(N('OPS_Test'), eerste);
  doc.getPage(0).node.set(N('Annots'), ctx.obj(rest));
  const grens = ctx.largestObjectNumber;
  const nieuw = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [0, 0, 9, 9] }));
  doc.getPage(0).node.set(N('Annots'), ctx.obj([nieuw, ...rest]));
  ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  const [nieuwRef] = annots(doc).asArray();
  assert.notEqual(nieuwRef.objectNumber, eerste.objectNumber, 'het hangende nummer blijft vrij');
  assert.equal(nieuwRef.objectNumber, apRef.objectNumber, 'het vrije nummer van de appearance wel');
  assert.equal(ctx.lookup(eerste), undefined);
});

test('een nieuw /Info-woordenboek verhuist mee in de trailer', async () => {
  const doc = await bron();
  const ctx = doc.context;
  const grens = ctx.largestObjectNumber;
  annots(doc).asArray().forEach((r) => ctx.delete(r));
  doc.getPage(0).node.delete(N('Annots'));
  ctx.trailerInfo.Info = ctx.register(ctx.obj({ Title: PDFString.of('Nieuw') }));
  ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  assert.ok(ctx.trailerInfo.Info.objectNumber <= grens);
  assert.equal(ctx.lookup(ctx.trailerInfo.Info).get(N('Title')).decodeText(), 'Nieuw');
  const opnieuw = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  assert.equal(opnieuw.getTitle(), 'Nieuw');
});

test('versleuteld: wel opruimen, niet hernummeren', async () => {
  const doc = await bron();
  const ctx = doc.context;
  const grens = ctx.largestObjectNumber;
  const nieuw = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [0, 0, 9, 9] }));
  doc.getPage(0).node.set(N('Annots'), ctx.obj([nieuw]));
  ctx.trailerInfo.Encrypt = ctx.register(ctx.obj({ Filter: N('Standard') }));
  const r = ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  assert.equal(r.verwijderd, 6);
  assert.equal(r.hernummerd, 0);
  assert.equal(annots(doc).get(0), nieuw);
});

// Pagina's die één indirect /Resources-woordenboek delen: pdf-lib zet dat
// woordenboek bij het normaliseren ook rechtstreeks in de pagina. Dezelfde
// instantie staat dan meerdere keren in de context. Werd hij per vindplaats
// opnieuw omgenummerd, dan schoof een verwijzing langs de hele keten (532 →
// 531 → 530 → 3) en wees het lettertype van een tekstbewerking ineens naar
// een inhoudsstroom: de tekst kwam in een vervangend font terug.
test('een gedeeld woordenboek wordt maar één keer omgenummerd', async () => {
  const src = await PDFDocument.create();
  const res = src.context.register(src.context.obj({ Font: src.context.obj({}) }));
  const lengte = src.context.register(src.context.obj(5));
  for (let i = 0; i < 3; i++) {
    const p = src.addPage([200, 200]);
    p.node.set(N('Resources'), res);
  }
  const stroom = src.context.flateStream('BT ET');
  stroom.dict.set(N('Length'), lengte);
  src.getPage(0).node.set(N('Contents'), src.context.register(stroom));
  const doc = await PDFDocument.load(await src.save({ useObjectStreams: false }));
  const grens = doc.context.largestObjectNumber;
  const pagina = doc.getPage(0);
  // Zoals de in-place-knip: de eerste inhoudsstroom vervangen, zodat zijn
  // /Length-object vrijkomt. Daarna nieuwe tekst met een nieuw lettertype.
  pagina.node.normalize();
  pagina.node.Contents().set(0, doc.context.register(doc.context.flateStream('BT ET')));
  const { StandardFonts } = await import('pdf-lib');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pagina.drawText('Hallo', { x: 10, y: 10, size: 12, font });
  await doc.flush();
  ruimOngebruikteObjectenOp(doc, { nieuwVanaf: grens });
  const opnieuw = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
  const fonts = opnieuw.getPage(0).node.Resources().lookup(N('Font'), PDFDict);
  for (const [naam, ref] of fonts.entries()) {
    const o = opnieuw.context.lookup(ref);
    assert.ok(o instanceof PDFDict, `${naam} wijst naar ${o?.constructor?.name}`);
    assert.equal(String(o.get(N('Type'))), '/Font', `${naam} is geen lettertype`);
  }
  for (const ref of opnieuw.getPage(0).node.Contents().asArray()) {
    assert.equal(opnieuw.context.lookup(ref)?.constructor?.name, 'PDFRawStream', `${ref} is geen inhoudsstroom`);
  }
});
