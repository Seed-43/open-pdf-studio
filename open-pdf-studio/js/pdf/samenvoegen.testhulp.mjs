// Testhulp: kleine PDF's met alles wat samenvoegen mee moet nemen —
// annotaties met appearance, een antwoord (/IRT) met popup, een stempel met
// een beeld, formuliervelden, bladwijzers, koppelingen, benoemde
// bestemmingen, lagen, paginalabels, gedraaide pagina's en een handtekening.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef } from 'pdf-lib';

const N = (s) => PDFName.of(s);

function stroom(doc, inhoud, dict = {}) {
  return doc.context.register(doc.context.flateStream(inhoud, dict));
}

/** Een formulier-XObject als appearance van `breedte` x `hoogte`. */
function ap(doc, inhoud, breedte, hoogte, resources = {}) {
  return stroom(doc, inhoud, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, breedte, hoogte], Resources: resources });
}

function voegAnnotToe(doc, pagina, dict) {
  const ref = doc.context.register(doc.context.obj(dict));
  let annots = pagina.node.lookup(N('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = doc.context.obj([]);
    pagina.node.set(N('Annots'), annots);
  }
  annots.push(ref);
  return ref;
}

function lijst(doc, sleutel) {
  let d = doc.catalog.lookup(N(sleutel));
  if (!(d instanceof PDFDict)) {
    d = doc.context.obj({});
    doc.catalog.set(N(sleutel), doc.context.register(d));
  }
  return d;
}

function veld(doc, pagina, naam, waarde, rect) {
  const [x1, y1, x2, y2] = rect;
  const helv = acroForm(doc).lookup(N('DR')).lookup(N('Font')).get(N('Helv'));
  const look = ap(doc, `/Tx BMC BT /Helv 12 Tf 0 g 2 4 Td (${waarde}) Tj ET EMC`, x2 - x1, y2 - y1, { Font: { Helv: helv } });
  const ref = voegAnnotToe(doc, pagina, {
    Type: 'Annot', Subtype: 'Widget', FT: 'Tx', T: PDFString.of(naam), V: PDFString.of(waarde),
    DA: PDFString.of('/Helv 12 Tf 0 g'), Rect: rect, F: 4, P: pagina.ref, AP: { N: look },
  });
  acroForm(doc).lookup(N('Fields')).push(ref);
  return ref;
}

function acroForm(doc) {
  let af = doc.catalog.lookup(N('AcroForm'));
  if (!(af instanceof PDFDict)) {
    const helv = doc.context.register(doc.context.obj({
      Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
    }));
    af = doc.context.obj({ Fields: [], DR: { Font: { Helv: helv } }, DA: PDFString.of('/Helv 0 Tf 0 g') });
    doc.catalog.set(N('AcroForm'), doc.context.register(af));
  }
  return af;
}

function bladwijzers(doc, items) {
  // items: [{ titel, dest, kinderen? }] — dest: array of a naam (string)
  const root = doc.context.obj({ Type: 'Outlines' });
  const rootRef = doc.context.register(root);
  const maak = (lijstItems, ouderRef) => {
    const refs = lijstItems.map((it) => {
      const d = doc.context.obj({ Title: PDFHexString.fromText(it.titel), Parent: ouderRef });
      if (typeof it.dest === 'string') d.set(N('Dest'), PDFString.of(it.dest));
      else d.set(N('Dest'), doc.context.obj(it.dest));
      const ref = doc.context.register(d);
      return { ref, d, it };
    });
    refs.forEach((r, i) => {
      if (i > 0) r.d.set(N('Prev'), refs[i - 1].ref);
      if (i < refs.length - 1) r.d.set(N('Next'), refs[i + 1].ref);
      if (r.it.kinderen?.length) {
        const kids = maak(r.it.kinderen, r.ref);
        r.d.set(N('First'), kids[0].ref);
        r.d.set(N('Last'), kids[kids.length - 1].ref);
        r.d.set(N('Count'), doc.context.obj(kids.length));
      }
    });
    return refs;
  };
  const top = maak(items, rootRef);
  root.set(N('First'), top[0].ref);
  root.set(N('Last'), top[top.length - 1].ref);
  root.set(N('Count'), doc.context.obj(top.length + items.reduce((s, it) => s + (it.kinderen?.length || 0), 0)));
  doc.catalog.set(N('Outlines'), rootRef);
}

function benoemd(doc, paren) {
  // paren: [[naam, destArray]] — gesorteerd in de boom
  const names = lijst(doc, 'Names');
  const arr = [];
  for (const [naam, dest] of [...paren].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    arr.push(PDFString.of(naam), doc.context.obj(dest));
  }
  names.set(N('Dests'), doc.context.register(doc.context.obj({ Names: arr })));
}

function laag(doc, pagina, naam, { uit = false, eigenId = null } = {}) {
  const ocg = doc.context.register(doc.context.obj({
    Type: 'OCG', Name: PDFHexString.fromText(naam),
    ...(eigenId ? { OPS_LayerId: PDFString.of(eigenId) } : {}),
  }));
  let oc = doc.catalog.lookup(N('OCProperties'));
  if (!(oc instanceof PDFDict)) {
    oc = doc.context.obj({ OCGs: [], D: { Order: [], OFF: [] } });
    doc.catalog.set(N('OCProperties'), oc);
  }
  oc.lookup(N('OCGs')).push(ocg);
  const d = oc.lookup(N('D'));
  d.lookup(N('Order')).push(ocg);
  if (uit) d.lookup(N('OFF')).push(ocg);
  // In de inhoud van de pagina: een blauw vlak dat bij de laag hoort.
  const res = pagina.node.Resources();
  let props = res.lookup(N('Properties'));
  if (!(props instanceof PDFDict)) {
    props = doc.context.obj({});
    res.set(N('Properties'), props);
  }
  const sleutel = `oc${props.keys().length + 1}`;
  props.set(N(sleutel), ocg);
  const inhoud = stroom(doc, `/OC /${sleutel} BDC 0 0 1 rg 400 60 80 40 re f EMC`);
  pagina.node.addContentStream(inhoud);
  return ocg;
}

function inhoud(doc, pagina, tekst) {
  const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  pagina.node.Resources().set(N('Font'), doc.context.obj({ F1: font }));
  pagina.node.addContentStream(stroom(doc, `BT /F1 24 Tf 60 700 Td (${tekst}) Tj ET 0 0 0 RG 2 w 40 40 515 760 re S`));
}

function beeld(doc) {
  // 2x2 RGB-beeld voor een stempel.
  const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  return stroom(doc, pixels, { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
}

/**
 * Bron A: twee pagina's (de tweede gedraaid, met CropBox en UserUnit) met
 * markeringen, een notitie met antwoord en popup, een tekstvak, inkt, een
 * stempel, een eigen OPS_-sleutel, koppelingen (direct en benoemd), een
 * formulierveld `naam`, bladwijzers, een laag en paginalabels.
 */
export async function bronA() {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  inhoud(doc, p1, 'Bron A blad 1');
  inhoud(doc, p2, 'Bron A blad 2');
  p2.node.set(N('Rotate'), doc.context.obj(90));
  p2.node.set(N('CropBox'), doc.context.obj([10, 10, 585, 832]));
  p2.node.set(N('UserUnit'), doc.context.obj(2));

  // Rechthoek met appearance, kleur en eigen sleutel.
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Square', Rect: [100, 500, 250, 600], C: [1, 0, 0], BS: { W: 2 },
    NM: PDFString.of('a-vierkant'), T: PDFString.of('Ann'), Contents: PDFString.of('vierkant'),
    OPS_HatchPattern: PDFString.of('diagonal-left'), OPS_HatchColor: PDFString.of('#ff0000'),
    AP: { N: ap(doc, '1 0 0 RG 2 w 1 1 148 98 re S', 150, 100) },
  });
  // Notitie met popup en een antwoord dat er met /IRT naar wijst.
  const notitie = voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], C: [1, 1, 0], Name: 'Comment',
    NM: PDFString.of('a-notitie'), T: PDFString.of('Ann'), Contents: PDFString.of('vraag'),
  });
  const popup = voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Popup', Rect: [320, 600, 500, 700], Parent: notitie, Open: false,
  });
  doc.context.lookup(notitie).set(N('Popup'), popup);
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], C: [1, 1, 0], Name: 'Comment',
    NM: PDFString.of('a-antwoord'), T: PDFString.of('Bob'), Contents: PDFString.of('antwoord'),
    IRT: notitie, RT: 'R',
  });
  // Tekstvak.
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'FreeText', Rect: [100, 300, 300, 340], DA: PDFString.of('/Helv 12 Tf 0 0 1 rg'),
    NM: PDFString.of('a-tekstvak'), Contents: PDFString.of('Tekst in bron A'),
    AP: { N: ap(doc, 'BT /Helv 12 Tf 0 0 1 rg 2 14 Td (Tekst in bron A) Tj ET', 200, 40) },
  });
  // Inkt.
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Ink', Rect: [100, 100, 200, 200], C: [0, 0.5, 0], BS: { W: 3 },
    NM: PDFString.of('a-inkt'), InkList: [[110, 110, 150, 190, 190, 110]],
    AP: { N: ap(doc, '0 0.5 0 RG 3 w 10 10 m 50 90 l 90 10 l S', 100, 100) },
  });
  // Stempel met een beeld in de appearance.
  const img = beeld(doc);
  voegAnnotToe(doc, p2, {
    Type: 'Annot', Subtype: 'Stamp', Rect: [200, 200, 300, 300], Name: 'Approved',
    NM: PDFString.of('a-stempel'),
    AP: { N: ap(doc, 'q 100 0 0 100 0 0 cm /Im0 Do Q', 100, 100, { XObject: { Im0: img } }) },
  });
  // Koppelingen: direct naar blad 2 en via de benoemde bestemming 'kaart'.
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Link', Rect: [60, 650, 200, 680], Border: [0, 0, 0],
    Dest: [p2.ref, N('XYZ'), 0, 800, null],
  });
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Link', Rect: [60, 600, 200, 630], Border: [0, 0, 0],
    A: { S: 'GoTo', D: PDFString.of('kaart') },
  });
  benoemd(doc, [['kaart', [p2.ref, N('Fit')]], ['start', [p1.ref, N('Fit')]]]);

  acroForm(doc);
  veld(doc, p1, 'naam', 'Bron A', [100, 400, 300, 430]);

  bladwijzers(doc, [
    { titel: 'Hoofdstuk A', dest: [p1.ref, N('XYZ'), 0, 842, null], kinderen: [{ titel: 'Kaart A', dest: 'kaart' }] },
  ]);
  laag(doc, p1, 'Wanden', { uit: true });
  doc.catalog.set(N('PageLabels'), doc.context.obj({
    Nums: [0, { S: 'D', P: PDFString.of('A-'), St: 1 }, 1, { S: 'r', St: 1 }],
  }));
  return doc.save();
}

/**
 * Bron B: één pagina met een stempel, een veld `naam` (botst met A), een
 * benoemde bestemming `kaart` (botst met A), een laag `Wanden` (botst met A),
 * een bladwijzer en een ondertekend handtekeningveld.
 */
export async function bronB({ handtekening = true } = {}) {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([842, 595]);
  inhoud(doc, p1, 'Bron B blad 1');
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 200], C: [0, 0, 1],
    NM: PDFString.of('b-vierkant'), Contents: PDFString.of('blauw'),
    AP: { N: ap(doc, '0 0 1 RG 1 1 98 98 re S', 100, 100) },
  });
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Link', Rect: [60, 500, 200, 530], Border: [0, 0, 0], Dest: PDFString.of('kaart'),
  });
  benoemd(doc, [['kaart', [p1.ref, N('XYZ'), 0, 595, null]]]);
  acroForm(doc);
  veld(doc, p1, 'naam', 'Bron B', [300, 300, 500, 330]);
  if (handtekening) {
    const sig = voegAnnotToe(doc, p1, {
      Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('handtekening'), Rect: [0, 0, 0, 0], F: 132, P: p1.ref,
      V: {
        Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
        ByteRange: [0, 100, 200, 300], Contents: PDFHexString.of('00'.repeat(32)), M: PDFString.of('D:20260101000000Z'),
      },
    });
    acroForm(doc).lookup(N('Fields')).push(sig);
    acroForm(doc).set(N('SigFlags'), doc.context.obj(3));
  }
  bladwijzers(doc, [{ titel: 'Hoofdstuk B', dest: 'kaart' }]);
  laag(doc, p1, 'Wanden');
  return doc.save();
}

/** Het doeldocument: één pagina met een eigen veld `naam` en een bladwijzer. */
export async function doel() {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([595, 842]);
  inhoud(doc, p1, 'Doel blad 1');
  voegAnnotToe(doc, p1, {
    Type: 'Annot', Subtype: 'Circle', Rect: [100, 100, 200, 200], C: [0, 1, 0],
    NM: PDFString.of('d-cirkel'),
    AP: { N: ap(doc, '0 1 0 RG 50 1 m 99 50 l 50 99 l 1 50 l h S', 100, 100) },
  });
  acroForm(doc);
  veld(doc, p1, 'naam', 'Doel', [100, 400, 300, 430]);
  bladwijzers(doc, [{ titel: 'Doel', dest: [p1.ref, N('Fit')] }]);
  return doc.save();
}

/** De (gedecodeerde) /Subtype van de annotaties per pagina. */
export function annotatiesPerPagina(doc) {
  return doc.getPages().map((p) => {
    const annots = p.node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) return [];
    return annots.asArray().map((r) => doc.context.lookup(r)?.get(N('Subtype'))?.toString().slice(1));
  });
}

export { N, PDFRef };
