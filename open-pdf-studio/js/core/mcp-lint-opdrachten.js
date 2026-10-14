// Regels van de lint-opdrachten in app_list_commands, app_run_command en
// app_click_element (#584), los van de DOM zodat ze onder node:test te
// toetsen zijn. De bridge (mcp-bridge.js) doet het klikken en het zoeken.
//
// Opdracht-id's:
//   ribbon-tab:<tab>      een linttabblad activeren (ingebouwd of van een extensie)
//   ribbon:#<id>          lintknop met een vaste id (stabiel tussen versies)
//   ribbon:<tab>:<n>      lintknop zonder id, n-de knop op dat tabblad
//   ext:<extId>:<item>    een actie van een extensie (#551, extension-commands.js)
//
// Een tabblad heet naar zijn `data-tab`. Een tabknop die een extensie zelf in
// de DOM zet zonder `data-tab`, heet naar zijn element-id: `#<id>`, en zonder
// id naar het paneel uit `aria-controls` (`tab-<naam>` geeft `<naam>`).

/** De ingebouwde tabbladen, in de volgorde waarin het zoeken ze langsloopt. */
export const INGEBOUWDE_TABBLADEN = Object.freeze(['home', 'view', 'drawing', 'comment', 'organize', 'arrange', 'format', 'image', 'help']);

/** Lees een lint-opdracht; null als het geen lint-opdracht is. */
export function leesLintOpdracht(command) {
  if (typeof command !== 'string') return null;
  if (command.startsWith('ribbon-tab:')) {
    const tab = command.slice('ribbon-tab:'.length);
    return tab ? { soort: 'tab', tab } : null;
  }
  if (command.startsWith('ribbon:#')) {
    const id = command.slice('ribbon:#'.length);
    return id ? { soort: 'id', id } : null;
  }
  // Het nummer staat na de laatste dubbele punt; het tab-id mag punten,
  // streepjes en cijfers bevatten (extensietabbladen: <extId>.<tab>).
  const m = command.match(/^ribbon:(.+):(\d+)$/);
  return m ? { soort: 'positie', tab: m[1], n: Number(m[2]) } : null;
}

/**
 * De naam van een tabknop: `data-tab`, anders `#<id>`, anders het paneel uit
 * `aria-controls` (zonder het voorvoegsel `tab-`, zoals de ingebouwde panelen
 * heten). Null als de knop geen naam heeft.
 */
export function tabNaam({ dataTab = '', id = '', ariaControls = '' } = {}) {
  if (dataTab) return dataTab;
  if (id) return `#${id}`;
  if (ariaControls) return ariaControls.startsWith('tab-') && ariaControls.length > 4 ? ariaControls.slice(4) : ariaControls;
  return null;
}

/**
 * Het getoonde tabblad. De DOM gaat voor de lintstore: een extensie die zelf
 * een tabknop in de DOM zet, toont haar tabblad buiten de store om. Zijn er
 * twee knoppen actief, dan is het niet-ingebouwde tabblad het getoonde.
 * @param {Array<{ tab: string, actief: boolean }>} knoppen
 * @param {string|null} storeTab  het actieve tabblad volgens de lintstore
 */
export function actiefTabblad(knoppen, storeTab = null) {
  const actief = knoppen.filter((k) => k.actief).map((k) => k.tab);
  if (actief.length === 1) return actief[0];
  if (actief.length > 1) {
    return actief.find((t) => !INGEBOUWDE_TABBLADEN.includes(t)) ?? (actief.includes(storeTab) ? storeTab : actief[0]);
  }
  return storeTab ?? null;
}

/** Het opdracht-id voor een lintknop. */
export function knopOpdrachtId(tab, { id = '', n = 0 } = {}) {
  return id ? `ribbon:#${id}` : `ribbon:${tab}:${n}`;
}

/**
 * Wat voor tabblad is dit?
 *   'builtin'    een ingebouwd tabblad
 *   'extension'  een geregistreerd extensietabblad (#551): de opdrachten komen
 *                uit het register, niet uit de DOM
 *   'dom'        een tabknop die een extensie zelf in de DOM zette: alleen via
 *                de DOM te bereiken
 */
export function tabSoort(tab, extensieTabs = []) {
  if (INGEBOUWDE_TABBLADEN.includes(tab)) return 'builtin';
  if (extensieTabs.includes(tab)) return 'extension';
  return 'dom';
}

/**
 * In welke volgorde het zoeken de tabbladen langsloopt: eerst de ingebouwde
 * (vaste volgorde, alleen die er nu zijn), dan de overige in DOM-volgorde.
 * Het tabblad `overslaan` (het actieve) komt niet voor: dat is al doorzocht.
 */
export function tabVolgorde(inDom, overslaan = null) {
  const aanwezig = new Set(inDom);
  const ingebouwd = INGEBOUWDE_TABBLADEN.filter((t) => aanwezig.has(t));
  const rest = inDom.filter((t, i) => !INGEBOUWDE_TABBLADEN.includes(t) && inDom.indexOf(t) === i);
  return [...ingebouwd, ...rest].filter((t) => t !== overslaan);
}

/**
 * Welk tabblad heeft deze aanroep geactiveerd (voor `activatedTab`)?
 * Een klik op een tabknop activeert dat tabblad; anders telt een wissel van
 * het actieve tabblad door de klik, en anders het tabblad dat het zoeken opende.
 */
export function geactiveerdTabblad({ gezocht = null, voor = null, na = null, tabKnop = null } = {}) {
  if (tabKnop) return tabKnop;
  if (na && na !== voor) return na;
  return gezocht ?? null;
}

/**
 * De tabbladen als opdrachten voor app_list_commands.
 * @param {Array<{ tab: string, label?: string, title?: string, active?: boolean, extension?: string|null }>} tabs
 * @param {string|null} actief  het actieve tabblad volgens het lint
 */
export function tabOpdrachten(tabs, actief = null) {
  return tabs.map((t) => ({
    command: `ribbon-tab:${t.tab}`,
    tab: t.tab,
    label: t.label || '',
    title: t.title || '',
    disabled: false,
    active: t.active === true || t.tab === actief,
    stableId: true,
    kind: 'tab',
    ...(t.extension ? { extension: t.extension } : {}),
  }));
}
