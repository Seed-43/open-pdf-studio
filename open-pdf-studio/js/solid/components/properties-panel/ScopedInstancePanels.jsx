import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { getActiveDocument } from '../../../core/state.js';
import i18next from '../../../i18n/config.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { onAnySelectionChange } from '../../../plugins/selection-listener-registry.js';
import { instancePanelen, maakPaneelHost } from '../../../plugins/system-instance-panels.js';
import { paneelAfhankelijkheden } from '../../../plugins/system-instance-app.js';
import { getCurrentAnnotation } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

/**
 * Formulieren van extensies voor een geselecteerde systeem-instance (#574),
 * onder de native secties. Alleen bij precies één geselecteerde instance van
 * het actieve document; welke formulieren passen, beslist het register
 * (system-instance-panels.js). Elke selectiewissel, ook verversen,
 * deselecteren en een tabwissel, laat de host opnieuw kijken; bij uitzetten
 * van een extensie verdwijnt haar formulier via het register.
 *
 * De extensie tekent in haar eigen container en zet een werkversie; de host
 * toont Toepassen en Annuleren. Toepassen schrijft met de revisie van de
 * snapshot (één undo-stap); Annuleren laadt de huidige waarden opnieuw.
 */
export default function ScopedInstancePanels() {
  const { t } = useTranslation('properties');
  const { t: tc } = useTranslation('common');
  const host = maakPaneelHost({
    register: instancePanelen,
    snapshotVoor: paneelAfhankelijkheden.snapshotVoor,
    pasToe: paneelAfhankelijkheden.pasToe,
    taal: () => i18next.language || 'en',
  });
  const [sessies, setSessies] = createSignal([]);
  const stopHost = host.abonneer(() => setSessies(host.sessies()));

  let gepland = false;
  const synchroniseer = () => {
    if (gepland) return;
    gepland = true;
    // Na de lopende selectiewissel: dan staan selectie en paneel vast.
    queueMicrotask(() => {
      gepland = false;
      const ann = getCurrentAnnotation();
      const doc = getActiveDocument();
      const enkel = (doc?.selectedAnnotations?.length ?? 0) <= 1;
      const inDocument = !!ann && !!doc && (doc.annotations || []).some((a) => a && a.id === ann.id);
      host.toon(ann?.type === 'systeemraster' && enkel && inDocument
        ? { documentId: doc.id ?? null, annotationId: ann.id }
        : null);
    });
  };
  const stopSelectie = onAnySelectionChange(synchroniseer);
  const stopRegister = instancePanelen.abonneer(synchroniseer);
  synchroniseer();

  onCleanup(() => {
    stopSelectie();
    stopRegister();
    stopHost();
    host.sluit();
  });

  // Op sleutel (een string), zodat een rij en haar container blijven staan
  // zolang de sessie bestaat.
  const sleutels = () => sessies().map((s) => s.sleutel);
  const info = (sleutel) => sessies().find((s) => s.sleutel === sleutel);
  const melding = (m) => (m?.soort === 'stale' ? t('scopedPanel.stale')
    : m?.soort === 'failed' ? t('scopedPanel.failed', { error: m.tekst }) : '');

  return (
    <For each={sleutels()}>
      {(sleutel) => {
        let container;
        onMount(() => host.mount(sleutel, container));
        return (
          <CollapsibleSection title={info(sleutel)?.titel}
            name={`ext:${info(sleutel)?.extensionId}:${info(sleutel)?.panelId}`}>
            <div class="scoped-instance-panel" data-extension={info(sleutel)?.extensionId}
              data-panel={info(sleutel)?.panelId}>
              <div class="scoped-instance-panel-body" ref={container} />
              <Show when={info(sleutel)?.melding}>
                <div class={`scoped-instance-panel-message ${info(sleutel)?.melding?.soort || ''}`}>
                  {melding(info(sleutel)?.melding)}
                </div>
              </Show>
              <div class="scoped-instance-panel-actions">
                <button type="button"
                  disabled={!info(sleutel)?.dirty || info(sleutel)?.bezig || info(sleutel)?.locked}
                  onClick={() => host.pasToe(sleutel)}>{tc('apply')}</button>
                <button type="button"
                  disabled={!info(sleutel)?.dirty || info(sleutel)?.bezig}
                  onClick={() => host.annuleer(sleutel)}>{tc('cancel')}</button>
              </div>
            </div>
          </CollapsibleSection>
        );
      }}
    </For>
  );
}
