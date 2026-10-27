// Even de beurt teruggeven aan de browser (#707).
//
// De opstart van de webbouw liep als één taak van zo'n 0,75 tot 1,5 s: eerst
// alle modules, dan het hele venster opbouwen, zonder dat de browser
// ertussen iets kon doen (een "lange taak", die de werkplek als hapering
// meldt). Met een await hierop wordt dat twee taken.
//
// Geen setTimeout: in een tabblad op de achtergrond kan de browser die tot
// een seconde uitstellen. scheduler.yield() waar de browser hem kent, anders
// een MessageChannel (een gewone taak, niet afgeknepen).

/** @returns {Promise<void>} vervult in een volgende taak */
export function volgendeTaak(g = globalThis) {
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof g.MessageChannel === 'function') {
    return new Promise((klaar) => {
      const kanaal = new g.MessageChannel();
      kanaal.port1.onmessage = () => { kanaal.port1.close(); klaar(); };
      kanaal.port2.postMessage(0);
    });
  }
  return new Promise((klaar) => g.setTimeout(klaar, 0));
}
