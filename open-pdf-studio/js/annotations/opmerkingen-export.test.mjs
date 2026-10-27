// Exporteren vanuit het opmerkingenpaneel (#383): de lijst als CSV en de
// selectie als XFDF. Alleen de pure rekenstukken; het paneel en de dialogen
// zitten in AnnotationsPanel.jsx en xfdf.js.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CSV_KOLOMMEN, csvVeld, bouwCsv, csvDatum, opmerkingRij,
  opmerkingenInLijstvolgorde, geselecteerdVoorExport,
} from './opmerkingen-export.js';

test('csvVeld: gewone tekst blijft zoals hij is', () => {
  assert.equal(csvVeld('Kozijn aanpassen'), 'Kozijn aanpassen');
  assert.equal(csvVeld(12), '12');
  assert.equal(csvVeld(null), '');
  assert.equal(csvVeld(undefined), '');
});

test('csvVeld: komma, aanhalingsteken en regeleinde worden omsloten', () => {
  assert.equal(csvVeld('a,b'), '"a,b"');
  assert.equal(csvVeld('zeg "ja"'), '"zeg ""ja"""');
  assert.equal(csvVeld('regel 1\nregel 2'), '"regel 1\nregel 2"');
  assert.equal(csvVeld('regel 1\r\nregel 2'), '"regel 1\r\nregel 2"');
  assert.equal(csvVeld(' spatie '), '" spatie "');
});

test('csvVeld: tekst die een spreadsheet als formule leest krijgt een apostrof', () => {
  assert.equal(csvVeld('=SOM(A1:A3)'), "'=SOM(A1:A3)");
  assert.equal(csvVeld('+31 6'), "'+31 6");
  assert.equal(csvVeld('-2 cm'), "'-2 cm");
  assert.equal(csvVeld('@user'), "'@user");
  assert.equal(csvVeld('=a,b'), '"\'=a,b"');
  // Getallen zijn geen tekst: een negatief paginanummer bestaat niet, maar
  // een getal krijgt nooit een apostrof.
  assert.equal(csvVeld(-3), '-3');
});

test('bouwCsv: BOM, kopregel, CRLF tussen en na de regels', () => {
  const csv = bouwCsv(['Pagina', 'Inhoud'], [[1, 'één, twee'], [2, 'café']]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv, '﻿Pagina,Inhoud\r\n1,"één, twee"\r\n2,café\r\n');
});

test('bouwCsv: zonder rijen alleen de kopregel', () => {
  assert.equal(bouwCsv(['a', 'b'], []), '﻿a,b\r\n');
});

test('csvDatum: lokale tijd als JJJJ-MM-DD UU:MM, ongeldig wordt leeg', () => {
  const d = new Date(2026, 9, 5, 7, 3, 59);
  assert.equal(csvDatum(d), '2026-10-05 07:03');
  assert.equal(csvDatum(d.toISOString()), '2026-10-05 07:03');
  assert.equal(csvDatum('geen datum'), '');
  assert.equal(csvDatum(null), '');
});

test('opmerkingRij: alle kolommen in de vaste volgorde', () => {
  assert.deepEqual(CSV_KOLOMMEN,
    ['page', 'type', 'author', 'date', 'status', 'subject', 'contents', 'color', 'layer']);
  const ann = {
    id: 'a1', page: 3, type: 'comment', author: 'Marieke', status: 'accepted',
    modifiedAt: new Date(2026, 0, 2, 13, 45).toISOString(), createdAt: '2025-01-01T00:00:00Z',
    subject: 'Gevel', text: 'Kozijn "B" vervangen,\nzie detail', color: '#FF0000', layer: 'l2',
  };
  const rij = opmerkingRij(ann, {
    typeNaam: (a) => `T:${a.type}`,
    statusNaam: (s) => `S:${s}`,
    laagNaam: (a) => `L:${a.layer}`,
  });
  assert.deepEqual(rij, [3, 'T:comment', 'Marieke', '2026-01-02 13:45', 'S:accepted', 'Gevel',
    'Kozijn "B" vervangen,\nzie detail', '#FF0000', 'L:l2']);
});

test('opmerkingRij: ontbrekende velden worden leeg, stempeltekst telt als inhoud', () => {
  const rij = opmerkingRij({ id: 's', page: 1, type: 'stamp', stampText: 'APPROVED', strokeColor: '#00f' }, {});
  assert.deepEqual(rij, [1, 'stamp', '', '', '', '', 'APPROVED', '#00f', '']);
  // Zonder wijzigingsdatum telt de aanmaakdatum.
  const r2 = opmerkingRij({ id: 'x', page: 2, type: 'box', createdAt: new Date(2026, 4, 6, 8, 9).toISOString() }, {});
  assert.equal(r2[3], '2026-05-06 08:09');
});

test('opmerkingRij: geen status blijft leeg, ook niet via statusNaam', () => {
  const rij = opmerkingRij({ id: 'x', page: 1, type: 'box', status: 'none' }, { statusNaam: (s) => `S:${s}` });
  assert.equal(rij[4], '');
});

test('opmerkingenInLijstvolgorde: volgt de rijen van het paneel, kopregels vallen weg', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  const items = [
    { isHeader: true, groupKey: 'x' },
    { isHeader: false, id: 'c' },
    { isHeader: false, id: 'a' },
    { isHeader: true, groupKey: 'y' },
    { isHeader: false, id: 'a' }, // dubbel: telt één keer
    { isHeader: false, id: 'weg' }, // niet (meer) in het document
  ];
  assert.deepEqual(opmerkingenInLijstvolgorde(items, [a, b, c]), [c, a]);
  assert.deepEqual(opmerkingenInLijstvolgorde([], [a]), []);
  assert.deepEqual(opmerkingenInLijstvolgorde(null, null), []);
});

test('geselecteerdVoorExport: selectie in documentvolgorde, op id', () => {
  const a = { id: 'a', type: 'box' }, b = { id: 'b', type: 'box' }, c = { id: 'c', type: 'box' };
  // De selectie mag kopieën bevatten (state bewaart bij toewijzen een kopie).
  assert.deepEqual(geselecteerdVoorExport([a, b, c], [{ ...c }, a]), [a, c]);
  assert.deepEqual(geselecteerdVoorExport([a, b, c], []), []);
  assert.deepEqual(geselecteerdVoorExport([a], null), []);
});

test('geselecteerdVoorExport: een vervanging gaat in haar geheel mee', () => {
  const caret = { id: 'k', type: 'caret', intent: 'Replace', page: 1 };
  const strike = { id: 's', type: 'textStrikethrough', inReplyTo: 'k', replyType: 'group', intent: 'StrikeOutTextEdit', page: 1 };
  const ander = { id: 'z', type: 'box', page: 1 };
  assert.deepEqual(geselecteerdVoorExport([strike, ander, caret], [caret]), [strike, caret]);
});
