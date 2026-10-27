// node js/solid/components/ribbon/na-lettertypen.test.mjs
import assert from 'node:assert/strict';
import { naLettertypen } from './na-lettertypen.js';

function nepVenster() {
  const frames = [];
  let fontsGelezen = 0;
  let klaar;
  const ready = new Promise((r) => { klaar = r; });
  const venster = {
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: (id) => { frames[id - 1] = null; },
    document: { fonts: { get ready() { fontsGelezen++; return ready; } } },
  };
  return {
    venster,
    frame: () => { const f = frames.splice(0).filter(Boolean); f.forEach((x) => x()); },
    gelezen: () => fontsGelezen,
    klaar,
  };
}

const rust = () => new Promise((r) => setTimeout(r, 0));

// document.fonts.ready wordt niet gelezen tijdens de aanroep (de opstarttaak),
// pas in het volgende frame; daarna meet hij als de lettertypen klaar zijn.
{
  const v = nepVenster();
  let gemeten = 0;
  naLettertypen(() => { gemeten++; }, v.venster);
  assert.equal(v.gelezen(), 0, 'fonts.ready gelezen in de opstarttaak');
  v.frame();
  assert.equal(v.gelezen(), 1);
  await rust();
  assert.equal(gemeten, 0, 'gemeten voor de lettertypen klaar waren');
  v.klaar();
  await rust();
  assert.equal(gemeten, 1);
}

// Annuleren voor het frame: fonts.ready wordt nooit gelezen, er wordt niet gemeten.
{
  const v = nepVenster();
  let gemeten = 0;
  const stop = naLettertypen(() => { gemeten++; }, v.venster);
  stop();
  v.frame();
  v.klaar();
  await rust();
  assert.equal(v.gelezen(), 0);
  assert.equal(gemeten, 0);
}

// Annuleren na het frame maar voor de lettertypen klaar zijn: niet meer meten.
{
  const v = nepVenster();
  let gemeten = 0;
  const stop = naLettertypen(() => { gemeten++; }, v.venster);
  v.frame();
  stop();
  v.klaar();
  await rust();
  assert.equal(gemeten, 0);
}

// Zonder venster, rAF of document.fonts: niets, en geen fout.
{
  assert.equal(typeof naLettertypen(() => {}, null), 'function');
  assert.equal(typeof naLettertypen(() => {}, {}), 'function');
  const frames = [];
  naLettertypen(() => { throw new Error('mag niet'); }, { requestAnimationFrame: (f) => frames.push(f), document: {} });
  frames.forEach((f) => f());
}

console.log('na-lettertypen: alle tests geslaagd');
