// Papiermaat-velden van het eigenschappenpaneel in de gekozen eenheid (#598):
// een invoerveld dat paginapunten toont als mm, cm, in of pt, een keuzelijst
// voor die eenheid en een vast eenheidslabel.
import { createEffect } from 'solid-js';
import { PAPIER_EENHEDEN, toonInEenheid } from '../../../annotations/papiermaat-eenheid.js';
import { papierEenheid, kiesPapierEenheid } from '../../stores/papierEenheidStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

/**
 * Invoerveld voor een papiermaat.
 *
 * props.pt       accessor: de maat in paginapunten (uit de store)
 * props.bron     accessor: id van de geselecteerde annotatie
 * props.onInvoer (tekst) bij elke toetsaanslag, tekst in de gekozen eenheid
 * props.onWijzig (tekst) bij bevestigen (Enter / verlaten)
 * props.disabled boolean
 *
 * Het getal wordt alleen in het veld gezet wanneer de gebruiker er NIET in
 * typt (of de selectie wisselt): anders zou de afgeronde weergave de getypte
 * tekst overschrijven ("25.40" wordt "25.4", "0." wordt leeg). Bij verlaten
 * komt de afgeronde weergave terug.
 */
export function PapierMaatInvoer(props) {
  let el;
  let vorigeBron;
  const tekst = () => String(toonInEenheid(props.pt(), papierEenheid()));

  createEffect(() => {
    const t = tekst();
    const bron = props.bron ? props.bron() : undefined;
    if (!el) return;
    const zelfdeBron = bron === vorigeBron;
    vorigeBron = bron;
    if (zelfdeBron && document.activeElement === el) return;
    el.value = t;
  });

  return (
    <input ref={el} type="text" inputmode="decimal" data-getal min="0" step="any"
      class="papier-maat-invoer"
      disabled={props.disabled}
      onInput={(e) => props.onInvoer && props.onInvoer(e.target.value)}
      onChange={(e) => props.onWijzig && props.onWijzig(e.target.value)}
      onBlur={() => { if (el) el.value = tekst(); }} />
  );
}

/** Keuzelijst mm / cm / in / pt; wijzigt alleen de weergave en de voorkeur. */
export function PapierEenheidKeuze() {
  const { t } = useTranslation('properties');
  return (
    <select class="papier-eenheid-keuze"
      value={papierEenheid()}
      title={t('sizeUnit.tooltip')}
      aria-label={t('sizeUnit.tooltip')}
      onChange={(e) => kiesPapierEenheid(e.target.value)}>
      {PAPIER_EENHEDEN.map(u => <option value={u}>{u}</option>)}
    </select>
  );
}

/** Vast eenheidslabel, even breed als de keuzelijst zodat de velden uitlijnen. */
export function PapierEenheidLabel() {
  const { t } = useTranslation('properties');
  return <span class="papier-eenheid-label" title={t('sizeUnit.tooltip')}>{papierEenheid()}</span>;
}
