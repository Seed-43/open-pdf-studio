// Toestand van de opmaak tijdens het invoegen van symbolen (issue #587).
//
// De rekenkant (standaard, samenvoegen, welke optie bij welk symbool hoort,
// terugzetten bij het verlaten) staat in symbol-insert-format.js; deze module
// houdt alleen de sessie bij, met een reactief signaal voor de werkbalk.
//
// De sessie volgt het gereedschap: setTool() roept syncSymbolInsertSession()
// aan, en updateContextualTabs() controleert bij elke herteken-ronde of het
// gereedschap nog een symboolinvoeging is (voor paden die het gereedschap
// wisselen zonder setTool).

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';
import {
  defaultInsertFormat, mergeInsertFormat, symbolInsertKind, nextInsertSession,
  supportedInsertOptions, insertFormatProps, formatSymbolSvg,
  naturalSymbolFormat, insertFormatDisplay, svgViewBoxAspect,
} from './symbol-insert-format.js';
import { rasterizeSvg } from '../annotations/svg-raster.js';
import { overrideStampMaat } from '../annotations/svg-real-size.js';
import { huidigeSymboolSchaal } from './symbol-scale-store.js';

const [sessie, setSessie] = createSignal({ active: false, prefs: defaultInsertFormat() });
// Het symbool dat nu ingevoegd wordt: { kind, svg } of null.
const [huidig, setHuidig] = createSignal(null);

/** Reactief: staat de invoegmodus voor symbolen aan? */
export function symbolInsertActive() {
  return sessie().active;
}

/** Reactief: de gekozen opmaak van deze sessie (null = eigen opmaak). */
export function symbolInsertFormat() {
  return sessie().prefs;
}

/** Reactief: ondersteunt het huidige symbool deze optie? */
export function symbolInsertSupports(key) {
  const h = huidig();
  return !!h && supportedInsertOptions(h.kind, h.svg).includes(key);
}

function huidigUitState() {
  const kind = symbolInsertKind(state.currentTool, state.toolOverrides);
  if (!kind) return null;
  return { kind, svg: kind === 'svg' ? state.toolOverrides.stampSvg : null };
}

// Plaatsingsbreedte van het voorbeeld: dezelfde maatbepaling als de
// spookafbeelding en de plaatsing (svg-real-size.js), zonder tekeningschaal
// op een cursorpunt. Voor symbolen zonder werkelijke maat (de meegeleverde)
// is dat precies de maat waarop ze geplaatst worden.
function voorbeeldBreedte(ov) {
  if (!ov?.stampSvg) return undefined;
  const maat = overrideStampMaat(ov, {
    pxPerMm: 0,
    aspect: svgViewBoxAspect(ov.stampSvg),
    schaal: huidigeSymboolSchaal(),
  });
  return maat.width > 0 ? maat.width : undefined;
}

function vernieuwLint() {
  import('../annotations/rendering/ui-state.js')
    .then((m) => m.updateContextualTabs())
    .catch(() => { /* lint nog niet geladen */ });
}

let voorbeeldVolgnummer = 0;

/**
 * Bouw de spookafbeelding van het gekozen SVG-symbool opnieuw, met de
 * gekozen opmaak erin. Een ouder, trager raster mag een nieuwer niet
 * overschrijven, en hoort niet bij een inmiddels ander symbool.
 */
export function rebuildSymbolPreview() {
  const ov = state.toolOverrides;
  if (symbolInsertKind(state.currentTool, ov) !== 'svg') return;
  const nr = ++voorbeeldVolgnummer;
  const svg = formatSymbolSvg(ov.stampSvg, sessie().prefs, voorbeeldBreedte(ov));
  rasterizeSvg(svg).then((r) => {
    if (!r || nr !== voorbeeldVolgnummer || state.toolOverrides !== ov) return;
    ov._previewImg = r.img;
  }).catch(() => { /* geen voorbeeld; plaatsen werkt gewoon */ });
}

/**
 * Na elke gereedschapswissel: begin, behoud of beëindig de invoegsessie.
 * Hetzelfde of een ander symbool kiezen houdt de opmaak vast; elk ander
 * gereedschap zet haar terug op de standaard.
 */
export function syncSymbolInsertSession(tool = state.currentTool, overrides = state.toolOverrides) {
  const kind = symbolInsertKind(tool, overrides);
  const vorige = sessie();
  setSessie(nextInsertSession(vorige, kind));
  setHuidig(kind ? { kind, svg: kind === 'svg' ? overrides.stampSvg : null } : null);
  if (kind === 'svg') rebuildSymbolPreview();
  if (vorige.active || kind) vernieuwLint();
}

/**
 * Niet-reactieve controle voor de herteken-ronde: is er nog een
 * symboolinvoeging bezig? Is het gereedschap intussen buiten setTool om
 * gewisseld, dan wordt de sessie hier alsnog beëindigd.
 */
export function checkSymbolInsertActive() {
  const s = sessie();
  if (!s.active) return false;
  const h = huidigUitState();
  if (!h) {
    setSessie(nextInsertSession(s, null));
    setHuidig(null);
    return false;
  }
  const oud = huidig();
  if (!oud || oud.kind !== h.kind || oud.svg !== h.svg) setHuidig(h);
  return true;
}

/**
 * Wijzig de opmaak voor de VOLGENDE plaatsingen. Raakt niets wat al
 * geplaatst is. Werkt alleen zolang de invoegmodus aan staat.
 */
export function setSymbolInsertFormat(patch) {
  const s = sessie();
  if (!s.active) return;
  setSessie({ active: true, prefs: mergeInsertFormat(s.prefs, patch) });
  rebuildSymbolPreview();
}

/** Wat de werkbalk toont voor het huidige symbool. */
export function symbolInsertDisplay() {
  const h = huidig();
  const breedte = h?.kind === 'svg' ? voorbeeldBreedte(state.toolOverrides) : undefined;
  return insertFormatDisplay(sessie().prefs, h ? naturalSymbolFormat(h.kind, h.svg, breedte) : null);
}

/**
 * Pas de opmaak toe op de eigenschappen van een nieuw parametrisch symbool
 * of een nieuwe wand (voorbeeld én plaatsing). Andere gereedschappen en een
 * gereedschap buiten de invoegmodus blijven ongemoeid.
 */
export function withSymbolInsertFormat(tool, props) {
  if (!props || !sessie().active) return props;
  const kind = symbolInsertKind(tool, state.toolOverrides);
  if (kind !== 'parametric' && kind !== 'wall') return props;
  const extra = insertFormatProps(sessie().prefs, kind, null);
  return Object.keys(extra).length ? { ...props, ...extra } : props;
}

/**
 * Opmaak voor een SVG-symbool dat nu geplaatst wordt: de opgemaakte bron en
 * de bijbehorende annotatie-eigenschappen. null buiten de invoegmodus of als
 * er niets gekozen is.
 */
export function symbolInsertStampFormat(overrides, placedWidth) {
  if (!sessie().active || !overrides?.symbolInsert || !overrides.stampSvg) return null;
  const props = insertFormatProps(sessie().prefs, 'svg', overrides.stampSvg);
  if (!Object.keys(props).length) return null;
  return { svg: formatSymbolSvg(overrides.stampSvg, sessie().prefs, placedWidth), props };
}

/** Dekking en mengmodus voor de spookafbeelding van een SVG-symbool. */
export function symbolInsertPreviewStyle() {
  const ov = state.toolOverrides;
  if (!sessie().active || !ov?.symbolInsert || !ov.stampSvg) return { opacity: 1, blendMode: 'normal' };
  const props = insertFormatProps(sessie().prefs, 'svg', ov.stampSvg);
  return { opacity: props.opacity ?? 1, blendMode: props.blendMode ?? 'normal' };
}
