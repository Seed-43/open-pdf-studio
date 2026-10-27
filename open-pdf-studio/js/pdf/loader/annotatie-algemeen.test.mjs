// Gedeelde annotatie-eigenschappen bij laden en opslaan (#619): naam,
// onderwerp, alternatieve tekst, IFC-categorie, antwoorden en koppelingen.
// Zie loader/annotatie-algemeen.js en saver/annotatie-algemeen.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { algemeneEigenschappen, eigenAntwoordUitAnnot, koppelAntwoorden } from './annotatie-algemeen.js';
import { onderwerpPlek } from './annotatie-opmerking.js';
import { schrijfAlgemeneSleutels, antwoordAnnotaties, schrijfKoppelingen } from '../saver/annotatie-algemeen.js';
import { decodePdfTextObject } from '../saver/pdf-text.js';

const N = (n) => PDFName.of(n);
const tekst = (d, k) => decodePdfTextObject(d.get(N(k)));

// ── onderwerp ───────────────────────────────────────────────────────────────

test('onderwerpPlek: soorten met eigen tekst naar /Subj, de rest in /Contents', () => {
  assert.equal(onderwerpPlek('textbox'), 'subj');
  assert.equal(onderwerpPlek('comment'), 'subj');
  assert.equal(onderwerpPlek('measureDistance'), 'subj');
  assert.equal(onderwerpPlek('box'), 'contents');
  assert.equal(onderwerpPlek('textHighlight'), 'contents');
  assert.equal(onderwerpPlek('stamp'), 'eigen');
  assert.equal(onderwerpPlek('caret'), 'eigen');
});

test('algemeneEigenschappen: /Subj wordt onderwerp bij een tekstvak, pdfSubject bij een vorm', () => {
  assert.deepEqual(algemeneEigenschappen({ subj: 'Kop' }, { type: 'textbox', subject: '' }), { subject: 'Kop' });
  assert.deepEqual(algemeneEigenschappen({ subj: 'Rechthoek' }, { type: 'box', subject: 'opmerking' }), { pdfSubject: 'Rechthoek' });
  // Een stempel draagt in /Subj zijn naam: niets.
  assert.deepEqual(algemeneEigenschappen({ subj: 'Approved' }, { type: 'stamp' }), {});
});

test('algemeneEigenschappen laat velden staan die de soort zelf al zette', () => {
  const uit = algemeneEigenschappen(
    { nm: 'a', subj: 'b', opsAltText: 'c', opsIfcCategory: 'IfcWall' },
    { type: 'textHighlight', nm: 'eigen', pdfSubject: 'eigen', altText: 'eigen', ifcCategory: 'IfcSlab' },
  );
  assert.deepEqual(uit, {});
  assert.deepEqual(algemeneEigenschappen({ nm: 'a', opsAltText: 'c', opsIfcCategory: 'IfcWall' }, { type: 'box' }),
    { nm: 'a', altText: 'c', ifcCategory: 'IfcWall' });
  assert.deepEqual(algemeneEigenschappen(undefined, { type: 'box' }), {});
});

// ── antwoorden en koppelingen bij het laden ─────────────────────────────────

const antwoordAnnot = (extra = {}) => ({
  subtype: 'Text', inReplyTo: '5R', titleObj: { str: 'Piet' }, contentsObj: { str: 'ja' },
  creationDate: 'D:20260102030405Z', ...extra,
});

test('eigenAntwoordUitAnnot herkent alleen een eigen antwoord', () => {
  const a = eigenAntwoordUitAnnot(antwoordAnnot(), { opsSubtype: 'reply', nm: 'r1' });
  assert.deepEqual(a, { targetId: '5R', reply: { id: 'r1', author: 'Piet', text: 'ja', createdAt: '2026-01-02T03:04:05.000Z' } });
  assert.equal(eigenAntwoordUitAnnot(antwoordAnnot(), {}), null, 'antwoord van een ander programma');
  assert.equal(eigenAntwoordUitAnnot(antwoordAnnot({ state: 'Marked' }), { opsSubtype: 'reply' }), null, 'status');
  assert.equal(eigenAntwoordUitAnnot(antwoordAnnot({ inReplyTo: undefined }), { opsSubtype: 'reply' }), null);
});

test('koppelAntwoorden hangt antwoorden onder hun doel en zet de overige koppelingen', () => {
  const ouder = { id: 'o', type: 'box' };
  const kind = { id: 'k', type: 'circle' };
  const notitie = { id: 'n', type: 'comment' };
  const doorhaling = { id: 'd', type: 'textStrikethrough' };
  const byPdfId = new Map([['5R', ouder], ['6R', kind], ['7R', notitie], ['8R', doorhaling]]);
  const reply = { id: 'r', author: 'A', text: 't', createdAt: 'x' };
  const zonderDoel = koppelAntwoorden(
    [{ targetId: '5R', reply }, { targetId: '99R', reply }],
    [
      { converted: kind, inReplyTo: '5R', replyType: 'Group' },
      { converted: notitie, inReplyTo: '5R', replyType: 'R' },
      { converted: doorhaling, inReplyTo: '5R', replyType: 'Group' },
      { converted: ouder, inReplyTo: '5R' },
    ],
    byPdfId,
  );
  assert.deepEqual(ouder.replies, [reply]);
  assert.equal(zonderDoel.length, 1, 'een antwoord zonder doel komt terug');
  assert.equal(kind.inReplyTo, 'o');
  assert.equal(kind.replyType, 'group');
  assert.equal(notitie.replyType, 'reply');
  assert.equal(doorhaling.inReplyTo, undefined, 'correcties koppelt resolveGroupLinks');
  assert.equal(ouder.inReplyTo, undefined, 'niet naar zichzelf');
});

// ── opslaan ─────────────────────────────────────────────────────────────────

async function context() {
  const doc = await PDFDocument.create();
  return doc.context;
}

test('schrijfAlgemeneSleutels schrijft /NM, /Subj, /OPS_AltText en /OPS_IfcCategory', async () => {
  const ctx = await context();
  const d = ctx.obj({ Type: 'Annot', Subtype: 'Square' });
  const namen = new Set();
  schrijfAlgemeneSleutels(d, { type: 'box', nm: 'n1', subject: 'opmerking', pdfSubject: 'Rechthoek', altText: 'alt', ifcCategory: 'IfcWall' }, namen);
  assert.equal(tekst(d, 'NM'), 'n1');
  assert.equal(tekst(d, 'Subj'), 'Rechthoek');
  assert.equal(tekst(d, 'OPS_AltText'), 'alt');
  assert.equal(tekst(d, 'OPS_IfcCategory'), 'IfcWall');
  // Dezelfde naam nog eens op de pagina: niet schrijven.
  const d2 = ctx.obj({ Type: 'Annot', Subtype: 'Square' });
  schrijfAlgemeneSleutels(d2, { type: 'box', nm: 'n1' }, namen);
  assert.equal(d2.get(N('NM')), undefined);
});

test('schrijfAlgemeneSleutels laat staan wat de tak van de soort schreef', async () => {
  const ctx = await context();
  const d = ctx.obj({ Type: 'Annot', Subtype: 'Stamp', Subj: PDFString.of('Approved'), NM: PDFString.of('eigen') });
  schrijfAlgemeneSleutels(d, { type: 'stamp', nm: 'ander', subject: 'x', pdfSubject: 'y' }, new Set());
  assert.equal(tekst(d, 'Subj'), 'Approved');
  assert.equal(tekst(d, 'NM'), 'eigen');
  // Een tekstvak: het onderwerp gaat naar /Subj.
  const ft = ctx.obj({ Type: 'Annot', Subtype: 'FreeText' });
  schrijfAlgemeneSleutels(ft, { type: 'textbox', subject: 'Kop' }, new Set());
  assert.equal(tekst(ft, 'Subj'), 'Kop');
  // Niets in het model: niets erbij.
  const leeg = ctx.obj({ Type: 'Annot', Subtype: 'Square' });
  schrijfAlgemeneSleutels(leeg, { type: 'box', subject: 'alleen /Contents' }, new Set());
  assert.deepEqual(leeg.keys().map(String), ['/Type', '/Subtype']);
});

test('antwoordAnnotaties: status, gemarkeerd en antwoorden, elk met /IRT; nooit /F-bit 2 op de ouder', async () => {
  const ctx = await context();
  const ouder = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 20, 110, 70], F: 4 });
  const ouderRef = ctx.register(ouder);
  const dicts = antwoordAnnotaties(ctx, {
    status: 'accepted', marked: true, author: 'A',
    replies: [{ id: 'r1', author: 'B', text: 'ok', createdAt: '2026-01-01T00:00:00.000Z' }],
  }, ouderRef, ouder);
  assert.equal(dicts.length, 3);
  for (const d of dicts) assert.equal(d.get(N('IRT')), ouderRef);
  const [status, gemarkeerd, antwoord] = dicts;
  assert.equal(tekst(status, 'StateModel'), 'Review');
  assert.equal(tekst(gemarkeerd, 'StateModel'), 'Marked');
  assert.equal(tekst(gemarkeerd, 'State'), 'Marked');
  assert.equal(gemarkeerd.get(N('F')).asNumber(), 30);
  assert.equal(tekst(antwoord, 'Contents'), 'ok');
  assert.equal(tekst(antwoord, 'OPS_Subtype'), 'reply');
  assert.equal(tekst(antwoord, 'NM'), 'r1');
  assert.deepEqual(antwoord.get(N('Rect')).asArray().map((v) => v.asNumber()), [10, 46, 34, 70]);
  assert.equal(ouder.get(N('F')).asNumber(), 4);
  assert.deepEqual(antwoordAnnotaties(ctx, { marked: false }, ouderRef, ouder), []);
});

test('schrijfKoppelingen: /IRT naar het doel, /RT /Group alleen bij een groep', async () => {
  const ctx = await context();
  const maak = () => ctx.obj({ Type: 'Annot', Subtype: 'Square' });
  const dictById = new Map([['o', maak()], ['g', maak()], ['r', maak()], ['weg', maak()], ['d', maak()]]);
  const refById = new Map([...dictById].map(([id, d]) => [id, ctx.register(d)]));
  const aantal = schrijfKoppelingen([
    { id: 'o', type: 'box' },
    { id: 'g', type: 'box', inReplyTo: 'o', replyType: 'group' },
    { id: 'r', type: 'box', inReplyTo: 'o', replyType: 'reply' },
    { id: 'weg', type: 'box', inReplyTo: 'bestaat-niet' },
    { id: 'd', type: 'textStrikethrough', inReplyTo: 'o', replyType: 'group' },
  ], refById, dictById);
  assert.equal(aantal, 2);
  assert.equal(dictById.get('g').get(N('IRT')), refById.get('o'));
  assert.equal(dictById.get('g').get(N('RT')).toString(), '/Group');
  assert.equal(dictById.get('r').get(N('RT')), undefined);
  assert.equal(dictById.get('weg').get(N('IRT')), undefined);
  assert.equal(dictById.get('d').get(N('IRT')), undefined, 'correcties koppelt applyGroupLinks');
});
