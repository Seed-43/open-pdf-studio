// Android (#596): het antwoord van een plug-in die een andere activiteit
// opent (de bestandskiezer van "Openen", "Opslaan als") bereikt de pagina
// pas bij het volgende IPC-bericht. Op de emulator bleef het kiezen van een
// bestand zo zonder gevolg tot de gebruiker iets anders deed.
//
// Zodra de app weer zichtbaar wordt, sturen we daarom een paar seconden lang
// een klein bericht (de appversie opvragen); dat haalt een wachtend antwoord
// door. Het kost niets als er niets wacht.

/**
 * @param {{ ping: () => void, doc?: Document, win?: Window, duur?: number, interval?: number, nu?: () => number }} opties
 * @returns {() => void} stopt het luisteren
 */
export function startIpcWekker({ ping, doc = document, win = window, duur = 5000, interval = 300, nu = Date.now }) {
  let timer = null;
  let tot = 0;
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tik = () => {
    if (nu() > tot) {
      stopTimer();
      return;
    }
    ping();
  };
  const wek = () => {
    if (doc.visibilityState === 'hidden') return;
    tot = nu() + duur;
    ping();
    if (timer === null) timer = setInterval(tik, interval);
  };
  doc.addEventListener('visibilitychange', wek);
  win.addEventListener('focus', wek);
  return () => {
    doc.removeEventListener('visibilitychange', wek);
    win.removeEventListener('focus', wek);
    stopTimer();
  };
}
