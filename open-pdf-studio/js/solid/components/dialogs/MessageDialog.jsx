import { Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function MessageDialog(props) {
  const { t } = useTranslation('common');
  const close = () => closeDialog('message');

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" onClick={close}>{t('ok')}</button>
    </div>
  );

  return (
    <Dialog
      title={props.data?.title || t('appName')}
      overlayClass="message-dialog-overlay"
      dialogClass="message-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="message-dialog-body">
        <p>{props.data?.message || ''}</p>
        {/* Een adres dat hier niet open kan (gast, #695): selecteerbaar, zodat
            de gebruiker het zelf kan kopiëren. */}
        <Show when={props.data?.address}>
          <input
            class="message-dialog-address"
            type="text"
            readOnly
            dir="ltr"
            value={props.data.address}
            onFocus={(e) => e.currentTarget.select()}
          />
        </Show>
      </div>
    </Dialog>
  );
}
