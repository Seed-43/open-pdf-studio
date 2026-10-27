// De assistent via de werkplek (#704): de gastpagina stuurt de vraag met haar
// eigen sessie door naar de AI-dienst (`ai.vraag`, core/host-brug.js). De app
// krijgt nooit een sleutel of adres.
//
// De vraag is in OpenAI-chatvorm: { messages: [{ role, content }, …],
// max_tokens }. Het antwoord van de assistent (`bericht`, eventueel met
// `tool_calls` en `openaec_denkblokken`) gaat in de volgende beurt
// ONGEWIJZIGD mee; daarom bewaart het paneel het naast de getoonde tekst.
//
// Puur: geen DOM, geen i18n; het paneel (solid/components/AssistantPanel.jsx)
// vertaalt de sleutels.

import { AI_FOUTCODES } from './host-brug.js';

export const AI_MAX_TOKENS = 1024;

/**
 * De vraag voor `ai.vraag`.
 * @param {string} systeem de systeeminstructie
 * @param {Array<{ role: string, content?: string, bericht?: object }>} beurten
 *   de gesprekken tot nu toe; een beurt met `bericht` (een eerder antwoord van
 *   de werkplek) gaat precies zo mee
 */
export function maakAiVraag(systeem, beurten, maxTokens = AI_MAX_TOKENS) {
  const messages = [];
  if (systeem) messages.push({ role: 'system', content: String(systeem) });
  for (const b of beurten || []) {
    if (!b) continue;
    if (b.bericht && typeof b.bericht === 'object') messages.push(b.bericht);
    else if (b.role === 'user' || b.role === 'assistant') messages.push({ role: b.role, content: String(b.content ?? '') });
  }
  return { messages, max_tokens: maxTokens };
}

/** De tekst van een assistentbericht (content als tekst of als lijst delen). */
export function tekstUitBericht(bericht) {
  const inhoud = bericht?.content;
  if (typeof inhoud === 'string') return inhoud.trim();
  if (Array.isArray(inhoud)) {
    return inhoud
      .map((d) => (typeof d === 'string' ? d : (d && typeof d.text === 'string' ? d.text : '')))
      .join('')
      .trim();
  }
  return '';
}

/**
 * De vertaalsleutel voor een fout van de werkplek, of null als het geen fout
 * van de brug is (dan beslist het paneel zelf).
 */
export function aiFoutSleutel(fout) {
  if (!fout || fout.name !== 'BrugFout') return null;
  if (typeof fout.hostCode === 'string' && AI_FOUTCODES.includes(fout.hostCode)) {
    return `assistant.workplaceErrors.${fout.hostCode}`;
  }
  if (fout.code === 'time-out') return 'assistant.workplaceErrors.geen_antwoord';
  if (fout.code === 'geen-contact' || fout.code === 'geweigerd') return 'assistant.workplaceErrors.geen_contact';
  return null;
}
