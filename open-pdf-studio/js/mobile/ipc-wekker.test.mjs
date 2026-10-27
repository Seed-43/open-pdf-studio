// Android (#596): na de bestandskiezer wekt de app het IPC-kanaal een paar
// seconden lang, zodat het gekozen bestand ook echt opent.
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { startIpcWekker } from './ipc-wekker.js';

function nepDoel() {
  const luisteraars = new Map();
  return {
    visibilityState: 'visible',
    addEventListener: (soort, f) => luisteraars.set(soort, f),
    removeEventListener: (soort) => luisteraars.delete(soort),
    vuur: (soort) => luisteraars.get(soort)?.(),
    luisteraars,
  };
}

test('zichtbaar worden wekt het kanaal, een paar seconden lang', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const doc = nepDoel();
    const win = nepDoel();
    let pings = 0;
    const stop = startIpcWekker({ ping: () => pings++, doc, win, duur: 1000, interval: 100 });
    assert.equal(pings, 0, 'niets zolang er niets gebeurt');
    doc.vuur('visibilitychange');
    assert.equal(pings, 1, 'direct een ping');
    mock.timers.tick(500);
    assert.ok(pings >= 5, `blijft pingen (${pings})`);
    mock.timers.tick(2000);
    const na = pings;
    mock.timers.tick(1000);
    assert.equal(pings, na, 'stopt na de duur');
    win.vuur('focus');
    assert.equal(pings, na + 1, 'focus wekt ook');
    stop();
    assert.equal(doc.luisteraars.size, 0);
    assert.equal(win.luisteraars.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test('verborgen worden wekt niets', () => {
  const doc = nepDoel();
  doc.visibilityState = 'hidden';
  let pings = 0;
  const stop = startIpcWekker({ ping: () => pings++, doc, win: nepDoel() });
  doc.vuur('visibilitychange');
  assert.equal(pings, 0);
  stop();
});
