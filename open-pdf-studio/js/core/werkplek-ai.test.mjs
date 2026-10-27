// De assistent via de werkplek (#704): de vraag in OpenAI-chatvorm, het
// antwoord van de werkplek ongewijzigd in de volgende beurt, en elke foutcode
// een vertaalde melding in alle 40 talen.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maakAiVraag, tekstUitBericht, aiFoutSleutel, AI_MAX_TOKENS } from './werkplek-ai.js';
import { BrugFout, AI_FOUTCODES } from './host-brug.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.join(hier, '..', 'i18n', 'locales');
const TALEN = fs.readdirSync(LOCALES);
const common = (taal) => JSON.parse(fs.readFileSync(path.join(LOCALES, taal, 'common.json'), 'utf8'));
const opPad = (obj, pad) => pad.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

test('de vraag: systeem eerst, dan de beurten; een eerder antwoord van de werkplek precies zo', () => {
  const eerder = { role: 'assistant', content: 'Twee pagina\'s.', tool_calls: [], openaec_denkblokken: [{ signature: 's' }] };
  const vraag = maakAiVraag('Antwoord in het Nederlands.', [
    { role: 'user', content: 'Hoeveel pagina\'s?' },
    { bericht: eerder },
    { role: 'user', content: 7 },
    { role: 'system', content: 'mag niet tussendoor' },
    null,
  ]);
  assert.deepEqual(vraag, {
    messages: [
      { role: 'system', content: 'Antwoord in het Nederlands.' },
      { role: 'user', content: 'Hoeveel pagina\'s?' },
      eerder,
      { role: 'user', content: '7' },
    ],
    max_tokens: AI_MAX_TOKENS,
  });
  assert.equal(vraag.messages[2], eerder, 'hetzelfde object, ongewijzigd');
  assert.deepEqual(maakAiVraag('', [], 10), { messages: [], max_tokens: 10 });
});

test('de tekst van een antwoord: tekst of een lijst delen', () => {
  assert.equal(tekstUitBericht({ role: 'assistant', content: '  Hallo  ' }), 'Hallo');
  assert.equal(tekstUitBericht({ content: [{ type: 'text', text: 'Hal' }, 'lo', { type: 'image' }] }), 'Hallo');
  assert.equal(tekstUitBericht({ content: null, tool_calls: [{}] }), '');
  assert.equal(tekstUitBericht(undefined), '');
});

test('foutcodes van de werkplek worden een sleutel; andere fouten laat hij aan het paneel', () => {
  for (const code of AI_FOUTCODES) {
    assert.equal(aiFoutSleutel(new BrugFout('host', 'x', code)), `assistant.workplaceErrors.${code}`);
  }
  assert.equal(aiFoutSleutel(new BrugFout('time-out', 'x')), 'assistant.workplaceErrors.geen_antwoord');
  assert.equal(aiFoutSleutel(new BrugFout('geen-contact', 'x')), 'assistant.workplaceErrors.geen_contact');
  assert.equal(aiFoutSleutel(new BrugFout('host', 'x', 'iets_nieuws')), null, 'onbekende code: de gewone melding met detail');
  assert.equal(aiFoutSleutel(new Error('Claude API 401')), null, 'het bureaublad blijft zoals het was');
  assert.equal(aiFoutSleutel(null), null);
});

// De nieuwe teksten (#704), in alle talen echt vertaald.
const SLEUTELS = [
  'hostSaveConflict', 'hostSaveNotLocked', 'hostReadOnlySave', 'assistant.viaWorkplace',
  ...AI_FOUTCODES.map((c) => `assistant.workplaceErrors.${c}`),
  'assistant.workplaceErrors.geen_antwoord', 'assistant.workplaceErrors.geen_contact',
];

test('alle 40 talen hebben de teksten van de werkplek, niet leeg en niet het Engels', () => {
  assert.equal(TALEN.length, 40);
  const en = common('en');
  const fouten = [];
  for (const taal of TALEN) {
    const c = common(taal);
    for (const sleutel of SLEUTELS) {
      const tekst = opPad(c, sleutel);
      if (typeof tekst !== 'string' || !tekst.trim()) fouten.push(`${taal} ${sleutel}: ontbreekt`);
      else if (taal !== 'en' && tekst === opPad(en, sleutel)) fouten.push(`${taal} ${sleutel}: Engels`);
    }
    if (!String(c.hostSaveConflict || '').includes('{{name}}')) fouten.push(`${taal} hostSaveConflict mist {{name}}`);
  }
  assert.deepEqual(fouten, []);
  const werkplek = Object.keys(en.assistant.workplaceErrors).sort();
  assert.deepEqual(werkplek, [...AI_FOUTCODES, 'geen_antwoord', 'geen_contact'].sort(), 'precies de codes, geen losse');
});
