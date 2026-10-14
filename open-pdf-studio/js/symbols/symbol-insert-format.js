// Opmaak tijdens het invoegen van symbolen (issue #587) — pure module, geen
// app-imports, zodat alles node-testbaar is.
//
// Zodra de gebruiker een symbool in het symbolenpalet kiest, staat de
// invoegmodus aan. De opmaakwerkbalk stelt dan de opmaak in voor de symbolen
// die nog GEPLAATST worden: lijnkleur, lijndikte, dekking en mengmodus. Die
// keuze blijft de hele invoegsessie staan, ook bij het kiezen van een ander
// symbool. Wie de invoegmodus verlaat, begint de volgende keer weer bij de
// standaard.
//
// Standaard is overal `null`: "zoals het symbool ontworpen is". Een symbool
// krijgt alleen de opties mee die de gebruiker koos EN die het ondersteunt;
// een niet-ondersteunde optie blijft gewoon in de voorkeuren staan voor het
// volgende symbool.

import { recolorSvg, svgDominantColor } from '../annotations/svg-stroke-color.js';
import {
  restrokeSvg, svgBaseStrokeWidth, svgViewBoxWidth,
  strokeUnitsForLineWidth, lineWidthForStroke,
} from '../annotations/svg-stroke-width.js';

/** De opties die de werkbalk tijdens het invoegen instelt. */
export const INSERT_FORMAT_KEYS = Object.freeze(['strokeColor', 'lineWidth', 'opacity', 'blendMode']);

const BLEND_MODES = new Set(['normal', 'multiply']);
const MAX_LINE_WIDTH = 50;
const TERUGVAL = Object.freeze({ strokeColor: '#000000', lineWidth: 1, opacity: 1, blendMode: 'normal' });

/** Nieuwe standaardopmaak: niets gekozen, het symbool blijft zoals het is. */
export function defaultInsertFormat() {
  return { strokeColor: null, lineWidth: null, opacity: null, blendMode: null };
}

function normaliseer(key, waarde) {
  if (waarde === null) return { ok: true, waarde: null };
  switch (key) {
    case 'strokeColor': {
      if (typeof waarde !== 'string') return { ok: false };
      const v = waarde.trim().toLowerCase();
      return v ? { ok: true, waarde: v } : { ok: false };
    }
    case 'lineWidth': {
      const v = Number(waarde);
      return Number.isFinite(v) && v > 0 && v <= MAX_LINE_WIDTH ? { ok: true, waarde: v } : { ok: false };
    }
    case 'opacity': {
      if (waarde === '' || typeof waarde === 'boolean') return { ok: false };
      const v = Number(waarde);
      return Number.isFinite(v) && v >= 0 && v <= 1 ? { ok: true, waarde: v } : { ok: false };
    }
    case 'blendMode':
      return BLEND_MODES.has(waarde) ? { ok: true, waarde } : { ok: false };
    default:
      return { ok: false };
  }
}

/**
 * Voeg een wijziging samen met de huidige opmaak. Onbekende opties en
 * onbruikbare waarden worden genegeerd (de bestaande keuze blijft staan);
 * `null` zet één optie terug op de eigen opmaak van het symbool.
 * Muteert de invoer niet.
 */
export function mergeInsertFormat(prefs, patch) {
  const uit = defaultInsertFormat();
  if (prefs && typeof prefs === 'object') {
    for (const k of INSERT_FORMAT_KEYS) {
      const n = normaliseer(k, prefs[k] === undefined ? null : prefs[k]);
      if (n.ok) uit[k] = n.waarde;
    }
  }
  if (patch && typeof patch === 'object') {
    for (const k of INSERT_FORMAT_KEYS) {
      if (!(k in patch)) continue;
      const n = normaliseer(k, patch[k]);
      if (n.ok) uit[k] = n.waarde;
    }
  }
  return uit;
}

/**
 * Welk soort symbool wordt er met dit gereedschap ingevoegd, of null als het
 * geen symboolinvoeging is.
 *  - 'svg': een SVG-symbool uit het palet (stempel met `symbolInsert`).
 *  - 'parametric': een parametrisch symbool (palet of symboolkiezer).
 *  - 'wall': een wand uit het palet.
 * Stempels van extensies of uit de stempelkiezer dragen de markering niet en
 * vallen er dus buiten.
 */
export function symbolInsertKind(tool, overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : null;
  if (tool === 'stamp') return ov?.symbolInsert === true && typeof ov.stampSvg === 'string' && ov.stampSvg ? 'svg' : null;
  if (tool === 'parametricSymbol') return 'parametric';
  if (tool === 'wall') return ov?.symbolInsert === true ? 'wall' : null;
  return null;
}

/**
 * Volgende toestand van de invoegsessie na het (her)activeren van een
 * gereedschap. `kind` is de uitkomst van symbolInsertKind().
 *  - geen symboolinvoeging meer: sessie uit, voorkeuren terug naar standaard;
 *  - eerste symbool: sessie aan met de standaard;
 *  - al actief (zelfde of ander symbool): voorkeuren blijven staan.
 */
export function nextInsertSession(session, kind) {
  if (!kind) return { active: false, prefs: defaultInsertFormat() };
  if (!session || !session.active) return { active: true, prefs: defaultInsertFormat() };
  return { active: true, prefs: mergeInsertFormat(session.prefs, null) };
}

function heeftLijndikte(svg) {
  return typeof svg === 'string' && /\bstroke-width\s*=/i.test(svg);
}

function isHerkleurbaar(svg) {
  if (typeof svg !== 'string' || !svg) return false;
  // Een symbool dat alleen uit een ingesloten afbeelding bestaat, heeft geen
  // kleur die we kunnen herschrijven.
  if (/<image\b/i.test(svg) && svgDominantColor(svg) == null) return false;
  return true;
}

/** De opties die dit symbool daadwerkelijk kan gebruiken. */
export function supportedInsertOptions(kind, svg) {
  switch (kind) {
    case 'svg': {
      const opties = [];
      if (isHerkleurbaar(svg)) opties.push('strokeColor');
      // Zelfde regel als het eigenschappenpaneel (stampLineWidthOf): alleen
      // een bron die zelf een dikte noemt, heeft een zinnige lijndikte.
      if (heeftLijndikte(svg)) opties.push('lineWidth');
      opties.push('opacity', 'blendMode');
      return opties;
    }
    case 'parametric':
      return ['strokeColor', 'lineWidth', 'opacity', 'blendMode'];
    case 'wall':
      // De wand rekent zijn lijndikte uit zijn dikte (rendering/walls.js).
      return ['strokeColor', 'opacity', 'blendMode'];
    default:
      return [];
  }
}

/**
 * Annotatie-eigenschappen voor een nieuw symbool: alleen wat gekozen is en
 * wat het symbool ondersteunt. Lijnkleur gaat naar `color` én `strokeColor`,
 * net als bij de opmaakwerkbalk voor een geselecteerd symbool.
 */
export function insertFormatProps(prefs, kind, svg) {
  const p = mergeInsertFormat(prefs, null);
  const opties = new Set(supportedInsertOptions(kind, svg));
  const uit = {};
  if (opties.has('strokeColor') && p.strokeColor != null) {
    uit.color = p.strokeColor;
    uit.strokeColor = p.strokeColor;
  }
  if (opties.has('lineWidth') && p.lineWidth != null) uit.lineWidth = p.lineWidth;
  if (opties.has('opacity') && p.opacity != null) uit.opacity = p.opacity;
  if (opties.has('blendMode') && p.blendMode != null) uit.blendMode = p.blendMode;
  return uit;
}

/**
 * De SVG-bron van een SVG-symbool met de gekozen kleur en lijndikte erin.
 * Een symbool wordt als raster getekend; kleur en dikte moeten dus IN de bron
 * staan (zie stamp-line-width.js). Volgorde dikte → kleur, gelijk aan de
 * opmaakwerkbalk. Zonder plaatsingsbreedte valt de dikte niet om te rekenen
 * en blijft die achterwege.
 */
export function formatSymbolSvg(svg, prefs, placedWidth) {
  if (typeof svg !== 'string' || !svg) return svg;
  const props = insertFormatProps(prefs, 'svg', svg);
  let uit = svg;
  if (props.lineWidth != null) {
    const units = strokeUnitsForLineWidth({
      lineWidth: props.lineWidth,
      viewBoxWidth: svgViewBoxWidth(uit),
      placedWidth,
    });
    if (units != null) uit = restrokeSvg(uit, units);
  }
  if (props.color != null) uit = recolorSvg(uit, props.color);
  return uit;
}

/**
 * De eigen opmaak van een symbool, om in de werkbalk te tonen zolang de
 * gebruiker niets koos. `lineWidth` is null als er niets zinnigs te melden is.
 */
export function naturalSymbolFormat(kind, svg, placedWidth) {
  if (kind === 'svg') {
    return {
      strokeColor: svgDominantColor(svg),
      lineWidth: heeftLijndikte(svg)
        ? lineWidthForStroke({
          strokeUnits: svgBaseStrokeWidth(svg),
          viewBoxWidth: svgViewBoxWidth(svg),
          placedWidth,
        })
        : null,
    };
  }
  if (kind === 'parametric' || kind === 'wall') return { strokeColor: '#000000', lineWidth: null };
  return { strokeColor: null, lineWidth: null };
}

/**
 * Wat de werkbalk toont: de keuze, anders de eigen opmaak van het symbool,
 * anders de vaste terugval. Dekking in procenten, zoals de schuif.
 */
export function insertFormatDisplay(prefs, natural) {
  const p = mergeInsertFormat(prefs, null);
  const n = natural || {};
  const dekking = p.opacity ?? TERUGVAL.opacity;
  return {
    strokeColor: p.strokeColor ?? n.strokeColor ?? TERUGVAL.strokeColor,
    lineWidth: p.lineWidth ?? n.lineWidth ?? TERUGVAL.lineWidth,
    opacity: Math.round(dekking * 100),
    blendMode: p.blendMode ?? TERUGVAL.blendMode,
  };
}

const ROOT_TAG = /<svg\b[^>]*>/i;
const VIEWBOX = /\bviewBox\s*=\s*"\s*[+-]?[\d.]+[\s,]+[+-]?[\d.]+[\s,]+([+-]?[\d.]+)[\s,]+([+-]?[\d.]+)\s*"/i;

/** Breedte/hoogte uit de viewBox van de bron; 1 als die ontbreekt. */
export function svgViewBoxAspect(svg) {
  if (typeof svg !== 'string') return 1;
  const root = ROOT_TAG.exec(svg);
  const m = VIEWBOX.exec(root ? root[0] : svg);
  if (!m) return 1;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? w / h : 1;
}
