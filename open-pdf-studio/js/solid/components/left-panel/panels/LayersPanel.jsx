import { For, Show } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { items, countText, emptyMessage } from '../../../stores/panels/layersStore.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';

// Inspringing per niveau van de lagenboom, in px.
const INSPRINGING = 14;

export default function LayersPanel() {
  const { t } = useTranslation('properties');

  const wissel = (layer, zichtbaar) => {
    import('../../../../ui/panels/layers.js').then((m) => m.toggleLayer(layer.id, zichtbaar));
  };

  return (
    <div class={`left-panel-content${activeTab() === 'layers' ? ' active' : ''}`} id="layers-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.layers')}</span>
      </div>
      <div class="layers-container">
        <Show when={emptyMessage()}>
          <div class="layers-empty">{emptyMessage()}</div>
        </Show>
        <Show when={!emptyMessage()}>
          <For each={items()}>
            {(layer) => (
              <div
                class={`layer-list-item${layer.kop ? ' layer-list-kop' : ''}`}
                style={{ 'margin-left': `${(layer.depth || 0) * INSPRINGING}px` }}
              >
                <Show when={!layer.kop}>
                  {/* Laag aan/uit in de weergave (#684, zie pdf/lagen-schakelen.js). */}
                  <span class="layer-list-toggle">
                    <input
                      type="checkbox"
                      id={`layer-toggle-${layer.id}`}
                      checked={layer.visible}
                      onChange={(e) => wissel(layer, e.currentTarget.checked)}
                    />
                  </span>
                </Show>
                <Show when={layer.kop} fallback={
                  <label class="layer-list-name" for={`layer-toggle-${layer.id}`}>{layer.name}</label>
                }>
                  <span class="layer-list-name">{layer.name}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="layers-count">{countText()}</div>
    </div>
  );
}
