// Profieltype van een geplaatst staalprofiel wisselen (#697).
//
// Elk profieltype is een eigen parametrisch sjabloon (staal-hea, staal-unp,
// staal-koker, staal-hoeklijn, en de families van een gedownloade
// staalcatalogus). Sjablonen met dezelfde `profielGroep` zijn onderling
// uitwisselbaar: een UNP 200 wordt een HEB 200 zonder het symbool opnieuw te
// plaatsen. Het wisselen verandert alleen `symbolId` en `params`; positie,
// rotatie, spiegeling, laag en stijl blijven staan. De maat in de nieuwe
// familie is die met de profielhoogte die het dichtst bij de oude ligt.

import { getTemplate, listTemplates, defaultParams, migrateParams } from './registry.js';
import { applyTemplateRealSize } from './real-size.js';

/** De profielgroep van een sjabloon(-id), of null. */
export function profielGroepVan(sjabloonOfId) {
  const tpl = typeof sjabloonOfId === 'string' ? getTemplate(sjabloonOfId) : sjabloonOfId;
  return (tpl && typeof tpl.profielGroep === 'string' && tpl.profielGroep) || null;
}

/** Heeft deze annotatie een profieltype dat kan wisselen? */
export function isWisselbaarProfiel(ann) {
  return !!ann && ann.type === 'parametricSymbol' && profielGroepVan(ann.symbolId) !== null;
}

/**
 * De profieltypen waar dit sjabloon naartoe kan, inclusief zichzelf, in de
 * volgorde van het register: [{ id, name, nameEn }]. Leeg zonder groep.
 */
export function profielTypen(symbolId, sjablonen = listTemplates()) {
  const groep = profielGroepVan(symbolId);
  if (!groep) return [];
  return sjablonen
    .filter((t) => t && t.profielGroep === groep)
    .map((t) => ({ id: t.id, name: t.name, nameEn: t.nameEn || t.name }));
}

/** De maten (keuzelijst `maat`) van een sjabloon. */
function maten(tpl) {
  const def = (tpl?.params || []).find((p) => p.key === 'maat');
  return (def?.options || []).map((o) => (typeof o === 'string' ? o : o?.value)).filter(Boolean);
}

function standaardMaat(tpl) {
  return (tpl?.params || []).find((p) => p.key === 'maat')?.default ?? maten(tpl)[0] ?? null;
}

/** Profielhoogte h in mm van een maat (de doorsnede, schaal 1), of null. */
export function profielHoogteMm(tpl, maat) {
  if (!tpl || typeof tpl.realSizeMm !== 'function' || !maat) return null;
  const mm = tpl.realSizeMm({ maat, aanzicht: 'doorsnede', schaal: 1 });
  return mm && Number.isFinite(mm.height) && mm.height > 0 ? mm.height : null;
}

/**
 * De maat van `tpl` waarvan de profielhoogte het dichtst bij `hoogteMm` ligt;
 * bij gelijke afstand de eerste uit de tabel (de kleinere). Zonder bruikbare
 * hoogte de standaardmaat van de familie.
 */
export function dichtsteMaat(tpl, hoogteMm) {
  if (!Number.isFinite(hoogteMm) || hoogteMm <= 0) return standaardMaat(tpl);
  let beste = null;
  let afstand = Infinity;
  for (const maat of maten(tpl)) {
    const h = profielHoogteMm(tpl, maat);
    if (h === null) continue;
    const d = Math.abs(h - hoogteMm);
    if (d < afstand) { beste = maat; afstand = d; }
  }
  return beste ?? standaardMaat(tpl);
}

/**
 * Wissel het profieltype van een geplaatst profiel. Muteert `ann`: nieuw
 * symbolId, de maat die qua hoogte het dichtst bij de oude ligt, de overige
 * parameters (aanzicht, schaal, hartlijnen, label) blijven, en het kader op
 * ware grootte rond hetzelfde midden. Geeft terug of er iets veranderde.
 */
export function wisselProfielType(ann, nieuwId) {
  if (!isWisselbaarProfiel(ann) || !nieuwId || nieuwId === ann.symbolId) return false;
  const oud = getTemplate(ann.symbolId);
  const nieuw = getTemplate(nieuwId);
  if (!nieuw || profielGroepVan(nieuw) !== profielGroepVan(oud)) return false;

  const oudeParams = migrateParams(oud, ann.params || {}) || {};
  const hoogte = profielHoogteMm(oud, oudeParams.maat);
  const params = defaultParams(nieuw);
  for (const def of nieuw.params || []) {
    if (def.key !== 'maat' && def.key in oudeParams) params[def.key] = oudeParams[def.key];
  }
  params.maat = dichtsteMaat(nieuw, hoogte);

  ann.symbolId = nieuwId;
  ann.params = params;
  applyTemplateRealSize(ann, 'center');
  return true;
}
