// De sessie van de native systeemtypen-editor (#567): werkkopie en basis,
// bewerken, omzet-wachtrij, Toepassen, Annuleren en focus. SysteemtypenDialog
// toont alleen wat deze sessie bijhoudt; hier draait de echte logica tegen de
// echte registry en state.
//
// preferences.js en rendering.js zijn stubs die hun aanroepen tellen
// (zie ../../core/app-test-hooks.mjs).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
await import('../../core/preferences.js');
await import('../../annotations/rendering.js');
// De commit ververst het paneel via een luie import: vooraf laden houdt de
// tellers voorspelbaar.
await import('./propertiesStore.js');
const reg = await import('../../annotations/systeem-typen-registry.js');
const { maakEditorSessie } = await import('./systeemtypenEditorSessie.js');
const { createDefaultSysteemTypen, findSysteemType } = await import('../../annotations/systeem-typen.js');

const EXT = { kind: 'extension', extensionId: 'test.synthetisch' };
const DEF = { naam: 'Mineraal', categorie: 'plafond', layout: 'raster', celXMm: 600, celYMm: 600 };
const EXT_ID = 'ext:test.synthetisch#mineraal';

const tellers = () => globalThis.__stubCalls || {};
// Opslaan en hertekenen lopen via een dynamische import (door de laadhaken).
// Naast andere testbestanden duurt dat soms langer dan één timer van 30 ms;
// wacht daarom een paar rondes, elk na dezelfde imports.
const rust = async () => {
  for (let i = 0; i < 3; i++) {
    await Promise.all([import('../../core/preferences.js'), import('../../annotations/rendering.js')]);
    await new Promise((r) => setTimeout(r, 30));
  }
};
const kloon = (x) => JSON.parse(JSON.stringify(x));

let documenten;
let hertekend;
let events;
let stopLuisteren;

function sessie(typeId) {
  return maakEditorSessie({
    host: { registry: reg, documenten: () => documenten, redraw: () => { hertekend++; } },
    typeId,
  });
}

beforeEach(async () => {
  stopLuisteren?.();
  state.preferences.systeemTypen = createDefaultSysteemTypen();
  documenten = [
    { annotations: [
      { id: 'a1', type: 'systeemraster', systeemTypeId: 'st-bandraster-300x1200', ifcCategory: 'IfcCovering' },
      { id: 'b1', type: 'box' },
    ], modified: false },
    { annotations: [{ id: 'a2', type: 'systeemraster', systeemTypeId: 'st-plafond-600x600' }], modified: false },
  ];
  hertekend = 0;
  events = [];
  stopLuisteren = reg.onSysteemTypenGewijzigd((e) => events.push(e));
  await rust();
  globalThis.__stubCalls = {};
});

/** Een sessie met: een maat bewerkt, het bandraster in gebruik → omzetten en verwijderen. */
function bewerkteSessie() {
  const s = sessie('st-plafond-600x600');
  assert.equal(s.huidig().id, 'st-plafond-600x600');
  assert.equal(s.muteer({ celXMm: 625 }), true);
  s.selecteer('st-bandraster-300x1200');
  s.verwijder();
  assert.deepEqual(s.verwijderVraag(), { id: 'st-bandraster-300x1200', count: 1, doelId: 'st-plafond-600x600' });
  s.zetOmzetDoel('st-plafond-600x1200');
  s.bevestigOmzetten();
  assert.equal(s.verwijderVraag(), null);
  assert.equal(findSysteemType(s.werk(), 'st-bandraster-300x1200'), null, 'uit de werkkopie');
  return s;
}

test('Toepassen: één commit en één melding, omzettingen in de documenten, doc.modified', async () => {
  const s = bewerkteSessie();
  // Vóór Toepassen is er niets gebeurd.
  assert.equal(reg.getSysteemTypeById('st-plafond-600x600').celXMm, 600);
  assert.equal(documenten[0].annotations[0].systeemTypeId, 'st-bandraster-300x1200');
  assert.equal(events.length, 0);
  s.toepassen();
  assert.equal(events.length, 1, 'precies één melding');
  assert.equal(events[0].source, 'editor');
  assert.deepEqual(events[0].changes.map((c) => [c.id, c.change]),
    [['st-plafond-600x600', 'updated'], ['st-bandraster-300x1200', 'removed']]);
  assert.equal(reg.getSysteemTypeById('st-plafond-600x600').celXMm, 625);
  assert.equal(reg.getSysteemTypeById('st-bandraster-300x1200'), null);
  // De instance volgt het omzetdoel; alleen dat document is gewijzigd.
  assert.equal(documenten[0].annotations[0].systeemTypeId, 'st-plafond-600x1200');
  assert.equal(documenten[0].modified, true);
  assert.equal(documenten[1].modified, false);
  await rust();
  assert.equal(tellers().savePreferences, 1);
  // Na Toepassen zijn basis en werkkopie de nieuwe registrystand.
  assert.equal(s.heeftWijzigingen(), false);
  assert.deepEqual(kloon(s.werk()), kloon(reg.getSysteemTypenData()));
  // Nog eens Toepassen zonder verschil: geen commit, geen melding.
  s.toepassen();
  assert.equal(events.length, 1);
});

test('Annuleren: registry, documenten, opslag, meldingen en tool-keuze blijven ongemoeid', async () => {
  reg.zetToolSysteemType('st-plafond-600x1200');
  const voorRegistry = JSON.stringify(reg.getSysteemTypenData());
  const voorDocs = JSON.stringify(documenten);
  const s = bewerkteSessie();
  assert.equal(s.heeftWijzigingen(), true);
  s.annuleren();
  await rust();
  assert.equal(JSON.stringify(reg.getSysteemTypenData()), voorRegistry);
  assert.equal(JSON.stringify(documenten), voorDocs);
  assert.equal(events.length, 0);
  assert.deepEqual(tellers(), {});
  assert.equal(hertekend, 0);
  assert.equal(reg.getToolSysteemTypeId(), 'st-plafond-600x1200');
  // De weggegooide werkkopie en wachtrij kunnen niet alsnog toegepast worden.
  assert.equal(s.heeftWijzigingen(), false);
  s.toepassen();
  assert.equal(JSON.stringify(reg.getSysteemTypenData()), voorRegistry);
  assert.equal(JSON.stringify(documenten), voorDocs);
  assert.equal(events.length, 0);
  reg.zetToolSysteemType(null);
});

test('een type dat na het openen is geregistreerd, overleeft Toepassen; de gebruiker wint bij overlap', () => {
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  const s = sessie(EXT_ID);
  assert.equal(s.huidig().id, EXT_ID);
  // Na het openen: een nieuw type en een bijwerking door de extensie.
  reg.registreerSysteemType(EXT, 'later', DEF);
  reg.werkEigenSysteemTypeBij(EXT, EXT_ID, { celYMm: 1200 }, { expectedRevision: 1 });
  s.muteer({ naam: 'Mineraal (bewerkt)' });
  events.length = 0;
  s.toepassen();
  assert.ok(reg.getSysteemTypeById('ext:test.synthetisch#later'), 'niet verloren');
  const t = reg.getSysteemTypeById(EXT_ID);
  assert.equal(t.naam, 'Mineraal (bewerkt)');
  assert.equal(events.length, 1);
  assert.equal(events[0].changes[0].previousRevision, 2, 'de melding laat zien dat de registry intussen veranderde');
  assert.equal(reg.systeemTypeSnapshot(EXT_ID).userEdited, true);
});

test('focus: selecteren, een later geregistreerd type ophalen, een verwijderd type niet terughalen', () => {
  const s = sessie('st-plafond-600x600');
  s.muteer({ celXMm: 625 });
  assert.equal(s.focus('st-bandraster-300x1200'), true);
  assert.equal(s.huidig().id, 'st-bandraster-300x1200');
  assert.equal(findSysteemType(s.werk(), 'st-plafond-600x600').celXMm, 625, 'onbevestigde wijziging blijft staan');
  // Na het openen geregistreerd: ongewijzigd in basis én werkkopie.
  reg.registreerSysteemType(EXT, 'mineraal', DEF);
  assert.equal(s.focus(EXT_ID), true);
  assert.equal(s.huidig().id, EXT_ID);
  // In de werkkopie verwijderd: een focusverzoek haalt het niet terug.
  s.verwijder();
  assert.equal(findSysteemType(s.werk(), EXT_ID), null);
  assert.equal(s.focus(EXT_ID), false);
  assert.equal(findSysteemType(s.werk(), EXT_ID), null);
  assert.equal(s.focus('bestaat-niet'), false);
  // Een later geregistreerd type is na Toepassen gewoon aanwezig (niet als nieuw).
  events.length = 0;
  s.toepassen();
  assert.deepEqual(events[0].changes.map((c) => [c.id, c.change]).sort(),
    [[EXT_ID, 'removed'], ['st-plafond-600x600', 'updated']]);
});

test('bewerken: maten buiten het bereik en klein > raveel worden geweigerd; leeg is onbevestigd', () => {
  const s = sessie('st-plafond-600x600');
  const voor = JSON.stringify(s.werk());
  assert.equal(s.muteer({ celXMm: 30 }), false);
  assert.match(s.melding(), /Celmaat X moet tussen 50 en 20000 mm liggen/);
  assert.equal(s.muteer({ celYMm: Number.NaN }), false);
  assert.equal(s.muteer({ strookBreedteMm: 25000 }), false);
  assert.equal(s.muteer({ sparingRegels: { kleineSparingMaxMm: 900, raveelVanafMm: 800 } }), false);
  assert.match(s.melding(), /klein/);
  assert.equal(s.muteer({ sparingRegels: { kleineSparingMaxMm: 5, raveelVanafMm: 800 } }), false);
  assert.equal(JSON.stringify(s.werk()), voor, 'de werkkopie is niet veranderd');
  // Een geldige waarde wist de melding; een leeg veld maakt de maat onbevestigd.
  assert.equal(s.muteer({ celXMm: 625 }), true);
  assert.equal(s.melding(), null);
  assert.equal(s.muteer({ celYMm: undefined }), true);
  assert.equal('celYMm' in s.huidig(), false, 'geen standaardmaat');
  assert.equal(s.muteer({ sparingRegels: { kleineSparingMaxMm: undefined, raveelVanafMm: 800 } }), true);
  assert.deepEqual(s.huidig().sparingRegels, { raveelVanafMm: 800 });
});

test('een luisteraar hoort elke verandering van de sessie', () => {
  const s = sessie();
  let n = 0;
  s.luister(() => { n++; });
  s.selecteer('st-plafond-600x1200');
  s.muteer({ naam: 'X' });
  s.muteer({ celXMm: 1 }); // geweigerd: de melding verandert wel
  s.nieuw();
  s.dupliceer();
  assert.equal(n, 5);
  assert.equal(s.typen().length, createDefaultSysteemTypen().typen.length + 2);
});
