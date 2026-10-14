/**
 * Register van linttabbladen van extensies (#551).
 *
 * `api.registerRibbonTab(descriptor)` komt hier binnen. Het register
 * valideert de hele descriptor vooraf (id's, labels, pictogrammen, limieten);
 * bij een fout gooit het een ExtensionContributionError en wordt er niets
 * geregistreerd. Daarna houdt het de gegevens bij, maakt het voor elke actie
 * en elke keuze een `ext:`-opdracht en levert het de host een weergavemodel.
 * De extensie raakt de DOM nooit aan: de host tekent het tabblad
 * (ExtensionRibbonTab.jsx) uit het model.
 *
 * Alles loopt via de bijdragescope van de extensie, zodat deactiveren of
 * herladen tabblad en opdrachten gegarandeerd opruimt.
 *
 * Zuivere module: het actieve lint-tabblad en de opdrachten worden ingespoten.
 */

import { ExtensionContributionError, eigenaarVan, isStriktExtensieId } from './extension-contributions.js';
import { valideerPictogram } from './svg-pictogram.js';
import { opdrachtId, kiesTekst, extensieOpdrachten } from './extension-commands.js';
import * as ribbonIcons from '../solid/data/ribbonIcons.js';

const LOKAAL_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TAALCODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const STUURTEKENS = /[\u0000-\u001f\u007f]/;

const MAX_TABBLADEN = 3;
const MAX_GROEPEN = 8;
const MAX_ITEMS = 12;
const MAX_OPTIES = 50;
const MAX_TABLABEL = 24;
const MAX_LABEL = 40;
const MAX_TITEL = 200;
const MAX_STATUSTEKST = 40;
const MAX_ORDER = 1000;

const GROOTTES = new Set(['large', 'medium', 'small']);
const TINTEN = new Set(['neutral', 'success', 'warning', 'error']);
// Hoeveel knoppen er in één stapel passen (zoals RibbonButtonStack).
const PER_STAPEL = { medium: 2, small: 3 };
// Opeenvolgende keuzelijsten en statusregels: hooguit drie rijen per kolom.
const PER_KOLOM = 3;

const VELDEN_TAB = new Set(['id', 'label', 'icon', 'order', 'groups']);
const VELDEN_GROEP = new Set(['id', 'label', 'items']);
const VELDEN_ITEM = {
  action: new Set(['type', 'id', 'label', 'title', 'icon', 'size', 'disabled', 'active', 'onRun']),
  dropdown: new Set(['type', 'id', 'label', 'title', 'options', 'value', 'disabled', 'onChange']),
  status: new Set(['type', 'id', 'label', 'text', 'tone']),
};
// Wat update() per soort mag wijzigen.
const WIJZIGBAAR = {
  action: new Set(['label', 'title', 'disabled', 'active', 'icon']),
  dropdown: new Set(['label', 'title', 'disabled', 'value', 'options']),
  status: new Set(['label', 'text', 'tone']),
};

const ongeldig = (bericht) => new ExtensionContributionError('INVALID_CONTRIBUTION', bericht);
const teVeel = (bericht) => new ExtensionContributionError('LIMIT_EXCEEDED', bericht);
const conflict = (bericht) => new ExtensionContributionError('CONTRIBUTION_CONFLICT', bericht);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function alleenVelden(obj, toegestaan, wat) {
  for (const k of Object.keys(obj)) {
    if (!toegestaan.has(k)) throw ongeldig(`${wat}: unknown field "${k}"`);
  }
}

function controleerLokaalId(id, wat) {
  if (typeof id !== 'string' || !LOKAAL_ID.test(id)) {
    throw ongeldig(`${wat}: id "${String(id)}" must match ${LOKAAL_ID}`);
  }
  return id;
}

function controleerString(s, max, wat, { leegMag = false } = {}) {
  if (typeof s !== 'string') throw ongeldig(`${wat} must be a string`);
  if (!leegMag && !s.trim()) throw ongeldig(`${wat} must not be empty`);
  if (s.length > max) throw ongeldig(`${wat} is longer than ${max} characters`);
  if (STUURTEKENS.test(s)) throw ongeldig(`${wat} contains control characters`);
  return s;
}

/** Een label: string of { taalcode: tekst }. Geeft een (bevroren) kopie. */
function controleerTekst(t, max, wat) {
  if (typeof t === 'string') return controleerString(t, max, wat);
  if (!isObject(t)) throw ongeldig(`${wat} must be a string or { languageCode: text }`);
  const paren = Object.entries(t);
  if (!paren.length) throw ongeldig(`${wat} has no text`);
  const kopie = {};
  for (const [taal, tekst] of paren) {
    if (!TAALCODE.test(taal)) throw ongeldig(`${wat}: invalid language code "${taal}"`);
    kopie[taal] = controleerString(tekst, max, `${wat} (${taal})`);
  }
  return Object.freeze(kopie);
}

function controleerBool(v, wat) {
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw ongeldig(`${wat} must be a boolean`);
  return v;
}

function controleerOpties(opties, wat) {
  if (!Array.isArray(opties) || !opties.length) throw ongeldig(`${wat}: options must be a non-empty array`);
  if (opties.length > MAX_OPTIES) throw teVeel(`${wat}: more than ${MAX_OPTIES} options`);
  const gezien = new Set();
  return opties.map((o, i) => {
    if (!isObject(o)) throw ongeldig(`${wat}: option ${i} must be an object`);
    alleenVelden(o, new Set(['id', 'label']), `${wat} option ${i}`);
    const id = controleerLokaalId(o.id, `${wat} option ${i}`);
    if (gezien.has(id)) throw ongeldig(`${wat}: duplicate option id "${id}"`);
    gezien.add(id);
    return Object.freeze({ id, label: controleerTekst(o.label, MAX_LABEL, `${wat} option ${id} label`) });
  });
}

/**
 * @param {{ opdrachten: ReturnType<import('./extension-commands.js').maakOpdrachtRegister>,
 *   iconen: Record<string, string> }} afh
 */
export function maakLintRegister({ opdrachten, iconen }) {
  // volledig tab-id -> tabrecord
  const tabbladen = new Map();
  // extId -> Set(item-id's) over alle tabbladen van die extensie
  const itemsPerExtensie = new Map();
  const luisteraars = new Set();
  let volgnummer = 0;
  let lint = { lees: () => null, zet: () => {} };

  const meld = () => { for (const fn of [...luisteraars]) { try { fn(); } catch { /* luisteraar mag niet storen */ } } };
  opdrachten.abonneer(meld);

  function controleerItem(item, extId, wat) {
    if (!isObject(item)) throw ongeldig(`${wat} must be an object`);
    const type = item.type;
    if (!Object.prototype.hasOwnProperty.call(VELDEN_ITEM, type)) throw ongeldig(`${wat}: unknown type "${String(type)}"`);
    alleenVelden(item, VELDEN_ITEM[type], wat);
    const id = controleerLokaalId(item.id, wat);
    const rec = { type, id, label: controleerTekst(item.label, MAX_LABEL, `${wat} label`) };
    if (type === 'action') {
      if (typeof item.onRun !== 'function') throw ongeldig(`${wat}: onRun must be a function`);
      rec.title = item.title === undefined ? null : controleerTekst(item.title, MAX_TITEL, `${wat} title`);
      rec.icon = valideerPictogram(item.icon, iconen);
      rec.size = item.size === undefined ? 'large' : item.size;
      if (!GROOTTES.has(rec.size)) throw ongeldig(`${wat}: size must be large, medium or small`);
      rec.disabled = controleerBool(item.disabled, `${wat} disabled`);
      rec.active = controleerBool(item.active, `${wat} active`);
      rec.onRun = item.onRun;
    } else if (type === 'dropdown') {
      if (item.onChange !== undefined && typeof item.onChange !== 'function') throw ongeldig(`${wat}: onChange must be a function`);
      rec.title = item.title === undefined ? null : controleerTekst(item.title, MAX_TITEL, `${wat} title`);
      rec.options = controleerOpties(item.options, wat);
      rec.value = item.value === undefined ? rec.options[0].id : item.value;
      if (!rec.options.some((o) => o.id === rec.value)) throw ongeldig(`${wat}: value "${String(rec.value)}" is not one of the options`);
      rec.disabled = controleerBool(item.disabled, `${wat} disabled`);
      rec.onChange = item.onChange ?? null;
    } else {
      rec.text = item.text === undefined ? '' : controleerString(item.text, MAX_STATUSTEKST, `${wat} text`, { leegMag: true });
      rec.tone = item.tone === undefined ? 'neutral' : item.tone;
      if (!TINTEN.has(rec.tone)) throw ongeldig(`${wat}: tone must be neutral, success, warning or error`);
    }
    return rec;
  }

  function volledigId(extId, id) {
    if (typeof id === 'string' && id.includes('.')) {
      if (!id.startsWith(`${extId}.`)) throw ongeldig(`tab id "${id}" must start with "${extId}."`);
      controleerLokaalId(id.slice(extId.length + 1), 'tab');
      return id;
    }
    return `${extId}.${controleerLokaalId(id, 'tab')}`;
  }

  // De opdrachten van één item: [{ id, maak: () => opdracht }].
  function opdrachtenVan(tab, item) {
    const extId = tab.extId;
    if (item.type === 'action') {
      return [{
        id: opdrachtId(extId, item.id),
        opdracht: {
          id: opdrachtId(extId, item.id), extId, tab: tab.id, kind: 'action',
          lees: () => ({ label: item.label, title: item.title ?? item.label, disabled: item.disabled, active: item.active }),
          voerUit: (ctx) => item.onRun(ctx),
        },
      }];
    }
    if (item.type === 'dropdown') {
      return item.options.map((optie) => ({
        id: opdrachtId(extId, item.id, optie.id),
        opdracht: {
          id: opdrachtId(extId, item.id, optie.id), extId, tab: tab.id, kind: 'option',
          lees: () => ({ label: optie.label, title: item.title ?? item.label, disabled: item.disabled, active: item.value === optie.id }),
          voerUit: async (ctx) => {
            const resultaat = item.onChange ? await item.onChange(optie.id, ctx) : undefined;
            // Pas na een geslaagde afhandeling; bestaat de keuze nog?
            if (item.options.some((o) => o.id === optie.id)) {
              item.value = optie.id;
              meld();
            }
            return resultaat;
          },
        },
      }));
    }
    return [];
  }

  function verwijderTab(id) {
    const tab = tabbladen.get(id);
    if (!tab) return;
    tabbladen.delete(id);
    const items = itemsPerExtensie.get(tab.extId);
    if (items) for (const itemId of tab.items.keys()) items.delete(itemId);
    if (lint.lees() === id) lint.zet('home');
    meld();
  }

  function maakHandle(scope, tab) {
    let weg = false;
    const levend = () => !weg && scope.actief() && tabbladen.get(tab.id) === tab;
    return {
      id: tab.id,
      update(itemId, patch) {
        if (!levend()) return;
        const item = tab.items.get(itemId);
        if (!item) throw ongeldig(`update: unknown item "${String(itemId)}"`);
        if (!isObject(patch)) throw ongeldig('update: patch must be an object');
        for (const k of Object.keys(patch)) {
          if (!WIJZIGBAAR[item.type].has(k)) throw ongeldig(`update: "${k}" cannot be changed on a ${item.type}`);
        }
        const wat = `item ${item.id}`;
        // Eerst alles controleren, dan pas toepassen.
        const nieuw = {};
        if ('label' in patch) nieuw.label = controleerTekst(patch.label, MAX_LABEL, `${wat} label`);
        if ('title' in patch) nieuw.title = patch.title === null ? null : controleerTekst(patch.title, MAX_TITEL, `${wat} title`);
        if ('disabled' in patch) nieuw.disabled = controleerBool(patch.disabled, `${wat} disabled`);
        if ('active' in patch) nieuw.active = controleerBool(patch.active, `${wat} active`);
        if ('icon' in patch) nieuw.icon = valideerPictogram(patch.icon, iconen);
        if ('text' in patch) nieuw.text = controleerString(patch.text, MAX_STATUSTEKST, `${wat} text`, { leegMag: true });
        if ('tone' in patch) {
          if (!TINTEN.has(patch.tone)) throw ongeldig(`${wat}: tone must be neutral, success, warning or error`);
          nieuw.tone = patch.tone;
        }
        let oudeOpdrachten = null;
        let nieuweOpdrachten = null;
        if (item.type === 'dropdown' && ('options' in patch || 'value' in patch)) {
          const opties = 'options' in patch ? controleerOpties(patch.options, wat) : item.options;
          let waarde = 'value' in patch ? patch.value : item.value;
          if (!opties.some((o) => o.id === waarde)) {
            if ('value' in patch) throw ongeldig(`${wat}: value "${String(waarde)}" is not one of the options`);
            waarde = opties[0].id;
          }
          nieuw.value = waarde;
          if ('options' in patch) {
            nieuw.options = opties;
            oudeOpdrachten = opdrachtenVan(tab, item).map((o) => o.id);
            nieuweOpdrachten = opdrachtenVan(tab, { ...item, options: opties });
            for (const { id } of nieuweOpdrachten) {
              if (!oudeOpdrachten.includes(id) && eigenaarVan('command', id)) throw conflict(`command ${id} is already registered`);
            }
          }
        }
        if (nieuweOpdrachten) {
          for (const id of oudeOpdrachten) scope.verwijder('command', id);
          Object.assign(item, nieuw);
          // Opnieuw opbouwen tegen het bijgewerkte item, zodat de opdrachten het levende item lezen.
          for (const { id, opdracht } of opdrachtenVan(tab, item)) {
            opdrachten.registreer(opdracht);
            scope.voegToe('command', id, () => opdrachten.verwijder(id));
          }
        } else {
          Object.assign(item, nieuw);
        }
        meld();
      },
      dispose() {
        if (!levend()) { weg = true; return; }
        weg = true;
        for (const id of tab.opdrachtIds()) scope.verwijder('command', id);
        scope.verwijder('ribbonTab', tab.id);
      },
    };
  }

  return {
    /** Koppel het actieve lint-tabblad (ribbonStore); los van Solid te testen. */
    koppelLint({ lees, zet }) {
      lint = { lees, zet };
    },

    /**
     * Registreer een tabblad voor de extensie van `scope`. Gooit een
     * ExtensionContributionError; bij een fout is er niets geregistreerd.
     */
    registreer(scope, d) {
      const extId = scope.extId;
      if (!scope.actief()) {
        throw new ExtensionContributionError('EXTENSION_INACTIVE', `extension ${extId} is no longer active`);
      }
      if (!isStriktExtensieId(extId)) {
        throw ongeldig(`extension id "${extId}" does not meet the strict id rule required for ribbon tabs`);
      }
      if (!isObject(d)) throw ongeldig('ribbon tab descriptor must be an object');
      alleenVelden(d, VELDEN_TAB, 'ribbon tab');
      const id = volledigId(extId, d.id);
      const label = controleerTekst(d.label, MAX_TABLABEL, 'tab label');
      const icon = valideerPictogram(d.icon, iconen);
      const order = d.order === undefined ? 0 : d.order;
      if (!Number.isInteger(order) || Math.abs(order) > MAX_ORDER) throw ongeldig(`order must be an integer between -${MAX_ORDER} and ${MAX_ORDER}`);
      if (!Array.isArray(d.groups) || !d.groups.length) throw ongeldig('groups must be a non-empty array');
      if (d.groups.length > MAX_GROEPEN) throw teVeel(`more than ${MAX_GROEPEN} groups`);

      const groepIds = new Set();
      const items = new Map();
      const groepen = d.groups.map((g, gi) => {
        const wat = `group ${gi}`;
        if (!isObject(g)) throw ongeldig(`${wat} must be an object`);
        alleenVelden(g, VELDEN_GROEP, wat);
        const gid = controleerLokaalId(g.id, wat);
        if (groepIds.has(gid)) throw ongeldig(`duplicate group id "${gid}"`);
        groepIds.add(gid);
        const glabel = controleerTekst(g.label, MAX_LABEL, `${wat} label`);
        if (!Array.isArray(g.items) || !g.items.length) throw ongeldig(`${wat}: items must be a non-empty array`);
        if (g.items.length > MAX_ITEMS) throw teVeel(`${wat}: more than ${MAX_ITEMS} items`);
        const lijst = g.items.map((item, ii) => {
          const rec = controleerItem(item, extId, `${wat} item ${ii}`);
          if (items.has(rec.id)) throw conflict(`duplicate item id "${rec.id}"`);
          items.set(rec.id, rec);
          return rec;
        });
        return { id: gid, label: glabel, items: lijst };
      });

      const eigen = [...tabbladen.values()].filter((t) => t.extId === extId);
      if (tabbladen.has(id) || eigenaarVan('ribbonTab', id)) throw conflict(`ribbon tab "${id}" is already registered`);
      if (eigen.length >= MAX_TABBLADEN) throw teVeel(`more than ${MAX_TABBLADEN} ribbon tabs per extension`);
      const bezet = itemsPerExtensie.get(extId) ?? new Set();
      for (const itemId of items.keys()) {
        if (bezet.has(itemId)) throw conflict(`item id "${itemId}" is already used by another tab of ${extId}`);
      }

      const tab = {
        id, extId, label, icon, order, volgnummer: volgnummer++, groepen, items,
        opdrachtIds: () => [...items.values()].flatMap((item) => opdrachtenVan(tab, item).map((o) => o.id)),
      };
      const nieuweOpdrachten = [...items.values()].flatMap((item) => opdrachtenVan(tab, item));
      for (const { id: cid } of nieuweOpdrachten) {
        if (eigenaarVan('command', cid) || opdrachten.heeft(cid)) throw conflict(`command ${cid} is already registered`);
      }

      // Registreren; bij een onverwachte fout halverwege alles terugdraaien.
      const gedaan = [];
      try {
        scope.voegToe('ribbonTab', id, () => verwijderTab(id));
        gedaan.push(['ribbonTab', id]);
        tabbladen.set(id, tab);
        itemsPerExtensie.set(extId, bezet);
        for (const itemId of items.keys()) bezet.add(itemId);
        for (const { id: cid, opdracht } of nieuweOpdrachten) {
          opdrachten.registreer(opdracht);
          scope.voegToe('command', cid, () => opdrachten.verwijder(cid));
          gedaan.push(['command', cid]);
        }
      } catch (fout) {
        for (const [soort, sleutel] of gedaan.reverse()) scope.verwijder(soort, sleutel);
        for (const { id: cid } of nieuweOpdrachten) opdrachten.verwijder(cid);
        verwijderTab(id);
        throw fout;
      }
      meld();
      return maakHandle(scope, tab);
    },

    /** unregisterRibbonTab: alleen een eigen tabblad. Geeft true als het weg is. */
    afmelden(scope, id) {
      let vol;
      try { vol = volledigId(scope.extId, id); } catch { return false; }
      const tab = tabbladen.get(vol);
      if (!tab || tab.extId !== scope.extId) return false;
      for (const cid of tab.opdrachtIds()) scope.verwijder('command', cid);
      scope.verwijder('ribbonTab', vol);
      return !tabbladen.has(vol);
    },

    heeft: (id) => tabbladen.has(id),

    /** De tab-id's van één extensie. */
    vanExtensie: (extId) => [...tabbladen.values()].filter((t) => t.extId === extId).map((t) => t.id),

    /** De tabknoppen, gesorteerd op extensie-id en daarna order. */
    tabbladen(taal) {
      return [...tabbladen.values()]
        .sort((a, b) => (a.extId < b.extId ? -1 : a.extId > b.extId ? 1 : (a.order - b.order) || (a.volgnummer - b.volgnummer)))
        .map((t) => ({ id: t.id, extId: t.extId, label: kiesTekst(t.label, taal), icon: t.icon, order: t.order }));
    },

    /** Het weergavemodel van één tabblad voor de host, of null. */
    model(id, taal) {
      const tab = tabbladen.get(id);
      if (!tab) return null;
      const k = (t) => kiesTekst(t, taal);
      const vormItem = (item) => {
        if (item.type === 'action') {
          const commandId = opdrachtId(tab.extId, item.id);
          return {
            soort: 'action', id: item.id, commandId, label: k(item.label), title: k(item.title ?? item.label),
            icon: item.icon, size: item.size, disabled: item.disabled, active: item.active, loopt: opdrachten.loopt(commandId),
          };
        }
        if (item.type === 'dropdown') {
          return {
            soort: 'dropdown', id: item.id, label: k(item.label), title: k(item.title ?? item.label), value: item.value,
            disabled: item.disabled,
            options: item.options.map((o) => ({ id: o.id, label: k(o.label), commandId: opdrachtId(tab.extId, item.id, o.id) })),
          };
        }
        return { soort: 'status', id: item.id, label: k(item.label), text: item.text, tone: item.tone };
      };
      const groepen = tab.groepen.map((g) => {
        const elementen = [];
        for (const item of g.items) {
          const vorm = vormItem(item);
          const vorige = elementen[elementen.length - 1];
          if (vorm.soort === 'action' && vorm.size !== 'large') {
            if (vorige?.soort === 'stapel' && vorige.size === vorm.size && vorige.items.length < PER_STAPEL[vorm.size]) {
              vorige.items.push(vorm);
            } else {
              elementen.push({ soort: 'stapel', size: vorm.size, items: [vorm] });
            }
          } else if (vorm.soort === 'dropdown' || vorm.soort === 'status') {
            if (vorige?.soort === 'kolom' && vorige.items.length < PER_KOLOM) vorige.items.push(vorm);
            else elementen.push({ soort: 'kolom', items: [vorm] });
          } else {
            elementen.push(vorm);
          }
        }
        return { id: g.id, label: k(g.label), elementen };
      });
      return { id: tab.id, extId: tab.extId, label: k(tab.label), icon: tab.icon, groepen };
    },

    /** Luister naar wijzigingen. Geeft een afmeldfunctie. */
    abonneer(fn) {
      luisteraars.add(fn);
      return () => luisteraars.delete(fn);
    },
  };
}

// Het register van de app: de plug-in-API registreert hier, Ribbon.jsx tekent hieruit.
export const lintRegister = maakLintRegister({ opdrachten: extensieOpdrachten, iconen: ribbonIcons });
