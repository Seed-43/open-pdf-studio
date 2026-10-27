import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);
const [message, setMessage] = createSignal('Loading...');
// Optioneel: voortgang 0..1 (null = alleen de draaiende cirkel) en een
// annuleerfunctie (null = geen knop). Zie showLoading in ui/chrome/dialogs.js.
const [progress, setProgress] = createSignal(null);
const [cancelHandler, setCancelHandler] = createSignal(null);

export {
  visible, setVisible, message, setMessage,
  progress, setProgress, cancelHandler, setCancelHandler,
};
