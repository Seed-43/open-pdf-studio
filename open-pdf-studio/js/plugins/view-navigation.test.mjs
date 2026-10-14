import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewNavigation } from './view-navigation.js';

// Wacht tot de lopende aanroep bij de paginawissel is.
async function tot(voorwaarde) {
  for (let i = 0; i < 100 && !voorwaarde(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(voorwaarde(), 'de aanroep kwam niet bij de paginawissel');
}
const bijPagina = (o) => () => o.log.some(([wat]) => wat === 'goToPage');

// Synthetische documenten: twee ruimten op twee pagina's, geen PDF nodig.
function omgeving() {
  const tekening = {
    id: 'drawing-1', numPages: 3, currentPage: 1,
    annotations: [
      { id: 'room-a', type: 'measureArea', page: 1, x: 10, y: 10, width: 50, height: 40 },
      { id: 'room-b', type: 'measureArea', page: 2, x: 20, y: 30, width: 60, height: 30 },
      { id: 'tag-a', type: 'text', page: 1, x: 12, y: 12 },
      { id: 'hidden-1', type: 'box', page: 1, hidden: true },
      { id: 'locked-1', type: 'box', page: 1, layer: 'vast' },
    ],
    selectedAnnotations: [],
  };
  const ander = { id: 'drawing-2', numPages: 1, currentPage: 1, annotations: [
    { id: 'room-a', type: 'measureArea', page: 1 },
  ], selectedAnnotations: [] };
  const state = { documents: [tekening, ander], active: 0 };
  const log = [];
  let paginaWacht = null;
  const host = {
    documents: () => state.documents,
    activeDocument: () => state.documents[state.active] || null,
    pageCount: (doc) => doc.numPages,
    async goToPage(doc, page) {
      // Zoals de app: de pagina wisselt meteen, het tekenen volgt.
      log.push(['goToPage', doc.id, page]);
      doc.currentPage = page;
      if (paginaWacht) await paginaWacht;
    },
    async loadPageAnnotations(doc, page) {
      log.push(['load', doc.id, page]);
      if (page === 3 && !doc.annotations.some((a) => a.id === 'late-1')) {
        doc.annotations.push({ id: 'late-1', type: 'box', page: 3 });
      }
    },
    // Zoals de app: modules laden kost een wachtmoment.
    async prepare() { await new Promise((r) => setImmediate(r)); },
    isHidden: (doc, ann) => !!ann.hidden,
    isLocked: (doc, ann) => ann.layer === 'vast',
    select(doc, anns) {
      log.push(['select', doc.id, anns.map((a) => a.id)]);
      doc.selectedAnnotations = anns;
      for (const fn of luisteraars) fn(anns.length === 1 ? anns[0] : null);
    },
    reveal(doc, anns) { log.push(['reveal', doc.id, anns.map((a) => a.id)]); },
  };
  const luisteraars = [];
  return {
    tekening, ander, state, log, host, luisteraars,
    wachtOpPagina() { let los; paginaWacht = new Promise((r) => { los = r; }); return () => { paginaWacht = null; los(); }; },
  };
}

test('een lijst met twee ruimten springt naar de tekening en selecteert het object', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  // De extensie volgt de selectie via de bestaande listener.
  const gemarkeerd = [];
  o.luisteraars.push((ann) => gemarkeerd.push(ann?.id ?? null));
  const lijst = o.tekening.annotations.filter((a) => a.type === 'measureArea');
  assert.deepEqual(lijst.map((a) => a.id), ['room-a', 'room-b']);

  const r = await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-b', page: 2 });
  assert.deepEqual(r, { ok: true, documentId: 'drawing-1', page: 2, ids: ['room-b'] });
  assert.deepEqual(o.log, [
    ['goToPage', 'drawing-1', 2],
    ['select', 'drawing-1', ['room-b']],
    ['reveal', 'drawing-1', ['room-b']],
  ]);
  assert.deepEqual(gemarkeerd, ['room-b']);

  // Terug naar de eerste ruimte: ook de selectie op de pagina meldt zich.
  const r2 = await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-a' });
  assert.equal(r2.ok, true);
  assert.equal(o.tekening.currentPage, 1);
  assert.deepEqual(gemarkeerd, ['room-b', 'room-a']);
});

test('navigeren naar een geldige pagina, en ongeldige pagina\'s geven een fout zonder navigatie', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  assert.deepEqual(await nav.navigateToPage({ documentId: 'drawing-1', page: 3 }),
    { ok: true, documentId: 'drawing-1', page: 3 });
  for (const page of [0, 4, 1.5, '2', undefined]) {
    const r = await nav.navigateToPage({ documentId: 'drawing-1', page });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'invalidPage');
    assert.equal(r.pageCount, 3);
  }
  assert.deepEqual(o.log, [['goToPage', 'drawing-1', 3]]);
  // De huidige pagina: geen herladen (dat zou de selectie wissen).
  const huidig = await nav.navigateToPage({ documentId: 'drawing-1', page: 3 });
  assert.equal(huidig.ok, true);
  assert.equal(o.log.length, 1);
});

test('ongeldige ids en verborgen of vergrendelde objecten laten de selectie ongemoeid', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const voor = o.tekening.selectedAnnotations;
  const gevallen = [
    [{ documentId: 'drawing-1', ids: ['room-a', 'nope'] }, 'annotationNotFound'],
    [{ documentId: 'drawing-1', ids: [] }, 'invalidArgument'],
    [{ documentId: 'drawing-1', ids: 'room-a' }, 'invalidArgument'],
    [{ documentId: 'drawing-1', ids: ['room-a', 'room-b'] }, 'multiplePages'],
    [{ documentId: 'drawing-1', ids: ['hidden-1'] }, 'annotationHidden'],
    [{ documentId: 'drawing-1', ids: ['locked-1'] }, 'annotationLocked'],
    [{ documentId: 'gone', ids: ['room-a'] }, 'documentClosed'],
    [{ documentId: 'drawing-2', ids: ['room-a'] }, 'documentNotActive'],
    [{ ids: ['room-a'] }, 'invalidArgument'],
  ];
  for (const [args, code] of gevallen) {
    const r = await nav.selectAnnotations(args);
    assert.equal(r.ok, false, JSON.stringify(args));
    assert.equal(r.code, code, JSON.stringify(args));
    assert.equal(typeof r.message, 'string');
  }
  assert.deepEqual((await nav.selectAnnotations({ documentId: 'drawing-1', ids: ['room-a', 'nope'] })).missing, ['nope']);
  const f = await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-a', page: 2 });
  assert.equal(f.code, 'pageMismatch');
  assert.equal(f.page, 1);
  assert.equal((await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-a', page: 9 })).code, 'invalidPage');
  assert.equal((await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'x', page: 1 })).code, 'annotationNotFound');
  assert.equal(o.tekening.selectedAnnotations, voor);
  assert.ok(!o.log.some(([wat]) => wat === 'select' || wat === 'goToPage'), JSON.stringify(o.log));
});

test('meerdere objecten op één pagina selecteren, met focus op verzoek', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const r = await nav.selectAnnotations({ documentId: 'drawing-1', ids: ['room-a', 'tag-a', 'room-a'] });
  assert.deepEqual(r, { ok: true, documentId: 'drawing-1', page: 1, ids: ['room-a', 'tag-a'] });
  assert.deepEqual(o.log, [['select', 'drawing-1', ['room-a', 'tag-a']]], 'geen navigatie, geen focus');
  await nav.selectAnnotations({ documentId: 'drawing-1', ids: ['room-b'], focus: true });
  assert.deepEqual(o.log.slice(1), [
    ['goToPage', 'drawing-1', 2],
    ['select', 'drawing-1', ['room-b']],
    ['reveal', 'drawing-1', ['room-b']],
  ]);
});

test('wisselen van tabblad tijdens een lopende focus selecteert niets in het andere document', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const los = o.wachtOpPagina();
  const lopend = nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-b', page: 2 });
  await tot(bijPagina(o));
  o.state.active = 1;                       // de gebruiker wisselt van tabblad
  los();
  const r = await lopend;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'documentChanged');
  assert.ok(!o.log.some(([wat]) => wat === 'select'));
  assert.deepEqual(o.ander.selectedAnnotations, [], 'het andere document (met ook een room-a) blijft onaangeroerd');
});

test('sluiten van het document tijdens een lopende focus geeft documentClosed', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const los = o.wachtOpPagina();
  const lopend = nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-b' });
  await tot(bijPagina(o));
  o.state.documents = [o.ander];            // tabblad gesloten, het andere staat voor
  o.state.active = 0;
  los();
  const r = await lopend;
  assert.equal(r.code, 'documentClosed');
  assert.ok(!o.log.some(([wat]) => wat === 'select'));
});

test('een nieuwere aanroep wint van een oudere die nog wacht', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const los = o.wachtOpPagina();
  const oud = nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-b' });
  await tot(bijPagina(o));
  const nieuw = nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'room-a' });
  los();
  assert.equal((await oud).code, 'superseded');
  assert.equal((await nieuw).ok, true);
  assert.deepEqual(o.log.filter(([wat]) => wat === 'select'), [['select', 'drawing-1', ['room-a']]]);
  assert.equal(o.tekening.currentPage, 1, 'de weergave staat op de pagina van de laatste aanroep');
});

test('focus met een pagina laadt de annotaties van die pagina zonder eerst te navigeren', async () => {
  const o = omgeving();
  const nav = createViewNavigation(o.host);
  const r = await nav.focusAnnotation({ documentId: 'drawing-1', annotationId: 'late-1', page: 3 });
  assert.equal(r.ok, true);
  assert.deepEqual(o.log.slice(0, 2), [['load', 'drawing-1', 3], ['goToPage', 'drawing-1', 3]]);
  // Bestaat het object ook na het laden niet, dan is er niet genavigeerd.
  const o2 = omgeving();
  const nav2 = createViewNavigation(o2.host);
  assert.equal((await nav2.focusAnnotation({ documentId: 'drawing-1', annotationId: 'nope', page: 2 })).code,
    'annotationNotFound');
  assert.deepEqual(o2.log, [['load', 'drawing-1', 2]]);
});
