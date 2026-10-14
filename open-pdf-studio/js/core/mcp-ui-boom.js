// De boom van app_read_ui (#584): een compacte, toegankelijkheidsachtige
// weergave van het lint, de zijpanelen en de statusbalk, zodat een MCP-agent
// kan nalezen wat een klik deed (labels, uitgeschakeld, aangevinkt, gekozen,
// uitgeklapt, waarde, statustekst).
//
// Zuivere module: hij leest alleen eigenschappen die elk DOM-element heeft
// (tagName, getAttribute, children, childNodes, disabled, checked, value, ...).
// Zichtbaarheid, het opzoeken van een id en het element met focus worden
// ingespoten, zodat de regels zonder browser te toetsen zijn.
//
// Vorm van een knoop (alleen velden met een waarde):
//   { role, name, id, description, value, valueText, level, tab, command,
//     state: { disabled, checked, pressed, selected, expanded, active, focused,
//              readonly, hidden },
//     children: [...], truncated }
// Elementen zonder eigen rol (div, span) verschijnen niet zelf: hun kinderen
// schuiven een niveau op en hun losse tekst wordt een knoop met rol 'text'.

import { tabNaam } from './mcp-lint-opdrachten.js';

export const UI_GRENZEN = Object.freeze({
  maxDepth: Object.freeze({ standaard: 12, min: 1, max: 40 }),
  maxNodes: Object.freeze({ standaard: 400, min: 1, max: 3000 }),
  maxText: Object.freeze({ standaard: 80, min: 8, max: 1000 }),
});

function geheel(waarde, { standaard, min, max }) {
  const n = Number(waarde);
  if (waarde === undefined || waarde === null || waarde === '' || !Number.isFinite(n)) return standaard;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Lees de argumenten van app_read_ui. Grenzen buiten het bereik worden
 * afgekapt; alleen een ongeldige selector of includeHidden is een fout.
 * @returns {{ selector: string|null, maxDepth: number, maxNodes: number, maxText: number,
 *   includeHidden: boolean } | { error: string }}
 */
export function leesUiArgumenten(params) {
  const p = params && typeof params === 'object' ? params : {};
  let selector = null;
  if (p.selector !== undefined && p.selector !== null) {
    if (typeof p.selector !== 'string' || !p.selector.trim()) return { error: 'selector must be a non-empty CSS selector' };
    selector = p.selector.trim();
  }
  if (p.includeHidden !== undefined && typeof p.includeHidden !== 'boolean') {
    return { error: 'includeHidden must be a boolean' };
  }
  return {
    selector,
    maxDepth: geheel(p.maxDepth, UI_GRENZEN.maxDepth),
    maxNodes: geheel(p.maxNodes, UI_GRENZEN.maxNodes),
    maxText: geheel(p.maxText, UI_GRENZEN.maxText),
    includeHidden: p.includeHidden === true,
  };
}

// Nooit in de boom: geen inhoud voor een lezer, of alleen een pictogram.
const OVERSLAAN = new Set(['script', 'style', 'template', 'noscript', 'svg', 'canvas', 'iframe', 'link', 'meta', 'br', 'wbr']);
const FORMULIERVELD = new Set(['input', 'select', 'textarea']);

const INVOER_ROL = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
};

// Rollen die zelf geen kinderen tonen: hun inhoud is hun naam.
const BLAD_ROLLEN = new Set([
  'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'heading',
  'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'slider', 'spinbutton', 'progressbar',
  'meter', 'img', 'separator', 'treeitem',
]);
// Rollen die hun naam uit de inhoud halen (als het geen formulierveld is).
const NAAM_UIT_INHOUD = new Set([...BLAD_ROLLEN, 'cell', 'columnheader', 'rowheader', 'tooltip']);

const tag = (el) => String(el?.tagName || '').toLowerCase();
const attr = (el, naam) => (typeof el?.getAttribute === 'function' ? el.getAttribute(naam) : null);
const heeftKlasse = (el, klasse) => {
  if (el?.classList && typeof el.classList.contains === 'function') return el.classList.contains(klasse);
  return ` ${String(el?.className || '')} `.includes(` ${klasse} `);
};
const eersteKlasse = (el) => String(attr(el, 'class') ?? el?.className ?? '').trim().split(/\s+/)[0] || '';
const kinderen = (el) => (el?.children ? Array.from(el.children) : []);
const knopen = (el) => (el?.childNodes ? Array.from(el.childNodes) : kinderen(el));
const isTekstKnoop = (n) => n?.nodeType === 3;
const isElement = (n) => n?.nodeType === 1;
const plat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Afkappen op `max` tekens, met een beletselteken. */
export function kort(tekst, max) {
  const t = plat(tekst);
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

/** De rol van een element: expliciet, impliciet of app-specifiek; null = geen eigen rol. */
export function rolVan(el) {
  const expliciet = plat(attr(el, 'role')).split(' ')[0];
  if (expliciet) return expliciet === 'presentation' || expliciet === 'none' ? null : expliciet;
  switch (tag(el)) {
    case 'button': case 'summary': return 'button';
    case 'a': return attr(el, 'href') !== null ? 'link' : null;
    case 'input': {
      const type = String(el.type || attr(el, 'type') || 'text').toLowerCase();
      if (type === 'hidden') return null;
      return INVOER_ROL[type] || 'textbox';
    }
    case 'select': return el.multiple || Number(el.size) > 1 ? 'listbox' : 'combobox';
    case 'textarea': return 'textbox';
    case 'option': return 'option';
    case 'optgroup': case 'fieldset': case 'details': return 'group';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'aside': return 'complementary';
    case 'form': return 'form';
    case 'dialog': return 'dialog';
    case 'img': return attr(el, 'alt') === '' ? null : 'img';
    case 'table': return 'table';
    case 'tr': return 'row';
    case 'td': return 'cell';
    case 'th': return 'columnheader';
    case 'progress': return 'progressbar';
    case 'meter': return 'meter';
    case 'output': return 'status';
    case 'hr': return 'separator';
    default: break;
  }
  // Een lintgroep: de groepsnaam staat eronder in .ribbon-group-label.
  if (heeftKlasse(el, 'ribbon-group')) return 'group';
  return null;
}

const ariaWaar = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'mixed' ? 'mixed' : undefined);

/**
 * Bouw de boom voor een of meer gebieden.
 * @param {Array<{ region: string, elements: any[] }>} gebieden
 * @param {{ maxDepth?: number, maxNodes?: number, maxText?: number, includeHidden?: boolean,
 *   isZichtbaar?: (el: any) => boolean, zoekOpId?: (id: string) => any, actiefElement?: any }} [invoer]
 * @returns {{ regions: Array<{ region: string, nodes: any[] }>, nodeCount: number, truncated: boolean }}
 */
export function bouwUiBoom(gebieden, invoer = {}) {
  const maxDepth = geheel(invoer.maxDepth, UI_GRENZEN.maxDepth);
  const maxNodes = geheel(invoer.maxNodes, UI_GRENZEN.maxNodes);
  const maxText = geheel(invoer.maxText, UI_GRENZEN.maxText);
  const includeHidden = invoer.includeHidden === true;
  const isZichtbaar = typeof invoer.isZichtbaar === 'function' ? invoer.isZichtbaar : () => true;
  const zoekOpId = typeof invoer.zoekOpId === 'function' ? invoer.zoekOpId : () => null;
  const actiefElement = invoer.actiefElement ?? null;
  const kap = (t) => kort(t, maxText);

  let aantal = 0;
  let afgekapt = false;
  const vol = () => {
    if (aantal < maxNodes) return false;
    afgekapt = true;
    return true;
  };

  const verborgen = (el) => attr(el, 'aria-hidden') === 'true'
    || el.hidden === true || (el.hidden === undefined && attr(el, 'hidden') !== null);

  // Leesbare tekst van een element, zonder pictogrammen en verborgen delen.
  const tekstVan = (el) => {
    if (!el?.childNodes) return plat(el?.textContent);
    const delen = [];
    for (const n of knopen(el)) {
      if (isTekstKnoop(n)) delen.push(n.data ?? n.textContent ?? '');
      else if (isElement(n) && !OVERSLAAN.has(tag(n)) && !verborgen(n)) delen.push(tekstVan(n));
    }
    return plat(delen.join(' '));
  };

  function naamVan(el, rol) {
    const label = plat(attr(el, 'aria-label'));
    if (label) return kap(label);
    const door = plat(attr(el, 'aria-labelledby'));
    if (door) {
      const t = plat(door.split(' ').map((id) => zoekOpId(id)).filter(Boolean).map(tekstVan).join(' '));
      if (t) return kap(t);
    }
    const t = tag(el);
    if (FORMULIERVELD.has(t)) {
      if (t === 'input' && rol === 'button' && plat(el.value ?? attr(el, 'value'))) return kap(el.value ?? attr(el, 'value'));
      const uitLabel = plat((el.labels ? Array.from(el.labels) : []).map(tekstVan).join(' '));
      if (uitLabel) return kap(uitLabel);
      if (plat(attr(el, 'placeholder'))) return kap(attr(el, 'placeholder'));
    } else {
      if (t === 'img' && plat(attr(el, 'alt'))) return kap(attr(el, 'alt'));
      if (heeftKlasse(el, 'ribbon-group')) {
        const kop = kinderen(el).find((k) => heeftKlasse(k, 'ribbon-group-label'));
        if (kop && tekstVan(kop)) return kap(tekstVan(kop));
      }
      if (NAAM_UIT_INHOUD.has(rol) && tekstVan(el)) return kap(tekstVan(el));
    }
    return plat(attr(el, 'title')) ? kap(attr(el, 'title')) : '';
  }

  function staatVan(el, rol, zichtbaar) {
    const s = {};
    const t = tag(el);
    if (el.disabled === true || attr(el, 'aria-disabled') === 'true' || heeftKlasse(el, 'disabled')) s.disabled = true;
    if (t === 'input' && (rol === 'checkbox' || rol === 'radio')) s.checked = el.checked === true;
    else if (ariaWaar(attr(el, 'aria-checked')) !== undefined) s.checked = ariaWaar(attr(el, 'aria-checked'));
    if (ariaWaar(attr(el, 'aria-pressed')) !== undefined) s.pressed = ariaWaar(attr(el, 'aria-pressed'));
    if (t === 'option') s.selected = el.selected === true;
    else if (ariaWaar(attr(el, 'aria-selected')) !== undefined) s.selected = ariaWaar(attr(el, 'aria-selected'));
    if (ariaWaar(attr(el, 'aria-expanded')) !== undefined) s.expanded = ariaWaar(attr(el, 'aria-expanded'));
    if (heeftKlasse(el, 'active')) s.active = true;
    if (actiefElement && actiefElement === el) s.focused = true;
    if (el.readOnly === true || attr(el, 'aria-readonly') === 'true') s.readonly = true;
    if (!zichtbaar) s.hidden = true;
    return s;
  }

  function waardeVan(el, rol) {
    const t = tag(el);
    const uit = {};
    if (t === 'select') {
      uit.value = kap(el.value ?? '');
      const opties = kinderen(el).flatMap((k) => (tag(k) === 'optgroup' ? kinderen(k) : [k]));
      const gekozen = opties.find((o) => o.selected === true);
      if (gekozen) uit.valueText = kap(tekstVan(gekozen));
    } else if (t === 'textarea' || t === 'option' || (t === 'input' && !['button', 'checkbox', 'radio'].includes(rol))) {
      if (el.value !== undefined && el.value !== null) uit.value = kap(el.value);
    }
    const nu = attr(el, 'aria-valuenow');
    if (nu !== null && uit.value === undefined) uit.value = kap(nu);
    if (plat(attr(el, 'aria-valuetext'))) uit.valueText = kap(attr(el, 'aria-valuetext'));
    return uit;
  }

  // App-koppelingen: het tabblad-id en de opdracht voor app_run_command.
  function koppelingenVan(el, rol, keuzelijst) {
    const uit = {};
    if (heeftKlasse(el, 'ribbon-tab') && !heeftKlasse(el, 'file-tab')) {
      const tab = tabNaam({ dataTab: attr(el, 'data-tab') || '', id: el.id || '', ariaControls: attr(el, 'aria-controls') || '' });
      if (tab) {
        uit.tab = tab;
        uit.command = `ribbon-tab:${tab}`;
      }
    }
    if (attr(el, 'data-ext-command')) uit.command = attr(el, 'data-ext-command');
    else if (heeftKlasse(el, 'ribbon-btn') && el.id) uit.command = `ribbon:#${el.id}`;
    if (attr(el, 'data-ext-dropdown')) uit.command = attr(el, 'data-ext-dropdown');
    if (rol === 'option' && keuzelijst && el.value) uit.command = `${keuzelijst}=${el.value}`;
    return uit;
  }

  // Een label met `for` noemt een veld dat zijn naam al uit dat label haalt.
  const isVeldLabel = (el) => tag(el) === 'label' && Boolean(attr(el, 'for') && zoekOpId(attr(el, 'for')));

  function maakKnoop(el, rol, diepte, keuzelijst, { wortel = false, zichtbaar = true } = {}) {
    const knoop = { role: rol };
    const naam = naamVan(el, rol) || (wortel ? kap(el.id || eersteKlasse(el)) : '');
    if (naam) knoop.name = naam;
    if (el.id) knoop.id = el.id;
    const titel = plat(attr(el, 'title'));
    if (titel && titel !== naam) knoop.description = kap(titel);
    Object.assign(knoop, waardeVan(el, rol));
    if (rol === 'heading' && /^h[1-6]$/.test(tag(el))) knoop.level = Number(tag(el)[1]);
    Object.assign(knoop, koppelingenVan(el, rol, keuzelijst));
    const staat = staatVan(el, rol, zichtbaar);
    if (Object.keys(staat).length) knoop.state = staat;
    aantal++;
    if (BLAD_ROLLEN.has(rol) || (!zichtbaar && !includeHidden)) return knoop;
    if (diepte >= maxDepth) {
      if (kinderen(el).length) { knoop.truncated = true; afgekapt = true; }
      return knoop;
    }
    const sub = attr(el, 'data-ext-dropdown') || keuzelijst;
    const lijst = kinderenVan(el, diepte + 1, sub, heeftKlasse(el, 'ribbon-group'));
    if (lijst.length) knoop.children = lijst;
    return knoop;
  }

  // De knopen voor de kinderen van `el`, op niveau `diepte`.
  function kinderenVan(el, diepte, keuzelijst, isLintGroep = false) {
    const uit = [];
    for (const n of knopen(el)) {
      if (isTekstKnoop(n)) {
        const t = kap(n.data ?? n.textContent ?? '');
        if (!t) continue;
        if (vol()) break;
        uit.push({ role: 'text', name: t });
        aantal++;
        continue;
      }
      if (!isElement(n)) continue;
      if (isLintGroep && heeftKlasse(n, 'ribbon-group-label')) continue; // al de groepsnaam
      uit.push(...knopenVan(n, diepte, keuzelijst));
      if (afgekapt) break;
    }
    return uit;
  }

  // Nul of meer knopen voor één element (zonder eigen rol: de kinderen).
  function knopenVan(el, diepte, keuzelijst) {
    if (OVERSLAAN.has(tag(el)) || verborgen(el) || isVeldLabel(el)) return [];
    const zichtbaar = isZichtbaar(el) !== false;
    if (!zichtbaar && !includeHidden) return [];
    const rol = rolVan(el);
    if (!rol) return kinderenVan(el, diepte, keuzelijst);
    if (vol()) return [];
    return [maakKnoop(el, rol, diepte, keuzelijst, { zichtbaar })];
  }

  const regions = [];
  for (const gebied of Array.isArray(gebieden) ? gebieden : []) {
    const nodes = [];
    for (const el of gebied?.elements ?? []) {
      if (!el) continue;
      if (vol()) break;
      // De wortel verschijnt altijd, ook zonder eigen rol of als hij verborgen is.
      nodes.push(maakKnoop(el, rolVan(el) || 'region', 1, null, { wortel: true, zichtbaar: isZichtbaar(el) !== false }));
    }
    regions.push({ region: gebied?.region ?? '', nodes });
  }
  return { regions, nodeCount: aantal, truncated: afgekapt };
}
