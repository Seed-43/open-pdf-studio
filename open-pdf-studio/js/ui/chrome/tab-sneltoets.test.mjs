// Sneltoetsen om tussen documenttabbladen te wisselen (#539): Ctrl+Tab /
// Ctrl+PageDown = volgende, Ctrl+Shift+Tab / Ctrl+PageUp = vorige, met omloop.
// Getest: welke toetsen meetellen, de volgorde (ook met het
// vergelijkingstabblad), de bewaking tijdens typen en de rem op
// toetsherhaling (hoogstens één wissel in de wacht).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTextEntryTarget,
  tabSneltoetsRichting,
  tabWisselToegestaan,
  volgendTabDoel,
  voerTabWisselUit,
  maakTabWisselaar,
  maakTabSneltoetsHandler,
} from './tab-sneltoets.js';

const toets = (key, mods = {}) => ({
  key,
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  ...mods,
});

// ── Welke toetsen ───────────────────────────────────────────────────────────

test('Ctrl+Tab en Ctrl+PageDown gaan naar het volgende tabblad', () => {
  assert.equal(tabSneltoetsRichting(toets('Tab', { ctrlKey: true })), 1);
  assert.equal(tabSneltoetsRichting(toets('PageDown', { ctrlKey: true })), 1);
});

test('Ctrl+Shift+Tab en Ctrl+PageUp gaan naar het vorige tabblad', () => {
  assert.equal(tabSneltoetsRichting(toets('Tab', { ctrlKey: true, shiftKey: true })), -1);
  assert.equal(tabSneltoetsRichting(toets('PageUp', { ctrlKey: true })), -1);
});

test('andere combinaties zijn geen tabwissel', () => {
  const geen = [
    toets('Tab'),
    toets('Tab', { shiftKey: true }),
    toets('PageDown'),
    toets('PageUp'),
    // AltGr is op Windows Ctrl+Alt: nooit als tabwissel lezen.
    toets('Tab', { ctrlKey: true, altKey: true }),
    toets('PageDown', { ctrlKey: true, altKey: true }),
    // Ctrl+Shift+PageUp/PageDown is elders "tabblad verplaatsen": niet kapen.
    toets('PageDown', { ctrlKey: true, shiftKey: true }),
    toets('PageUp', { ctrlKey: true, shiftKey: true }),
    toets('Tab', { metaKey: true }),
    toets('Tab', { ctrlKey: true, metaKey: true }),
    toets('t', { ctrlKey: true }),
    toets('ArrowRight', { ctrlKey: true }),
  ];
  for (const e of geen) assert.equal(tabSneltoetsRichting(e), 0, JSON.stringify(e));
  assert.equal(tabSneltoetsRichting(null), 0);
  assert.equal(tabSneltoetsRichting({}), 0);
});

// ── Volgorde ────────────────────────────────────────────────────────────────

test('volgende en vorige lopen rond over de documenten', () => {
  const stand = (actieveIndex) => ({ aantalDocumenten: 3, actieveIndex });
  assert.deepEqual(volgendTabDoel(stand(0), 1), { soort: 'document', index: 1 });
  assert.deepEqual(volgendTabDoel(stand(1), 1), { soort: 'document', index: 2 });
  assert.deepEqual(volgendTabDoel(stand(2), 1), { soort: 'document', index: 0 }, 'na de laatste weer de eerste');
  assert.deepEqual(volgendTabDoel(stand(0), -1), { soort: 'document', index: 2 }, 'voor de eerste de laatste');
  assert.deepEqual(volgendTabDoel(stand(2), -1), { soort: 'document', index: 1 });
});

test('met twee documenten wisselt de toets steeds tussen die twee', () => {
  let index = 0;
  const bezocht = [];
  for (let i = 0; i < 6; i++) {
    const doel = volgendTabDoel({ aantalDocumenten: 2, actieveIndex: index }, 1);
    index = doel.index;
    bezocht.push(index);
  }
  assert.deepEqual(bezocht, [1, 0, 1, 0, 1, 0]);
});

test('met één of geen tabblad doet de sneltoets niets', () => {
  assert.equal(volgendTabDoel({ aantalDocumenten: 1, actieveIndex: 0 }, 1), null);
  assert.equal(volgendTabDoel({ aantalDocumenten: 1, actieveIndex: 0 }, -1), null);
  assert.equal(volgendTabDoel({ aantalDocumenten: 0, actieveIndex: -1 }, 1), null);
  // Alleen een vergelijking zonder documenten: ook maar één tabblad.
  assert.equal(volgendTabDoel({ aantalDocumenten: 0, actieveIndex: -1, vergelijkActief: true, vergelijkGefocust: true }, 1), null);
  assert.equal(volgendTabDoel({ aantalDocumenten: 3, actieveIndex: 1 }, 0), null, 'geen richting, geen wissel');
});

test('het vergelijkingstabblad staat achteraan in de rij', () => {
  const basis = { aantalDocumenten: 2, vergelijkActief: true };
  assert.deepEqual(volgendTabDoel({ ...basis, actieveIndex: 1 }, 1), { soort: 'vergelijk' });
  assert.deepEqual(volgendTabDoel({ ...basis, actieveIndex: 0 }, -1), { soort: 'vergelijk' });
  assert.deepEqual(volgendTabDoel({ ...basis, actieveIndex: 1, vergelijkGefocust: true }, 1), { soort: 'document', index: 0 });
  assert.deepEqual(volgendTabDoel({ ...basis, actieveIndex: 0, vergelijkGefocust: true }, -1), { soort: 'document', index: 1 });
  // Eén document plus de vergelijking: twee tabbladen, dus wel wisselen.
  assert.deepEqual(volgendTabDoel({ aantalDocumenten: 1, actieveIndex: 0, vergelijkActief: true }, 1), { soort: 'vergelijk' });
  // Een niet-actieve vergelijking telt niet mee, ook als de focusvlag nog staat.
  assert.deepEqual(volgendTabDoel({ aantalDocumenten: 2, actieveIndex: 1, vergelijkGefocust: true }, 1), { soort: 'document', index: 0 });
});

test('het doel wordt uitgevoerd zoals een klik op het tabblad', () => {
  const log = [];
  const middelen = {
    switchToTab: (i) => { log.push(['switch', i]); return 'render'; },
    focusCompareTab: () => log.push(['focus-vergelijk']),
    blurCompareTab: () => log.push(['blur-vergelijk']),
  };
  assert.equal(voerTabWisselUit({ soort: 'document', index: 2 }, middelen), 'render', 'de render-belofte komt terug');
  assert.deepEqual(log, [['blur-vergelijk'], ['switch', 2]]);
  log.length = 0;
  assert.equal(voerTabWisselUit({ soort: 'vergelijk' }, middelen), undefined);
  assert.deepEqual(log, [['focus-vergelijk']]);
  log.length = 0;
  assert.equal(voerTabWisselUit(null, middelen), undefined);
  assert.deepEqual(log, [], 'geen doel, niets gedaan');
});

// ── Bewaking ────────────────────────────────────────────────────────────────

const element = (props = {}) => ({ tagName: 'DIV', isContentEditable: false, closest: () => null, ...props });

test('in een tekstinvoer wisselt de sneltoets niet van tabblad', () => {
  const doelen = [
    element({ tagName: 'INPUT' }),
    element({ tagName: 'TEXTAREA' }),
    element({ isContentEditable: true }),
    // Een kind binnen een contenteditable-editor (de PDF-teksteditor).
    element({ tagName: 'SPAN', closest: (sel) => (sel === '[contenteditable="true"]' ? {} : null) }),
  ];
  for (const target of doelen) {
    assert.equal(isTextEntryTarget(target), true);
    assert.equal(tabWisselToegestaan({ target }), false, target.tagName);
  }
});

test('buiten een tekstinvoer wisselt de sneltoets, waar de focus ook staat', () => {
  for (const target of [
    element({ tagName: 'CANVAS' }),
    element({ tagName: 'BUTTON' }),
    element({ tagName: 'SELECT' }),
    element({ tagName: 'BODY' }),
    element({ tagName: 'DIV', closest: undefined }),
    null,
  ]) {
    assert.equal(isTextEntryTarget(target), false);
    assert.equal(tabWisselToegestaan({ target }), true, target?.tagName ?? 'geen doel');
  }
});

test('een open dialoog, tekstbewerking of lopende sessie houdt het tabblad vast', () => {
  const e = { target: element({ tagName: 'CANVAS' }) };
  assert.equal(tabWisselToegestaan(e, { modaalOpen: true }), false);
  assert.equal(tabWisselToegestaan(e, { tekstBewerking: true }), false);
  assert.equal(tabWisselToegestaan(e, { bezigeSessie: true }), false);
  assert.equal(tabWisselToegestaan(e, { modaalOpen: false, tekstBewerking: false, bezigeSessie: false }), true);
});

// ── Toetsafhandeling (capture-fase op window) ──────────────────────────────

function proefHandler(bewaking = {}) {
  const gevraagd = [];
  const handler = maakTabSneltoetsHandler({
    wisselaar: { vraag: (r) => { gevraagd.push(r); return true; } },
    bewaking: () => bewaking,
  });
  const druk = (key, mods = {}, target = element({ tagName: 'CANVAS' })) => {
    let voorkomen = false;
    let gestopt = false;
    handler({
      ...toets(key, mods),
      target,
      preventDefault() { voorkomen = true; },
      stopPropagation() { gestopt = true; },
      stopImmediatePropagation() { gestopt = true; },
    });
    return { voorkomen, gestopt };
  };
  return { gevraagd, druk };
}

test('de sneltoets vraagt een wissel en houdt de standaardactie van de webview tegen', () => {
  const p = proefHandler();
  assert.deepEqual(p.druk('Tab', { ctrlKey: true }), { voorkomen: true, gestopt: false });
  assert.deepEqual(p.druk('Tab', { ctrlKey: true, shiftKey: true }).voorkomen, true);
  assert.deepEqual(p.druk('PageDown', { ctrlKey: true }).voorkomen, true);
  assert.deepEqual(p.druk('PageUp', { ctrlKey: true }).voorkomen, true);
  assert.deepEqual(p.gevraagd, [1, -1, 1, -1]);
});

test('ook ingedrukt gehouden (repeat) gaat elke toetsaanslag naar de rem', () => {
  const p = proefHandler();
  for (let i = 0; i < 5; i++) p.druk('Tab', { ctrlKey: true, repeat: i > 0 });
  assert.deepEqual(p.gevraagd, [1, 1, 1, 1, 1]);
});

test('andere toetsen laat de handler volledig met rust', () => {
  const p = proefHandler();
  assert.deepEqual(p.druk('Tab'), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.druk('PageDown'), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.druk('s', { ctrlKey: true }), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.gevraagd, []);
});

test('tijdens typen blijft de toets van het invoerveld', () => {
  const p = proefHandler();
  assert.deepEqual(p.druk('Tab', { ctrlKey: true }, element({ tagName: 'INPUT' })), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.druk('PageDown', { ctrlKey: true }, element({ tagName: 'TEXTAREA' })), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.druk('Tab', { ctrlKey: true }, element({ isContentEditable: true })), { voorkomen: false, gestopt: false });
  assert.deepEqual(p.gevraagd, []);
});

test('met een open dialoog of lopende bewerking wisselt de sneltoets niet', () => {
  for (const bewaking of [{ modaalOpen: true }, { tekstBewerking: true }, { bezigeSessie: true }]) {
    const p = proefHandler(bewaking);
    assert.deepEqual(p.druk('Tab', { ctrlKey: true }), { voorkomen: false, gestopt: false }, JSON.stringify(bewaking));
    assert.deepEqual(p.gevraagd, []);
  }
});

// ── Rem op toetsherhaling ───────────────────────────────────────────────────

function uitgesteld() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const rust = () => new Promise((r) => setImmediate(r));

function proefWisselaar({ maxWachtMs = 500 } = {}) {
  const wissels = [];
  const renders = [];
  const beelden = [];
  const timers = [];
  const wisselaar = maakTabWisselaar({
    wissel: (richting) => {
      wissels.push(richting);
      const r = uitgesteld();
      renders.push(r);
      return r.promise;
    },
    naBeeld: () => {
      const b = uitgesteld();
      beelden.push(b);
      return b.promise;
    },
    wacht: (ms) => {
      const t = uitgesteld();
      timers.push({ ms, ...t });
      return t.promise;
    },
    maxWachtMs,
  });
  // Laat de laatste wissel klaar zijn en in beeld komen.
  async function rondAf() {
    renders.at(-1).resolve();
    await rust();
    beelden.at(-1).resolve();
    await rust();
  }
  return { wisselaar, wissels, renders, beelden, timers, rondAf };
}

test('de eerste druk wisselt direct', () => {
  const p = proefWisselaar();
  assert.equal(p.wisselaar.vraag(1), true);
  assert.deepEqual(p.wissels, [1]);
  assert.equal(p.wisselaar.bezig, true);
});

test('ingedrukt houden bouwt geen achterstand op: hoogstens één wissel wacht', async () => {
  const p = proefWisselaar();
  p.wisselaar.vraag(1);
  // Toetsherhaling terwijl de eerste wissel nog rendert.
  for (let i = 0; i < 20; i++) assert.equal(p.wisselaar.vraag(1), false);
  assert.deepEqual(p.wissels, [1], 'niets extra uitgevoerd zolang de wissel loopt');
  assert.equal(p.wisselaar.wachtend, 1);

  await p.rondAf();
  assert.deepEqual(p.wissels, [1, 1], 'precies één wachtende wissel uitgevoerd');
  assert.equal(p.wisselaar.wachtend, 0);

  await p.rondAf();
  assert.deepEqual(p.wissels, [1, 1], 'daarna niets meer: de toets is los');
  assert.equal(p.wisselaar.bezig, false);
});

test('de volgende wissel wacht tot de vorige in beeld staat', async () => {
  const p = proefWisselaar();
  p.wisselaar.vraag(1);
  p.wisselaar.vraag(1);
  p.renders[0].resolve();
  await rust();
  assert.deepEqual(p.wissels, [1], 'render klaar, maar nog geen frame getoond');
  p.beelden[0].resolve();
  await rust();
  assert.deepEqual(p.wissels, [1, 1]);
});

test('de laatst gevraagde richting telt voor de wachtende wissel', async () => {
  const p = proefWisselaar();
  p.wisselaar.vraag(1);
  p.wisselaar.vraag(1);
  p.wisselaar.vraag(-1);
  await p.rondAf();
  assert.deepEqual(p.wissels, [1, -1]);
});

test('een trage render houdt de sneltoets niet eindeloos vast', async () => {
  const p = proefWisselaar({ maxWachtMs: 300 });
  p.wisselaar.vraag(1);
  p.wisselaar.vraag(1);
  assert.equal(p.timers[0].ms, 300);
  // De render blijft hangen; de tijdslimiet loopt af.
  p.timers[0].resolve();
  await rust();
  p.beelden[0].resolve();
  await rust();
  assert.deepEqual(p.wissels, [1, 1], 'na de tijdslimiet gaat de wachtende wissel toch');
});

test('een wissel zonder render (één tabblad, vergelijking) of met een fout blokkeert niets', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const wissels = [];
  const wisselaar = maakTabWisselaar({
    wissel: (r) => {
      wissels.push(r);
      if (wissels.length === 1) throw new Error('kapot');
      if (wissels.length === 2) return Promise.reject(new Error('render mislukt'));
      return undefined;
    },
    naBeeld: () => Promise.resolve(),
    wacht: () => new Promise(() => {}),
  });
  wisselaar.vraag(1);
  await rust();
  assert.equal(wisselaar.bezig, false);
  wisselaar.vraag(1);
  await rust();
  assert.equal(wisselaar.bezig, false);
  wisselaar.vraag(-1);
  await rust();
  assert.equal(wisselaar.bezig, false);
  assert.deepEqual(wissels, [1, 1, -1]);
});

test('zonder richting wordt niets gevraagd', () => {
  const p = proefWisselaar();
  assert.equal(p.wisselaar.vraag(0), false);
  assert.deepEqual(p.wissels, []);
});
