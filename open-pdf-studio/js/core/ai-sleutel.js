// De persoonlijke sleutel voor de AI-dienst van de assistent (#548).
//
// Op het bureaublad en in de losse webversie heeft de app een eigen
// oorsprong; daar mag de sleutel in de browseropslag (met voorvoegsel, zie
// core/opslag.js). Als gast in de OpenAEC-site deelt de app de oorsprong met
// elk ander gereedschap, en wat daar in localStorage staat kan elk script van
// de site lezen. Daar komt de sleutel dus nooit in de opslag — de AI-dienst
// staat er toch al uit (core/webfuncties.js) — en een achtergebleven sleutel
// onder onze naam wordt opgeruimd.

import { isGehost } from './gehost.js';
import { leesOpslag, schrijfOpslag, verwijderOpslag } from './opslag.js';

const SLEUTEL_NAAM = 'opds-anthropic-key';

/** Als gast: een achtergebleven sleutel onder onze naam weghalen. */
export function ruimAiSleutelOpAlsGast(gehost = isGehost()) {
  if (gehost) verwijderOpslag(SLEUTEL_NAAM);
}

/** De bewaarde sleutel, of '' (als gast altijd ''). */
export function leesAiSleutel(gehost = isGehost()) {
  if (gehost) {
    ruimAiSleutelOpAlsGast(gehost);
    return '';
  }
  return leesOpslag(SLEUTEL_NAAM) || '';
}

/**
 * Bewaar de sleutel (leeg = vergeten).
 * @returns {boolean} false als hij hier niet bewaard mag worden
 */
export function bewaarAiSleutel(sleutel, gehost = isGehost()) {
  if (gehost) return false;
  const waarde = String(sleutel || '').trim();
  if (waarde) schrijfOpslag(SLEUTEL_NAAM, waarde);
  else verwijderOpslag(SLEUTEL_NAAM);
  return true;
}
