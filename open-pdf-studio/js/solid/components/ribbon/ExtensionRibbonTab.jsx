import { createSignal, createMemo, createEffect, createComputed, onMount, onCleanup, For, Show, Switch, Match } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import RibbonTab from './RibbonTab.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import { lintRegister } from '../../../plugins/ribbon-tab-registry.js';
import { voerExtensieOpdrachtUit } from '../../../plugins/extension-commands.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { verdeelTabbladen } from './ribbon-toetsenbord.js';

// Linttabbladen van extensies (#551). De extensie levert alleen gegevens; de
// host tekent hier het tabblad uit het weergavemodel van ribbon-tab-registry.js
// met dezelfde klassen als de ingebouwde tabbladen. Er komt geen tekst van de
// extensie in innerHTML, behalve het herschreven SVG-pictogram.

// Telt op bij elke wijziging in het register, zodat Solid opnieuw leest.
const [lintVersie, setLintVersie] = createSignal(0);
lintRegister.abonneer(() => setLintVersie((v) => v + 1));

/** Is dit het id van een geregistreerd extensietabblad? (reactief) */
export function isExtensieTabblad(id) {
  lintVersie();
  return typeof id === 'string' && lintRegister.heeft(id);
}

// Tussenruimte tussen de tabknoppen (gap van .ribbon-tabs en .ribbon-ext-tabs).
const TUSSENRUIMTE = 2;

const gelijkeLijst = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function voerUitVanuitLint(commandId) {
  const r = await voerExtensieOpdrachtUit(commandId, { source: 'ui' });
  if (!r.ok && r.code !== 'COMMAND_BUSY') console.warn(`[extensies] ${commandId}: ${r.code} ${r.error ?? ''}`);
  return r;
}

/**
 * De tabknoppen van de extensies, na "Instellingen". Past de strook niet meer,
 * dan gaan de achterste naar een compact menu achter een »-knop; het actieve
 * tabblad blijft altijd zichtbaar. Alle knoppen blijven in de DOM (verborgen
 * met een klasse), zodat `.ribbon-tab[data-tab=…]` ze altijd vindt.
 */
export function ExtensionTabStrip(props) {
  const { t, language } = useTranslation('ribbon');
  const tabs = createMemo(() => { lintVersie(); return lintRegister.tabbladen(language()); });
  const ids = createMemo(() => tabs().map((tab) => tab.id), [], { equals: gelijkeLijst });
  const info = (id) => tabs().find((tab) => tab.id === id);
  const [verborgen, setVerborgen] = createSignal([]);
  const [open, setOpen] = createSignal(false);
  let strookEl;
  let meerEl;
  let menuEl;
  let raf = 0;

  // Meet de natuurlijke breedtes (alles even zichtbaar) en verdeel opnieuw.
  const meet = () => {
    if (!strookEl) return;
    const knoppen = [...strookEl.querySelectorAll('.ribbon-tab')];
    for (const k of knoppen) k.classList.remove('ribbon-ext-tab-verborgen');
    // Elke knop met de tussenruimte van de strook; de ruimte is die van de strook
    // plus die van de »-knop als die er nu staat (zonder knop krijgt de strook die).
    const breedtes = knoppen.map((k) => k.offsetWidth + TUSSENRUIMTE);
    const meer = meerEl?.isConnected ? meerEl.offsetWidth + 2 + TUSSENRUIMTE : 0;
    const beschikbaar = strookEl.clientWidth + TUSSENRUIMTE + meer;
    const lijst = knoppen.map((k) => k.dataset.tab);
    const { verborgen: weg } = verdeelTabbladen(breedtes, beschikbaar, lijst.indexOf(props.activeTab()));
    weg.forEach((i) => knoppen[i].classList.add('ribbon-ext-tab-verborgen'));
    const nieuw = weg.map((i) => lijst[i]);
    if (!gelijkeLijst(nieuw, verborgen())) setVerborgen(nieuw);
    if (!nieuw.length) setOpen(false);
  };
  const planMeting = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; meet(); });
  };

  // Direct na een tabwissel, zodat een tabblad uit het menu meteen zichtbaar is.
  createEffect(() => { props.activeTab(); ids(); language(); meet(); });

  const plaatsMenu = () => {
    if (!menuEl || !meerEl) return;
    const r = meerEl.getBoundingClientRect();
    const breedte = menuEl.offsetWidth;
    const links = Math.max(4, Math.min(Math.round(r.right - breedte), window.innerWidth - breedte - 4));
    menuEl.style.left = `${links}px`;
    menuEl.style.top = `${Math.round(r.bottom)}px`;
  };

  const sluit = (focusMeer = false) => {
    setOpen(false);
    if (focusMeer) meerEl?.focus();
  };
  const kies = (id) => {
    setOpen(false);
    props.setActiveTab(id);
    requestAnimationFrame(() => strookEl?.querySelector(`.ribbon-tab[data-tab="${CSS.escape(id)}"]`)?.focus());
  };
  const opBuitenklik = (e) => {
    if (!open()) return;
    if (menuEl?.contains(e.target) || meerEl?.contains(e.target)) return;
    setOpen(false);
  };
  const opMenuToets = (e) => {
    const items = [...(menuEl?.querySelectorAll('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); sluit(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };

  createEffect(() => {
    if (!open()) return;
    requestAnimationFrame(() => { plaatsMenu(); menuEl?.querySelector('[role="menuitem"]')?.focus(); });
  });

  onMount(() => {
    const ro = new ResizeObserver(planMeting);
    if (props.strookOuder?.()) ro.observe(props.strookOuder());
    document.addEventListener('mousedown', opBuitenklik, true);
    window.addEventListener('resize', planMeting);
    if (document.fonts?.ready) document.fonts.ready.then(planMeting);
    onCleanup(() => {
      ro.disconnect();
      document.removeEventListener('mousedown', opBuitenklik, true);
      window.removeEventListener('resize', planMeting);
      if (raf) cancelAnimationFrame(raf);
    });
  });

  return (
    <Show when={ids().length > 0}>
      <div class="ribbon-ext-tabs" ref={strookEl}>
        <For each={ids()}>
          {(id) => (
            <RibbonTab
              dataTab={id}
              label={info(id)?.label ?? ''}
              title={info(id)?.label ?? ''}
              icon={info(id)?.icon ?? null}
              extensie={true}
              isActive={props.activeTab() === id}
              onClick={() => props.setActiveTab(id)}
            />
          )}
        </For>
      </div>
      <Show when={verborgen().length > 0}>
        <button type="button" class={`ribbon-ext-more${open() ? ' open' : ''}`} ref={meerEl}
          title={t('common.moreTabs')} aria-label={t('common.moreTabs')}
          aria-haspopup="menu" aria-expanded={open() ? 'true' : 'false'}
          onClick={() => setOpen((v) => !v)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 2 L4 5 L1 8 M5 2 L8 5 L5 8" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
        </button>
      </Show>
      <Show when={open()}>
        <div class="ribbon-overflow-flyout ribbon-ext-menu" role="menu" ref={menuEl} onKeyDown={opMenuToets}>
          <For each={verborgen()}>
            {(id) => (
              <button type="button" role="menuitem" class="ribbon-ext-menu-item" data-ext-tab-menu={id}
                title={info(id)?.label ?? ''} onClick={() => kies(id)}>
                <span class="ribbon-ext-tab-icon" aria-hidden="true"
                  ref={(el) => createEffect(() => { el.innerHTML = info(id)?.icon ?? ''; })} />
                <span class="ribbon-ext-menu-label">{info(id)?.label ?? ''}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}

function Actie(props) {
  const item = props.item;
  return (
    <RibbonButton
      extCommand={item.commandId}
      pressed={item.active ? 'true' : undefined}
      size={item.size === 'large' ? undefined : item.size}
      active={item.active}
      disabled={item.disabled || item.loopt}
      icon={item.icon}
      label={item.label}
      title={item.title}
      onClick={() => voerUitVanuitLint(item.commandId)}
    />
  );
}

function Keuzelijst(props) {
  const item = props.item;
  const selectId = () => `ext-${props.tabId}-${item.id}`;
  const opWijziging = async (e) => {
    const select = e.currentTarget;
    const optie = item.options.find((o) => o.id === select.value);
    if (!optie) return;
    const r = await voerUitVanuitLint(optie.commandId);
    // Bij een fout blijft de oude waarde staan.
    if (!r.ok) select.value = item.value;
  };
  return (
    <div class="ribbon-input-row ribbon-ext-row" title={item.title}>
      <label class="ribbon-input-label" for={selectId()}>{item.label}</label>
      <select id={selectId()} class="ribbon-form-select" disabled={item.disabled}
        data-ext-dropdown={`ext:${props.extId}:${item.id}`} onChange={opWijziging}>
        <For each={item.options}>
          {(o) => <option value={o.id} selected={o.id === item.value}>{o.label}</option>}
        </For>
      </select>
    </div>
  );
}

function Status(props) {
  const item = props.item;
  return (
    <div class="ribbon-input-row ribbon-ext-row ribbon-ext-status" role="status" data-tone={item.tone}
      data-ext-status={`${props.extId}:${item.id}`}>
      <span class="ribbon-input-label">{item.label}</span>
      <span class={`ribbon-ext-status-text ribbon-ext-tone-${item.tone}`}>{item.text}</span>
    </div>
  );
}

function Element(props) {
  const el = props.element;
  return (
    <Switch>
      <Match when={el.soort === 'action'}><Actie item={el} /></Match>
      <Match when={el.soort === 'stapel'}>
        <RibbonButtonStack>
          <For each={el.items}>{(item) => <Actie item={item} />}</For>
        </RibbonButtonStack>
      </Match>
      <Match when={el.soort === 'kolom'}>
        <div class="ribbon-ext-kolom">
          <For each={el.items}>
            {(item) => (
              <Switch>
                <Match when={item.soort === 'dropdown'}><Keuzelijst item={item} tabId={props.tabId} extId={props.extId} /></Match>
                <Match when={item.soort === 'status'}><Status item={item} extId={props.extId} /></Match>
              </Switch>
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}

/** De inhoud van één extensietabblad. */
export default function ExtensionRibbonTab(props) {
  const { language } = useTranslation('ribbon');
  // Een store met reconcile: alleen gewijzigde velden werken de DOM bij, zodat
  // een statusupdate de focus in een keuzelijst niet wegneemt.
  const [model, setModel] = createStore({ groepen: [] });
  // Vóór het eerste tekenen al gevuld, zodat er geen leeg tabblad flitst.
  createComputed(() => {
    lintVersie();
    const m = lintRegister.model(props.id, language());
    setModel(reconcile(m ?? { groepen: [] }, { key: 'id' }));
  });
  return (
    <div class="ribbon-content active ribbon-ext-content" id={`tab-${props.id}`} role="tabpanel" data-ext-tab={props.id}>
      <AdaptiveGroups>
        <For each={model.groepen}>
          {(g) => (
            <RibbonGroup label={g.label}>
              <For each={g.elementen}>
                {(el) => <Element element={el} tabId={props.id} extId={model.extId} />}
              </For>
            </RibbonGroup>
          )}
        </For>
      </AdaptiveGroups>
    </div>
  );
}
