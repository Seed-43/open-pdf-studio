// Document splitsen (#381): de pure regels. Welke pagina's in welk deel komen
// (per N pagina's, per bladwijzer op het hoogste niveau, per maximale
// bestandsgrootte), hoe de delen heten en wat er per deel aan bladwijzers,
// paginalabels en draaiingen meegaat.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bereikenPerAantal, bovensteBladwijzers, bereikenOpBladwijzers, bereikenOpGrootte,
  veiligeBestandsnaam, vulPatroon, bestandsnamenVoorDelen, standaardPatroon,
  bladwijzersVoorDeel, labelsVoorDeel, rotatiesVoorDeel, padInMap, mapVanPad, mbNaarBytes,
  geldigAantal, geldigeMb, documentNaam, MAX_NAAM_LENGTE,
} from './splits-logica.js';

test('bereikenPerAantal: elke N pagina\'s, de rest in het laatste deel', () => {
  assert.deepEqual(bereikenPerAantal(10, 3), [
    { start: 1, eind: 3 }, { start: 4, eind: 6 }, { start: 7, eind: 9 }, { start: 10, eind: 10 },
  ]);
  assert.deepEqual(bereikenPerAantal(4, 2), [{ start: 1, eind: 2 }, { start: 3, eind: 4 }]);
  assert.deepEqual(bereikenPerAantal(3, 10), [{ start: 1, eind: 3 }]);
  assert.deepEqual(bereikenPerAantal(0, 2), []);
  // Onzin wordt 1 pagina per deel.
  assert.equal(bereikenPerAantal(3, 0).length, 3);
  assert.equal(bereikenPerAantal(3, 'x').length, 3);
});

test('geldigAantal en geldigeMb: begrensd en afgerond', () => {
  assert.equal(geldigAantal('5'), 5);
  assert.equal(geldigAantal(0), 1);
  assert.equal(geldigAantal(2.6), 3);
  assert.equal(geldigAantal('abc', 7), 7);
  assert.equal(geldigeMb('2,5'), 2.5);
  assert.equal(geldigeMb(0), 0.1);
  assert.equal(geldigeMb('x', 10), 10);
  assert.equal(mbNaarBytes(1), 1024 * 1024);
  assert.equal(mbNaarBytes(0.5), 512 * 1024);
});

// Bladwijzers zoals het paneel ze in doc.bookmarks bewaart: plat, met parentId.
const BLADWIJZERS = [
  { id: 'a', title: 'Inleiding', page: 1, parentId: null, sortOrder: 0 },
  { id: 'a1', title: 'Doel', page: 2, parentId: 'a', sortOrder: 0 },
  { id: 'b', title: 'Hoofdstuk 2: Constructie', page: 4, parentId: null, sortOrder: 1 },
  { id: 'b1', title: 'Fundering', page: 5, parentId: 'b', sortOrder: 0 },
  { id: 'b1x', title: 'Palen', page: 6, parentId: 'b1', sortOrder: 0 },
  { id: 'c', title: 'Bijlagen', page: 8, parentId: null, sortOrder: 2 },
];

test('bovensteBladwijzers: alleen het hoogste niveau, op volgorde', () => {
  const door = [BLADWIJZERS[5], BLADWIJZERS[2], BLADWIJZERS[0], BLADWIJZERS[1]];
  assert.deepEqual(bovensteBladwijzers(door).map((b) => b.id), ['a', 'b', 'c']);
  // Een ouder die niet (meer) bestaat: dan telt hij als bovenste.
  assert.deepEqual(bovensteBladwijzers([{ id: 'w', title: 'Wees', page: 3, parentId: 'weg' }]).map((b) => b.id), ['w']);
  assert.deepEqual(bovensteBladwijzers(null), []);
});

test('bereikenOpBladwijzers: elk deel loopt tot de volgende bladwijzer', () => {
  assert.deepEqual(bereikenOpBladwijzers(BLADWIJZERS, 10), [
    { start: 1, eind: 3, titel: 'Inleiding' },
    { start: 4, eind: 7, titel: 'Hoofdstuk 2: Constructie' },
    { start: 8, eind: 10, titel: 'Bijlagen' },
  ]);
});

test('bereikenOpBladwijzers: pagina\'s vóór de eerste bladwijzer worden een eigen deel zonder titel', () => {
  const r = bereikenOpBladwijzers([
    { id: 'x', title: 'Deel A', page: 3, parentId: null },
    { id: 'y', title: 'Deel B', page: 6, parentId: null },
  ], 7);
  assert.deepEqual(r, [
    { start: 1, eind: 2, titel: null },
    { start: 3, eind: 5, titel: 'Deel A' },
    { start: 6, eind: 7, titel: 'Deel B' },
  ]);
});

test('bereikenOpBladwijzers: twee op dezelfde pagina, buiten het document en volgorde op pagina', () => {
  const r = bereikenOpBladwijzers([
    { id: 'p', title: 'Later', page: 5, parentId: null, sortOrder: 0 },
    { id: 'q', title: 'Eerst', page: 1, parentId: null, sortOrder: 1 },
    { id: 'r', title: 'Ook eerst', page: 1, parentId: null, sortOrder: 2 },
    { id: 's', title: 'Weg', page: 40, parentId: null, sortOrder: 3 },
  ], 6);
  assert.deepEqual(r, [
    { start: 1, eind: 4, titel: 'Eerst' },
    { start: 5, eind: 6, titel: 'Later' },
  ]);
  assert.deepEqual(bereikenOpBladwijzers([], 5), []);
});

test('bereikenOpGrootte: zo veel mogelijk pagina\'s per deel onder de grens', async () => {
  // Elke pagina 100 bytes, 50 bytes vaste kop per bestand.
  const vragen = [];
  const grootte = async (start, eind) => {
    vragen.push([start, eind]);
    return 50 + (eind - start + 1) * 100;
  };
  const r = await bereikenOpGrootte(10, 360, grootte);
  assert.deepEqual(r, [
    { start: 1, eind: 3, teGroot: false },
    { start: 4, eind: 6, teGroot: false },
    { start: 7, eind: 9, teGroot: false },
    { start: 10, eind: 10, teGroot: false },
  ]);
  // Gedeelde bronnen: de echte maat telt, niet de som van losse pagina's.
  const gedeeld = async (start, eind) => 1000 + (eind - start + 1) * 10;
  assert.deepEqual(await bereikenOpGrootte(20, 1250, gedeeld), [{ start: 1, eind: 20, teGroot: false }]);
  // Niet elke combinatie hoeft gemeten te worden.
  vragen.length = 0;
  await bereikenOpGrootte(100, 50 + 100 * 100, grootte);
  assert.ok(vragen.length < 20, `${vragen.length} metingen`);
});

test('bereikenOpGrootte: een pagina groter dan de grens wordt een eigen deel, gemarkeerd', async () => {
  const maten = [100, 900, 100, 100];
  const grootte = async (start, eind) => maten.slice(start - 1, eind).reduce((a, b) => a + b, 0);
  assert.deepEqual(await bereikenOpGrootte(4, 300, grootte), [
    { start: 1, eind: 1, teGroot: false },
    { start: 2, eind: 2, teGroot: true },
    { start: 3, eind: 4, teGroot: false },
  ]);
  assert.deepEqual(await bereikenOpGrootte(0, 300, grootte), []);
});

test('veiligeBestandsnaam: geen tekens die Windows weigert, geen gereserveerde namen', () => {
  assert.equal(veiligeBestandsnaam('Hoofdstuk 2: Constructie'), 'Hoofdstuk 2_ Constructie');
  assert.equal(veiligeBestandsnaam('a/b\\c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i');
  assert.equal(veiligeBestandsnaam('  veel   ruimte\tmet\ttabs  '), 'veel ruimte met tabs');
  assert.equal(veiligeBestandsnaam('eindigt op punten...'), 'eindigt op punten');
  assert.equal(veiligeBestandsnaam('.verborgen'), 'verborgen');
  assert.equal(veiligeBestandsnaam('CON'), '_CON');
  assert.equal(veiligeBestandsnaam('lpt1'), '_lpt1');
  assert.equal(veiligeBestandsnaam('Com3.txt'), '_Com3.txt');
  assert.equal(veiligeBestandsnaam('Console'), 'Console');
  assert.equal(veiligeBestandsnaam('regel\u0000\u001fbreuk'), 'regel_breuk');
  assert.equal(veiligeBestandsnaam('', 'deel'), 'deel');
  assert.equal(veiligeBestandsnaam('???', 'deel'), 'deel');
  assert.equal(veiligeBestandsnaam('Résumé – 日本語'), 'Résumé – 日本語');
  const lang = veiligeBestandsnaam('x'.repeat(400));
  assert.equal(lang.length, MAX_NAAM_LENGTE);
});

test('vulPatroon: {name}, {n}, {bookmark}, {start} en {end}', () => {
  const w = { naam: 'Rapport', n: 3, aantal: 12, titel: 'Bijlagen', start: 8, eind: 10 };
  assert.equal(vulPatroon('{name}-{n}', w), 'Rapport-03');
  assert.equal(vulPatroon('{bookmark}', w), 'Bijlagen');
  assert.equal(vulPatroon('{name} p{start}-{end}', w), 'Rapport p8-10');
  assert.equal(vulPatroon('{NAME}_{N}', w), 'Rapport_03', 'hoofdletters maken niet uit');
  assert.equal(vulPatroon('{name}-{n}', { ...w, aantal: 9 }), 'Rapport-3', 'onder de tien geen voorloopnul');
  // Zonder bladwijzer: de naam van het document.
  assert.equal(vulPatroon('{bookmark}', { ...w, titel: null }), 'Rapport');
  assert.equal(vulPatroon('vast', w), 'vast');
  assert.equal(vulPatroon('', w), 'Rapport-03', 'leeg patroon: de standaard');
});

test('standaardPatroon: bladwijzers krijgen hun titel, de rest naam-nummer', () => {
  assert.equal(standaardPatroon('bookmarks'), '{bookmark}');
  assert.equal(standaardPatroon('pages'), '{name}-{n}');
  assert.equal(standaardPatroon('size'), '{name}-{n}');
});

test('bestandsnamenVoorDelen: opgeschoond, met .pdf, en uniek zonder op hoofdletters te letten', () => {
  const delen = [
    { start: 1, eind: 2, titel: 'Bijlage: A' },
    { start: 3, eind: 4, titel: 'bijlage: a' },
    { start: 5, eind: 6, titel: 'Bijlage/A' },
    { start: 7, eind: 7, titel: null },
  ];
  assert.deepEqual(bestandsnamenVoorDelen(delen, { patroon: '{bookmark}', naam: 'Rapport.pdf' }), [
    'Bijlage_ A.pdf', 'bijlage_ a (2).pdf', 'Bijlage_A.pdf', 'Rapport.pdf',
  ]);
  // Een patroon dat zelf al op .pdf eindigt krijgt het niet dubbel.
  assert.deepEqual(
    bestandsnamenVoorDelen([{ start: 1, eind: 1 }, { start: 2, eind: 2 }], { patroon: 'deel-{n}.pdf', naam: 'x' }),
    ['deel-1.pdf', 'deel-2.pdf'],
  );
  // Vaste tekst zonder nummer: toch allemaal verschillend.
  assert.deepEqual(
    bestandsnamenVoorDelen([{ start: 1, eind: 1 }, { start: 2, eind: 2 }, { start: 3, eind: 3 }], { patroon: 'vast', naam: 'x' }),
    ['vast.pdf', 'vast (2).pdf', 'vast (3).pdf'],
  );
});

test('bladwijzersVoorDeel: alleen wat in het deel valt, naar de nieuwe paginanummers', () => {
  const deel = bladwijzersVoorDeel(BLADWIJZERS, 4, 7);
  assert.deepEqual(deel.map((b) => [b.id, b.page, b.parentId]), [
    ['b', 1, null], ['b1', 2, 'b'], ['b1x', 3, 'b1'],
  ]);
  // Het origineel blijft onaangeroerd.
  assert.equal(BLADWIJZERS[2].page, 4);
});

test('bladwijzersVoorDeel: valt de ouder buiten het deel, dan schuift het kind een niveau op', () => {
  const deel = bladwijzersVoorDeel(BLADWIJZERS, 5, 6);
  assert.deepEqual(deel.map((b) => [b.id, b.page, b.parentId]), [['b1', 1, null], ['b1x', 2, 'b1']]);
  const kleinkind = bladwijzersVoorDeel(BLADWIJZERS, 6, 7);
  assert.deepEqual(kleinkind.map((b) => [b.id, b.page, b.parentId]), [['b1x', 1, null]]);
  assert.deepEqual(bladwijzersVoorDeel(null, 1, 3), []);
});

test('labelsVoorDeel: het stuk van de labels, of null zonder eigen labels', () => {
  assert.deepEqual(labelsVoorDeel(['i', 'ii', '1', '2', '3'], 2, 4), ['ii', '1', '2']);
  assert.equal(labelsVoorDeel(null, 1, 2), null);
  assert.equal(labelsVoorDeel(['i', 'ii'], 3, 4), null);
});

test('rotatiesVoorDeel: de draaiingen van de app naar de nieuwe paginanummers', () => {
  assert.deepEqual(rotatiesVoorDeel({ 2: 90, 5: 180, 6: 0 }, 4, 6), { 2: 180 });
  assert.deepEqual(rotatiesVoorDeel({ 1: 270 }, 1, 1), { 1: 270 });
  assert.deepEqual(rotatiesVoorDeel(null, 1, 3), {});
});

test('padInMap en mapVanPad: Windows- en Unix-paden', () => {
  assert.equal(padInMap('C:\\Docs', 'a.pdf'), 'C:\\Docs\\a.pdf');
  assert.equal(padInMap('C:\\Docs\\', 'a.pdf'), 'C:\\Docs\\a.pdf');
  assert.equal(padInMap('/home/u/docs', 'a.pdf'), '/home/u/docs/a.pdf');
  assert.equal(padInMap('', 'a.pdf'), 'a.pdf');
  assert.equal(mapVanPad('C:\\Docs\\rapport.pdf'), 'C:\\Docs');
  assert.equal(mapVanPad('/home/u/rapport.pdf'), '/home/u');
  assert.equal(mapVanPad('rapport.pdf'), '');
  assert.equal(mapVanPad(null), '');
});

test('documentNaam: het echte bestand, niet de werkkopie of het tijdelijke bestand', () => {
  assert.equal(documentNaam({ filePath: 'C:\\Docs\\rapport.pdf' }), 'rapport.pdf');
  assert.equal(documentNaam({ filePath: 'C:\\Temp\\werk-123.pdf', saveTargetPath: '/home/u/plan.pdf' }), 'plan.pdf');
  assert.equal(documentNaam({ isUntitled: true, filePath: 'C:\\Temp\\x.pdf', fileName: 'Naamloos 1' }), 'Naamloos 1');
  assert.equal(documentNaam(null), 'document');
});
