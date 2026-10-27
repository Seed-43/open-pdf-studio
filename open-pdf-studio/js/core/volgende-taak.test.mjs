// node js/core/volgende-taak.test.mjs
import assert from 'node:assert/strict';
import { volgendeTaak } from './volgende-taak.js';

// scheduler.yield als die er is.
{
  let gevraagd = 0;
  await volgendeTaak({ scheduler: { yield: () => { gevraagd++; return Promise.resolve(); } } });
  assert.equal(gevraagd, 1);
}

// Anders een MessageChannel: vervult pas na de lopende microtaken (een nieuwe taak).
{
  const volgorde = [];
  const beurt = volgendeTaak({ MessageChannel }).then(() => volgorde.push('taak'));
  Promise.resolve().then(() => volgorde.push('microtaak'));
  await beurt;
  assert.deepEqual(volgorde, ['microtaak', 'taak']);
}

// Zonder beide: setTimeout.
{
  let ms = null;
  await volgendeTaak({ setTimeout: (f, t) => { ms = t; f(); } });
  assert.equal(ms, 0);
}

console.log('volgende-taak: alle tests geslaagd');
