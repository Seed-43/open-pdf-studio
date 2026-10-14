// Sneltoetsen om tussen documenttabbladen te wisselen (#539).
//
//   Ctrl+Tab        / Ctrl+PageDown  → volgend tabblad
//   Ctrl+Shift+Tab  / Ctrl+PageUp    → vorig tabblad
//
// Met omloop: na het laatste tabblad komt weer het eerste. De volgorde is die
// van de tabbalk: de documenten in hun (versleepbare) volgorde, met het
// vergelijkingstabblad achteraan zolang er een vergelijking open staat.
//
// Gebruikers houden de toets ingedrukt om twee tekeningen razendsnel om en om
// te tonen en zo verschillen te zien. Daarom remt maakTabWisselaar de
// toetsherhaling af: een volgende wissel start pas als de vorige in beeld
// staat, en wat er intussen binnenkomt telt als hoogstens één wachtende
// wissel. Zonder die rem stapelde elke herhaalde toetsaanslag een volledige
// render-keten op.
//
// Dit bestand importeert niets uit de app (geen DOM, geen state), zodat de
// volgorde, de bewaking en de rem in node te testen zijn.

/**
 * Typt de gebruiker in een tekstinvoer? Naast INPUT/TEXTAREA tellen ook
 * contenteditable-editors mee (o.a. de PDF-tekst-editor, die geen textarea
 * meer is). Losse letter-/cijfer-sneltoetsen, spatie en de tabwissel mogen een
 * lopende tekstbewerking nooit onderbreken.
 * @param {any} t  het doel van het toetsenbordevent
 * @returns {boolean}
 */
export function isTextEntryTarget(t) {
  if (!t) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
  if (t.isContentEditable) return true;
  return typeof t.closest === 'function' && !!t.closest('[contenteditable="true"]');
}

/**
 * Welke kant de toetscombinatie het tabblad op stuurt: 1 = volgende,
 * -1 = vorige, 0 = geen tabwissel.
 *
 * Alleen de echte Ctrl-toets (ook op macOS, zoals in browsers); Alt erbij
 * telt niet mee, want AltGr is op Windows Ctrl+Alt. Ctrl+Shift+PageUp/
 * PageDown blijft vrij: dat is elders "tabblad verplaatsen".
 * @param {any} e  toetsenbordevent
 * @returns {-1|0|1}
 */
export function tabSneltoetsRichting(e) {
  if (!e || !e.ctrlKey || e.altKey || e.metaKey) return 0;
  if (e.key === 'Tab') return e.shiftKey ? -1 : 1;
  if (e.shiftKey) return 0;
  if (e.key === 'PageDown') return 1;
  if (e.key === 'PageUp') return -1;
  return 0;
}

/**
 * Mag de sneltoets nu van tabblad wisselen? Niet tijdens typen in een
 * tekstinvoer (zelfde bewaking als de andere sneltoetsen), niet met een open
 * modale dialoog (die werkt op het actieve document) en niet midden in een
 * tekstbewerking of een lopende verplaats-/draai-/bijsnijsessie.
 * @param {any} e
 * @param {{modaalOpen?: boolean, tekstBewerking?: boolean, bezigeSessie?: boolean}} [bewaking]
 * @returns {boolean}
 */
export function tabWisselToegestaan(e, { modaalOpen = false, tekstBewerking = false, bezigeSessie = false } = {}) {
  if (isTextEntryTarget(e?.target)) return false;
  return !modaalOpen && !tekstBewerking && !bezigeSessie;
}

/**
 * Het tabblad waar de sneltoets heen gaat, of null als er niets te wisselen
 * valt (één of geen tabblad, of geen richting).
 * @param {{aantalDocumenten: number, actieveIndex: number, vergelijkActief?: boolean, vergelijkGefocust?: boolean}} tabbladen
 * @param {number} richting  1 = volgende, -1 = vorige
 * @returns {{soort: 'document', index: number} | {soort: 'vergelijk'} | null}
 */
export function volgendTabDoel({ aantalDocumenten, actieveIndex, vergelijkActief = false, vergelijkGefocust = false }, richting) {
  const stap = Math.sign(Number(richting) || 0);
  const aantal = Math.max(0, Number(aantalDocumenten) || 0);
  const totaal = aantal + (vergelijkActief ? 1 : 0);
  if (!stap || totaal < 2) return null;
  let huidig;
  if (vergelijkActief && vergelijkGefocust) huidig = aantal;
  else if (Number.isInteger(actieveIndex) && actieveIndex >= 0 && actieveIndex < aantal) huidig = actieveIndex;
  else huidig = stap > 0 ? -1 : totaal; // geen actief tabblad: begin aan de rand
  const doel = (((huidig + stap) % totaal) + totaal) % totaal;
  return doel === aantal ? { soort: 'vergelijk' } : { soort: 'document', index: doel };
}

/**
 * Voert het doel uit zoals een klik op dat tabblad in de tabbalk: een
 * documenttabblad haalt eerst de vergelijking naar achteren.
 * @param {{soort: string, index?: number} | null} doel
 * @param {{switchToTab: (i: number) => any, focusCompareTab: () => void, blurCompareTab: () => void}} middelen
 * @returns {any} de render-belofte van switchToTab (of undefined)
 */
export function voerTabWisselUit(doel, { switchToTab, focusCompareTab, blurCompareTab }) {
  if (!doel) return undefined;
  if (doel.soort === 'vergelijk') {
    focusCompareTab();
    return undefined;
  }
  blurCompareTab();
  return switchToTab(doel.index);
}

/**
 * Rem op toetsherhaling. `vraag(richting)` voert een wissel direct uit als er
 * niets loopt; loopt er wel een, dan onthoudt hij hoogstens één wachtende
 * wissel (de laatst gevraagde richting). Een wissel is klaar als zijn render
 * klaar is én er daarna een frame getoond is: zo staat elk document minstens
 * één frame in beeld (nodig om verschillen te zien) en zet de sneltoets geen
 * render-ketens naast elkaar in gang — een oude keten die later toch
 * doorloopt, kon zijn tekstlaag onder het verkeerde document hangen.
 *
 * De render van een tabwissel hergebruikt de gecachte bitmap en is meestal in
 * enkele tientallen ms klaar (de tekstlaag is het grootste deel). `maxWachtMs`
 * is alleen een vangnet tegen een hangende render, zodat die de sneltoets niet
 * blijvend vasthoudt.
 * @param {{
 *   wissel: (richting: number) => any,
 *   naBeeld: () => Promise<void>,
 *   wacht: (ms: number) => Promise<void>,
 *   maxWachtMs?: number,
 * }} middelen
 */
export function maakTabWisselaar({ wissel, naBeeld, wacht, maxWachtMs = 2000 }) {
  let bezig = false;
  let wachtend = 0;

  // Een lus en geen recursie: wie de toets een minuut vasthoudt, bouwt zo
  // ook geen keten van openstaande beloftes op.
  async function voerUit(richting) {
    let volgende = richting;
    while (volgende) {
      bezig = true;
      try {
        let render;
        try {
          render = wissel(volgende);
        } catch (err) {
          console.warn('[tab-sneltoets] wisselen mislukt:', err);
        }
        if (render && typeof render.then === 'function') {
          await Promise.race([
            Promise.resolve(render).catch(() => {}),
            wacht(maxWachtMs),
          ]);
        }
        await naBeeld();
      } catch (err) {
        console.warn('[tab-sneltoets] wachten op beeld mislukt:', err);
      } finally {
        bezig = false;
      }
      volgende = wachtend;
      wachtend = 0;
    }
  }

  return {
    /** @returns {boolean} true als de wissel direct is uitgevoerd */
    vraag(richting) {
      const stap = Math.sign(Number(richting) || 0);
      if (!stap) return false;
      if (bezig) {
        wachtend = stap;
        return false;
      }
      voerUit(stap);
      return true;
    },
    get bezig() { return bezig; },
    get wachtend() { return wachtend; },
  };
}

/**
 * De keydown-afhandeling voor de capture-fase op window: daar komt elke
 * toetsaanslag als eerste langs, waar de focus ook staat (canvas, lint,
 * miniaturen), en kan geen component hem met stopPropagation inslikken.
 * Een afgehandelde combinatie krijgt preventDefault (geen standaardactie van
 * de webview) maar loopt verder door, zodat bv. de toetsweergave voor
 * schermopnames hem nog ziet.
 * @param {{wisselaar: {vraag: (r: number) => any}, bewaking: () => object}} middelen
 * @returns {(e: KeyboardEvent) => void}
 */
export function maakTabSneltoetsHandler({ wisselaar, bewaking }) {
  return function handleTabSneltoets(e) {
    const richting = tabSneltoetsRichting(e);
    if (!richting) return;
    if (!tabWisselToegestaan(e, bewaking() || {})) return;
    e.preventDefault();
    wisselaar.vraag(richting);
  };
}
