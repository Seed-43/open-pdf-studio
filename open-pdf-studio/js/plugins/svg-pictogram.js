/**
 * Strikte SVG-parser voor pictogrammen van extensies (#551).
 *
 * Een extensie mag een pictogram als SVG-tekst meegeven. Deze module parseert
 * die met een eigen, kleine tokenizer en WEIGERT alles buiten een kleine
 * subset; er wordt niets "schoongemaakt". Daarna schrijft de host de SVG
 * opnieuw uit de geparseerde boom. Alleen die herschreven tekst komt in
 * `innerHTML` van een lintknop, nooit de ruwe tekst van de extensie.
 *
 * Zuivere module, zonder DOM, zodat ze onder node:test draait.
 */

import { ExtensionContributionError } from './extension-contributions.js';

const MAX_LENGTE = 8 * 1024;
const MAX_ELEMENTEN = 200;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Elementen die kinderen mogen hebben; de vormen zijn altijd bladeren.
const CONTAINERS = new Set(['svg', 'g']);

const GETAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const LENGTE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px|%)?$/;
const KLEUR = /^(?:none|currentColor|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/;
const PADDATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const PUNTEN = /^[0-9eE.,+\-\s]*$/;
const TRANSFORM = /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([0-9eE.,+\-\s]*\)\s*,?\s*)*$/;

const vierGetallen = (v) => {
  const delen = v.trim().split(/[\s,]+/);
  return delen.length === 4 && delen.every((d) => GETAL.test(d));
};
const streepjes = (v) => v === 'none'
  || (v.trim() !== '' && v.trim().split(/[\s,]+/).every((d) => LENGTE.test(d) && !d.startsWith('-')));
const uit = (...keuzes) => (v) => keuzes.includes(v);

// Attribuut -> controle van de waarde.
const CONTROLES = {
  d: (v) => PADDATA.test(v),
  cx: (v) => LENGTE.test(v), cy: (v) => LENGTE.test(v), r: (v) => LENGTE.test(v),
  rx: (v) => LENGTE.test(v), ry: (v) => LENGTE.test(v),
  x: (v) => LENGTE.test(v), y: (v) => LENGTE.test(v),
  x1: (v) => LENGTE.test(v), y1: (v) => LENGTE.test(v), x2: (v) => LENGTE.test(v), y2: (v) => LENGTE.test(v),
  points: (v) => PUNTEN.test(v),
  width: (v) => LENGTE.test(v), height: (v) => LENGTE.test(v),
  transform: (v) => TRANSFORM.test(v),
  fill: (v) => KLEUR.test(v),
  stroke: (v) => KLEUR.test(v),
  'stroke-width': (v) => LENGTE.test(v),
  'stroke-linecap': uit('butt', 'round', 'square'),
  'stroke-linejoin': uit('miter', 'round', 'bevel', 'arcs', 'miter-clip'),
  'stroke-miterlimit': (v) => GETAL.test(v),
  'stroke-dasharray': streepjes,
  'stroke-dashoffset': (v) => LENGTE.test(v),
  'fill-rule': uit('nonzero', 'evenodd'),
  'clip-rule': uit('nonzero', 'evenodd'),
  opacity: (v) => GETAL.test(v),
  'fill-opacity': (v) => GETAL.test(v),
  'stroke-opacity': (v) => GETAL.test(v),
  viewBox: vierGetallen,
  xmlns: (v) => v === SVG_NS,
};

// Welke attributen per element mogen. De opmaakattributen mogen overal.
const OPMAAK = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity'];
const PER_ELEMENT = {
  svg: ['viewBox', 'xmlns', 'width', 'height'],
  g: ['transform'],
  path: ['d', 'transform'],
  circle: ['cx', 'cy', 'r', 'transform'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'transform'],
  line: ['x1', 'y1', 'x2', 'y2', 'transform'],
  polyline: ['points', 'transform'],
  polygon: ['points', 'transform'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'transform'],
};
const TOEGESTAAN = Object.fromEntries(Object.entries(PER_ELEMENT)
  .map(([el, eigen]) => [el, new Set([...eigen, ...OPMAAK])]));

function weiger(reden) {
  throw new ExtensionContributionError('INVALID_CONTRIBUTION', `invalid SVG icon: ${reden}`);
}

const isWit = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
const NAAM = /^[A-Za-z_][A-Za-z0-9_:.-]*/;

/**
 * Parseer en herschrijf een SVG-pictogram. Gooit INVALID_CONTRIBUTION bij
 * alles buiten de subset; geeft anders de herschreven SVG-tekst.
 * @param {string} tekst
 * @returns {string}
 */
export function parseerSvgPictogram(tekst) {
  if (typeof tekst !== 'string' || !tekst.trim()) weiger('expected SVG text');
  if (tekst.length > MAX_LENGTE) weiger('larger than 8 KB');
  if (tekst.includes('&')) weiger('entities are not allowed');

  let i = 0;
  let aantal = 0;
  const wortels = [];
  const stapel = [];

  const huidigeKinderen = () => (stapel.length ? stapel[stapel.length - 1].kinderen : wortels);
  const slaWitOver = () => { while (i < tekst.length && isWit(tekst[i])) i++; };

  while (i < tekst.length) {
    const c = tekst[i];
    if (isWit(c)) { i++; continue; }
    if (c !== '<') weiger('text content is not allowed');
    if (tekst.startsWith('<!--', i)) weiger('comments are not allowed');
    if (tekst.startsWith('<![CDATA[', i)) weiger('CDATA is not allowed');
    if (tekst.startsWith('<!', i)) weiger('doctype is not allowed');
    if (tekst.startsWith('<?', i)) weiger('processing instructions are not allowed');

    if (tekst[i + 1] === '/') {
      // Sluittag
      i += 2;
      const m = NAAM.exec(tekst.slice(i));
      if (!m) weiger('malformed closing tag');
      i += m[0].length;
      slaWitOver();
      if (tekst[i] !== '>') weiger('malformed closing tag');
      i++;
      const open = stapel.pop();
      if (!open || open.naam !== m[0]) weiger(`unexpected </${m[0]}>`);
      continue;
    }

    // Openingstag
    i++;
    const m = NAAM.exec(tekst.slice(i));
    if (!m) weiger('malformed tag');
    const naam = m[0];
    i += naam.length;
    if (!Object.prototype.hasOwnProperty.call(PER_ELEMENT, naam)) weiger(`element <${naam}> is not allowed`);
    if (naam === 'svg' && (stapel.length || wortels.length)) weiger('only one root <svg> is allowed');
    if (naam !== 'svg' && !stapel.length) weiger('the root element must be <svg>');
    if (stapel.length && !CONTAINERS.has(stapel[stapel.length - 1].naam)) {
      weiger(`<${stapel[stapel.length - 1].naam}> cannot have child elements`);
    }
    aantal++;
    if (aantal > MAX_ELEMENTEN) weiger('more than 200 elements');

    const attributen = [];
    let zelfsluitend = false;
    for (;;) {
      const voor = i;
      slaWitOver();
      if (i >= tekst.length) weiger('unterminated tag');
      if (tekst.startsWith('/>', i)) { i += 2; zelfsluitend = true; break; }
      if (tekst[i] === '>') { i++; break; }
      if (i === voor) weiger('attributes must be separated by whitespace');
      const a = NAAM.exec(tekst.slice(i));
      if (!a) weiger('malformed attribute');
      const attr = a[0];
      i += attr.length;
      slaWitOver();
      if (tekst[i] !== '=') weiger(`attribute ${attr} needs a quoted value`);
      i++;
      slaWitOver();
      const quote = tekst[i];
      if (quote !== '"' && quote !== "'") weiger(`attribute ${attr} needs a quoted value`);
      const eind = tekst.indexOf(quote, i + 1);
      if (eind < 0) weiger('unterminated attribute value');
      const waarde = tekst.slice(i + 1, eind);
      i = eind + 1;
      if (waarde.includes('<')) weiger(`attribute ${attr} contains "<"`);
      if (!TOEGESTAAN[naam].has(attr)) weiger(`attribute ${attr} is not allowed on <${naam}>`);
      const controle = CONTROLES[attr];
      if (attributen.some(([n]) => n === attr)) weiger(`duplicate attribute ${attr}`);
      if (!controle(waarde)) weiger(`invalid value for ${attr}`);
      attributen.push([attr, waarde]);
    }

    const element = { naam, attributen, kinderen: [] };
    huidigeKinderen().push(element);
    if (naam === 'svg' && !attributen.some(([n]) => n === 'viewBox')) weiger('the root <svg> needs a viewBox');
    if (!zelfsluitend) stapel.push(element);
  }

  if (stapel.length) weiger(`<${stapel[stapel.length - 1].naam}> is not closed`);
  if (wortels.length !== 1) weiger('expected one root <svg>');
  return schrijf(wortels[0]);
}

function schrijf(el) {
  const attr = el.attributen.map(([n, v]) => ` ${n}="${v}"`).join('');
  if (!el.kinderen.length) return `<${el.naam}${attr}/>`;
  return `<${el.naam}${attr}>${el.kinderen.map(schrijf).join('')}</${el.naam}>`;
}

/**
 * Controleer het `icon`-veld van een bijdrage: `{ builtin: '<exportnaam>' }`
 * uit ribbonIcons.js, of SVG-tekst. Geeft de te tonen SVG-tekst, of null
 * zonder pictogram.
 * @param {unknown} icon
 * @param {Record<string, string>} ingebouwd  de exports van ribbonIcons.js
 */
export function valideerPictogram(icon, ingebouwd) {
  if (icon === undefined || icon === null) return null;
  if (typeof icon === 'string') return parseerSvgPictogram(icon);
  if (typeof icon === 'object' && !Array.isArray(icon)) {
    const sleutels = Object.keys(icon);
    if (sleutels.length !== 1 || sleutels[0] !== 'builtin') weiger('icon object must be { builtin }');
    const naam = icon.builtin;
    if (typeof naam !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(naam)
        || !Object.prototype.hasOwnProperty.call(ingebouwd || {}, naam)
        || typeof ingebouwd[naam] !== 'string') {
      throw new ExtensionContributionError('INVALID_CONTRIBUTION', `unknown builtin icon: ${String(naam)}`);
    }
    return ingebouwd[naam];
  }
  weiger('icon must be SVG text or { builtin }');
}
