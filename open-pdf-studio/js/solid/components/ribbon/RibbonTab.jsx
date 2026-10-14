import { Show, createRenderEffect } from 'solid-js';

// Eén tabknop van de lint-tabstrook. De bestandsknop opent een menu en is
// daarom geen `tab`; de andere doen mee in de rondgaande tabindex (#551).
// aria-controls wijst naar de inhoud van het tabblad (`#tab-<id>`); die staat
// alleen in de DOM als het tabblad actief is.
export default function RibbonTab(props) {
  const isTab = () => !props.isFileTab;
  const paneelId = () => props.paneelId ?? (props.dataTab ? `tab-${props.dataTab}` : undefined);
  return (
    <button
      type="button"
      class={`ribbon-tab${props.isActive ? ' active' : ''}${props.isFileTab ? ' file-tab' : ''}${props.isContextual ? ' contextual-tab contextual-tabs visible' : ''}${props.extensie ? ' ribbon-ext-tab' : ''}`}
      data-tab={props.dataTab}
      id={props.id}
      role={isTab() ? 'tab' : undefined}
      aria-selected={isTab() ? (props.isActive ? 'true' : 'false') : undefined}
      aria-controls={isTab() && props.isActive ? paneelId() : undefined}
      tabindex={isTab() ? (props.isActive ? 0 : -1) : undefined}
      title={props.title}
      onClick={props.onClick}
    >
      <Show when={props.icon}>
        <span class="ribbon-ext-tab-icon" aria-hidden="true"
          ref={(el) => createRenderEffect(() => { el.innerHTML = props.icon || ''; })} />
      </Show>
      <Show when={props.extensie} fallback={props.label}>
        <span class="ribbon-ext-tab-label">{props.label}</span>
      </Show>
    </button>
  );
}
