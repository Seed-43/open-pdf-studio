import test from 'node:test';
import assert from 'node:assert/strict';
import { maakFoutvanger, beschrijf, isOnschuldig, MAX_TEKST } from './foutvanger.js';

function opzet(opties = {}) {
  const log = [];
  const nood = [];
  let klok = 0;
  const vanger = maakFoutvanger({
    noodopslag: async (soort) => { nood.push(soort); if (opties.noodopslag) await opties.noodopslag(vanger); },
    schrijfLog: async (soort, tekst) => { log.push([soort, tekst]); if (opties.schrijfLog) await opties.schrijfLog(vanger); },
    nu: () => klok,
    ...opties.extra,
  });
  return { vanger, log, nood, zetKlok: (t) => { klok = t; } };
}

test('fout: logregel en noodmomentopname', async () => {
  const { vanger, log, nood } = opzet();
  const e = new TypeError('x is undefined');
  assert.equal(await vanger.bijFout('js-error', { error: e, message: e.message }), 'afgehandeld');
  assert.equal(log.length, 1);
  assert.equal(log[0][0], 'js-error');
  assert.match(log[0][1], /^TypeError: x is undefined/);
  assert.deepEqual(nood, ['js-error']);
});

test('recursie: een fout tijdens de noodmomentopname start geen nieuwe ronde', async () => {
  let binnen = null;
  const { vanger, nood, log } = opzet({
    noodopslag: async (v) => {
      // De noodmomentopname zelf gooit, en dat komt als nieuwe fout binnen.
      binnen = await v.bijFout('js-error', { error: new Error('fout in de noodopslag') });
      throw new Error('noodopslag mislukt');
    },
  });
  assert.equal(await vanger.bijFout('js-unhandled-rejection', { reason: new Error('eerste') }), 'afgehandeld');
  assert.equal(binnen, 'recursie');
  assert.deepEqual(nood, ['js-unhandled-rejection'], 'one emergency snapshot only');
  assert.equal(log.length, 2, 'the inner error is still logged');
  assert.match(log[1][1], /fout in de noodopslag[\s\S]*while a previous error was being handled/);
  assert.equal(vanger.telling.recursie, 1);
  assert.equal(vanger.isBezig(), false, 'na afloop weer vrij');
});

test('recursie: een fout in het log zelf start geen nieuwe ronde', async () => {
  let binnen = null;
  const { vanger, nood, log } = opzet({
    schrijfLog: async (v) => {
      binnen = await v.bijFout('js-error', new Error('log kapot'));
      throw new Error('log kapot');
    },
  });
  assert.equal(await vanger.bijFout('js-error', new Error('eerste')), 'afgehandeld');
  assert.equal(binnen, 'recursie');
  assert.equal(log.length, 2, 'the error from the log is logged once afterwards, the next one is dropped');
  assert.equal(nood.length, 1, 'de noodopslag gaat gewoon door');
});

test('tussenpoos: een fout in een lus geeft niet telkens een noodmomentopname', async () => {
  const { vanger, nood, log, zetKlok } = opzet();
  for (let i = 0; i < 20; i++) {
    zetKlok(i * 100);
    await vanger.bijFout('js-error', new Error(`tekenlus ${i}`));
  }
  assert.equal(nood.length, 1);
  assert.equal(log.length, 20);
  zetKlok(16_000);
  await vanger.bijFout('js-error', new Error('later'));
  assert.equal(nood.length, 2);
});

test('logregels: hooguit maxLogRegels per sessie', async () => {
  const { vanger, log } = opzet({ extra: { maxLogRegels: 3 } });
  for (let i = 0; i < 10; i++) await vanger.bijFout('js-error', new Error(String(i)));
  assert.equal(log.length, 3);
});

test('onschuldige meldingen tellen niet', async () => {
  const { vanger, log, nood } = opzet();
  assert.equal(await vanger.bijFout('js-error', { message: 'ResizeObserver loop completed with undelivered notifications.' }), 'onschuldig');
  assert.equal(await vanger.bijFout('js-error', { message: 'Script error.' }), 'onschuldig');
  assert.equal(log.length + nood.length, 0);
  assert.equal(isOnschuldig('TypeError: a'), false);
});

test('beschrijf: allerlei vormen, en ingekort', () => {
  assert.match(beschrijf({ message: 'Boem', filename: 'app.js', lineno: 3, colno: 9 }), /^Boem \(app\.js:3:9\)$/);
  assert.match(beschrijf({ reason: 'tekst' }), /^Unhandled rejection: tekst$/);
  assert.match(beschrijf({ reason: new RangeError('r') }), /^RangeError: r/);
  assert.equal(beschrijf(new Error('één keer')).split('één keer').length, 2, 'message not repeated before the stack');
  assert.equal(beschrijf('los'), 'los');
  const lang = beschrijf(new Error('x'.repeat(MAX_TEKST * 2)));
  assert.ok(lang.length <= MAX_TEKST + 20);
});

test('installeer: luistert op error en unhandledrejection, en weer los', async () => {
  const luisteraars = new Map();
  const g = {
    addEventListener: (soort, f) => luisteraars.set(soort, f),
    removeEventListener: (soort) => luisteraars.delete(soort),
  };
  const { vanger, log } = opzet();
  const los = vanger.installeer(g);
  assert.deepEqual([...luisteraars.keys()].sort(), ['error', 'unhandledrejection']);
  luisteraars.get('unhandledrejection')({ reason: new Error('async') });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(log[0][0], 'js-unhandled-rejection');
  los();
  assert.equal(luisteraars.size, 0);
});

test('recursie: fouten tijdens de afhandeling komen na afloop in het log, begrensd', async () => {
  const { vanger, log, nood } = opzet({
    noodopslag: async (v) => {
      for (let i = 0; i < 25; i++) v.bijFout('js-error', new Error(`gelijktijdig ${i}`));
    },
  });
  assert.equal(await vanger.bijFout('js-error', new Error('eerste')), 'afgehandeld');
  assert.equal(nood.length, 1);
  assert.equal(log.length, 1 + 10, 'first error plus at most MAX_WACHTRIJ queued ones');
  assert.match(log[1][1], /gelijktijdig 0[\s\S]*\n\(raised while a previous error was being handled\)/);
  assert.equal(vanger.isBezig(), false);
});
