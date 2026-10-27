import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STILTE_MS, MAX_WACHT_MS, MAX_TUSSENPOOS_MS,
  vingerafdruk, nieuwPlan, werkBij, isAanDeBeurt, naOpname, tussenpoosNaDuur, vastgelegdPlan,
} from './planning.js';

// Simuleert de bewaking: elke `stap` ms een waarneming; `wijzigingen` zijn de
// momenten waarop het document verandert. Geeft de momenten van de opnamen.
function simuleer({ wijzigingen, tot, stap = 5_000, duur = 0, opgeslagenOp = null }) {
  let plan = nieuwPlan();
  let revisie = 0;
  let gewijzigd = false;
  const opnamen = [];
  for (let nu = 0; nu <= tot; nu += stap) {
    while (wijzigingen.length && wijzigingen[0] <= nu) { wijzigingen.shift(); revisie++; gewijzigd = true; }
    if (opgeslagenOp != null && nu >= opgeslagenOp) gewijzigd = false;
    const fp = `r${revisie}`;
    plan = werkBij(plan, { fp, gewijzigd }, nu);
    if (gewijzigd && isAanDeBeurt(plan, nu)) {
      opnamen.push(nu);
      plan = naOpname(plan, fp, nu, duur);
    }
  }
  return opnamen;
}

test('vingerafdruk: verandert bij elke soort wijziging, niet bij weergave', () => {
  const doc = { inhoudRevisie: 3, undoStack: [1, 2], redoStack: [], annotations: [{}], textEdits: [], watermarks: [], bookmarks: [], pdfDoc: { numPages: 4 }, filePath: 'a.pdf', currentPage: 1, scale: 1 };
  const basis = vingerafdruk(doc);
  assert.notEqual(vingerafdruk({ ...doc, inhoudRevisie: 4 }), basis);
  assert.notEqual(vingerafdruk({ ...doc, annotations: [{}, {}] }), basis);
  assert.notEqual(vingerafdruk({ ...doc, pdfDoc: { numPages: 5 } }), basis);
  assert.notEqual(vingerafdruk({ ...doc, filePath: 'opds-edit-1.pdf' }), basis, 'paginabewerking = nieuw werkpad');
  assert.notEqual(vingerafdruk(doc, 1), basis, 'formulierveld (teller)');
  assert.equal(vingerafdruk({ ...doc, currentPage: 3, scale: 2 }), basis, 'bladeren en zoomen tellen niet');
  assert.equal(vingerafdruk(null), '');
});

test('planning: één wijziging geeft één opname, ~30 s later', () => {
  assert.deepEqual(simuleer({ wijzigingen: [1_000], tot: 300_000 }), [35_000]);
});

test('planning: geen opname zonder wijziging', () => {
  assert.deepEqual(simuleer({ wijzigingen: [], tot: 300_000 }), []);
});

test('planning: doorwerken stelt de opname uit, maar hooguit 2 minuten', () => {
  // Elke 10 s een wijziging gedurende 10 minuten.
  const wijzigingen = Array.from({ length: 60 }, (_, i) => 1_000 + i * 10_000);
  const opnamen = simuleer({ wijzigingen, tot: 700_000 });
  assert.ok(opnamen.length >= 4, `opnamen: ${opnamen}`);
  let vorige = 0;
  for (const t of opnamen) {
    assert.ok(t - vorige <= MAX_WACHT_MS + 10_000, `gat ${t - vorige} ms`);
    vorige = t;
  }
  // Na de laatste wijziging (591 s) volgt nog één opname, ~30 s later.
  assert.ok(opnamen.at(-1) >= 591_000 + STILTE_MS - 5_000 && opnamen.at(-1) <= 591_000 + STILTE_MS + 5_000, `laatste ${opnamen.at(-1)}`);
});

test('planning: opgeslagen vóór de wachttijd om is = geen opname', () => {
  assert.deepEqual(simuleer({ wijzigingen: [1_000], tot: 300_000, opgeslagenOp: 20_000 }), []);
});

test('planning: al gewijzigd bij het eerste zien telt als wijziging van nu', () => {
  let plan = werkBij(nieuwPlan(), { fp: 'x', gewijzigd: true }, 50_000);
  assert.equal(isAanDeBeurt(plan, 70_000), false);
  plan = werkBij(plan, { fp: 'x', gewijzigd: true }, 80_000);
  assert.equal(isAanDeBeurt(plan, 80_000), true);
});

test('planning: wijziging tijdens de opname wacht op de volgende', () => {
  let plan = werkBij(nieuwPlan(), { fp: 'a', gewijzigd: true }, 0);
  plan = werkBij(plan, { fp: 'b', gewijzigd: true }, 31_000); // tijdens de opname van 'a'
  plan = naOpname(plan, 'a', 32_000);
  assert.equal(plan.vastgelegd, 'a');
  assert.equal(plan.eersteWijziging, 32_000);
  assert.equal(isAanDeBeurt(plan, 40_000), false);
  assert.equal(isAanDeBeurt(plan, 61_000), true);
  plan = naOpname(plan, 'b', 61_000);
  assert.equal(plan.eersteWijziging, null);
  assert.equal(isAanDeBeurt(plan, 500_000), false, 'niets nieuws');
});

test('planning: trage opname vergroot de tussenpoos', () => {
  assert.equal(tussenpoosNaDuur(800), 0);
  assert.equal(tussenpoosNaDuur(5_000), 0);
  assert.equal(tussenpoosNaDuur(12_000), 120_000);
  assert.equal(tussenpoosNaDuur(600_000), MAX_TUSSENPOOS_MS);
  // Opname van 20 s: de volgende niet binnen 200 s, ook niet na maxWacht.
  const opnamen = simuleer({ wijzigingen: Array.from({ length: 40 }, (_, i) => 1_000 + i * 10_000), tot: 420_000, duur: 20_000 });
  for (let i = 1; i < opnamen.length; i++) assert.ok(opnamen[i] - opnamen[i - 1] >= 200_000, `${opnamen}`);
});

test('planning: een herstelde kopie staat al vast', () => {
  const plan = vastgelegdPlan('fp', 1_000);
  assert.equal(isAanDeBeurt(werkBij(plan, { fp: 'fp', gewijzigd: true }, 100_000), 100_000), false);
  const na = werkBij(plan, { fp: 'fp2', gewijzigd: true }, 100_000);
  assert.equal(isAanDeBeurt(na, 131_000), true);
});
