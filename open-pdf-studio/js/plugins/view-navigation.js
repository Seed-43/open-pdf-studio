// Paginanavigatie en annotatieselectie voor plugins (#557).
//
// Een extensie met een eigen lijst (ruimten, objecten) wil vanuit die lijst
// naar de tekening springen: de pagina tonen en het object selecteren, met de
// gewone selectie- en eigenschappenroute van de app. Deze module beslist
// alleen; de host (plugin-api.js) levert de echte navigatie, selectie en het
// in beeld brengen. Zo zijn de regels in node te toetsen.
//
// Uitgangspunten:
//   - Elke aanroep noemt het document waarvoor hij bedoeld is. De identiteit
//     wordt gecontroleerd bij UITVOERING, ook na elke wachtstap: is het
//     document intussen gesloten of is er van tabblad gewisseld, dan wordt er
//     niets geselecteerd in het document dat nu voor staat.
//   - Een nieuwere aanroep van dezelfde plugin wint: een oudere die nog op
//     een paginawissel wacht, selecteert daarna niets meer.
//   - Fouten zijn gestructureerde uitkomsten ({ ok: false, code, message }),
//     geen uitzonderingen. Ongeldige invoer verandert de selectie niet.
//   - Navigeren en selecteren wijzigen geen geometrie, lagen, opgeslagen
//     inhoud of andere tabbladen.

const MAX_IDS = 500;

function fout(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

const isId = (v) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));

/**
 * @param {object} host
 * @param {() => object[]} host.documents            de open documenten
 * @param {() => object|null} host.activeDocument    het document dat voor staat
 * @param {(doc) => number} host.pageCount
 * @param {(doc, page) => Promise<void>} [host.loadPageAnnotations]  annotaties van een pagina inladen
 * @param {(doc, page) => Promise<void>} host.goToPage                het actieve document naar een pagina
 * @param {(doc, ann) => boolean} host.isHidden      niet getekend in de weergave
 * @param {(doc, ann) => boolean} host.isLocked      op een vergrendelde laag
 * @param {() => Promise<void>} [host.prepare]       laadt wat isHidden/isLocked/select/reveal nodig hebben
 * @param {(doc, anns) => void} host.select          gewone selectie + eigenschappenpaneel (synchroon)
 * @param {(doc, anns) => void} [host.reveal]        de omhullende in beeld brengen
 */
export function createViewNavigation(host) {
  let beurt = 0;

  const zoek = (documentId) => (host.documents() || [])
    .find((d) => d && String(d.id) === String(documentId)) || null;

  // De controle bij uitvoering: nog steeds dezelfde, actieve, open versie
  // van het document, en geen nieuwere aanroep die het overneemt.
  function actueel(documentId, mijnBeurt) {
    if (mijnBeurt !== beurt) return fout('superseded', 'A newer navigation request replaced this one');
    if (!zoek(documentId)) return fout('documentClosed', 'The document was closed');
    const actief = host.activeDocument();
    if (!actief || String(actief.id) !== String(documentId)) {
      return fout('documentChanged', 'The active document changed before the request completed');
    }
    return null;
  }

  // Het document vooraf: open en actief.
  function document(documentId) {
    if (!isId(documentId)) return { fout: fout('invalidArgument', 'documentId is required') };
    const doc = zoek(documentId);
    if (!doc) return { fout: fout('documentClosed', 'No open document has this documentId') };
    const actief = host.activeDocument();
    if (!actief || String(actief.id) !== String(doc.id)) {
      return { fout: fout('documentNotActive', 'The document is open but not the active document') };
    }
    return { doc };
  }

  function geldigePagina(doc, page) {
    const aantal = host.pageCount(doc) || 0;
    if (!Number.isInteger(page) || page < 1 || page > aantal) {
      return fout('invalidPage', `Page must be an integer from 1 to ${aantal}`, { pageCount: aantal });
    }
    return null;
  }

  const vind = (doc, id) => (doc.annotations || []).find((a) => a && String(a.id) === String(id)) || null;

  // Zichtbaar en selecteerbaar? Anders een gestructureerde fout.
  function selecteerbaar(doc, anns) {
    const verborgen = anns.filter((a) => host.isHidden(doc, a)).map((a) => a.id);
    if (verborgen.length) return fout('annotationHidden', 'Hidden annotations cannot be selected', { ids: verborgen });
    const vast = anns.filter((a) => host.isLocked(doc, a)).map((a) => a.id);
    if (vast.length) return fout('annotationLocked', 'Annotations on a locked layer cannot be selected', { ids: vast });
    return null;
  }

  // Wat selecteren en in beeld brengen nodig hebben vooraf laden, zodat de
  // laatste controle en de selectie zelf later in één synchrone stap gaan.
  async function voorbereid(mijnBeurt) {
    if (host.prepare) await host.prepare();
    return mijnBeurt === beurt ? null : fout('superseded', 'A newer navigation request replaced this one');
  }

  // Naar de pagina van de annotaties, opnieuw controleren en dan in één
  // synchrone stap selecteren (en eventueel in beeld brengen).
  async function selecteerOpPagina(documentId, doc, ids, focus, mijnBeurt) {
    const anns = ids.map((id) => vind(doc, id));
    const page = anns[0].page ?? 1;
    if (page !== doc.currentPage) {
      await host.goToPage(doc, page);
      const f = actueel(documentId, mijnBeurt);
      if (f) return f;
    }
    // Na het wachten kan het document intussen zijn veranderd (een object
    // verwijderd, een laag vergrendeld): opnieuw opzoeken en toetsen.
    const actief = host.activeDocument();
    const nu = ids.map((id) => vind(actief, id));
    const weg = ids.filter((_, i) => !nu[i]);
    if (weg.length) return fout('annotationNotFound', 'Annotations not found', { missing: weg });
    const f = selecteerbaar(actief, nu);
    if (f) return f;
    host.select(actief, nu);
    if (focus && host.reveal) host.reveal(actief, nu);
    return { ok: true, documentId: actief.id, page, ids: nu.map((a) => a.id) };
  }

  /** De pagina van een open, actief document tonen. */
  async function navigateToPage({ documentId, page } = {}) {
    const mijnBeurt = ++beurt;
    const { doc, fout: f } = document(documentId);
    if (f) return f;
    const pf = geldigePagina(doc, page);
    if (pf) return pf;
    if (page !== doc.currentPage) {
      await host.goToPage(doc, page);
      const af = actueel(documentId, mijnBeurt);
      if (af) return af;
    }
    return { ok: true, documentId: doc.id, page };
  }

  /**
   * Bestaande annotaties selecteren via de gewone selectieroute. Ze moeten
   * op één pagina staan; staat die niet voor, dan gaat de weergave erheen.
   * `focus` brengt hun omhullende in beeld.
   */
  async function selectAnnotations({ documentId, ids, focus = false } = {}) {
    const mijnBeurt = ++beurt;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(isId)) {
      return fout('invalidArgument', `ids must be a non-empty array of at most ${MAX_IDS} annotation ids`);
    }
    const uniek = [...new Set(ids.map(String))];
    const vf = await voorbereid(mijnBeurt);
    if (vf) return vf;
    const { doc, fout: f } = document(documentId);
    if (f) return f;
    const weg = uniek.filter((id) => !vind(doc, id));
    if (weg.length) return fout('annotationNotFound', 'Annotations not found', { missing: weg });
    const anns = uniek.map((id) => vind(doc, id));
    const paginas = [...new Set(anns.map((a) => a.page ?? 1))];
    if (paginas.length > 1) {
      return fout('multiplePages', 'Annotations to select must be on one page', { pages: paginas });
    }
    const sf = selecteerbaar(doc, anns);
    if (sf) return sf;
    return selecteerOpPagina(documentId, doc, uniek, focus === true, mijnBeurt);
  }

  /**
   * Eén annotatie tonen en selecteren, voor de sprong van een lijstregel naar
   * de tekening. Met `page` worden de annotaties van die pagina zo nodig
   * eerst ingeladen (zonder te navigeren), en moet de annotatie daar staan.
   */
  async function focusAnnotation({ documentId, annotationId, page } = {}) {
    const mijnBeurt = ++beurt;
    if (!isId(annotationId)) return fout('invalidArgument', 'annotationId is required');
    const vf = await voorbereid(mijnBeurt);
    if (vf) return vf;
    const { doc, fout: f } = document(documentId);
    if (f) return f;
    if (page !== undefined && page !== null) {
      const pf = geldigePagina(doc, page);
      if (pf) return pf;
      if (!vind(doc, annotationId) && host.loadPageAnnotations) {
        await host.loadPageAnnotations(doc, page);
        const af = actueel(documentId, mijnBeurt);
        if (af) return af;
      }
    }
    const ann = vind(host.activeDocument(), annotationId);
    if (!ann) return fout('annotationNotFound', 'Annotation not found', { missing: [String(annotationId)] });
    if (page !== undefined && page !== null && (ann.page ?? 1) !== page) {
      return fout('pageMismatch', 'The annotation is on another page', { page: ann.page ?? 1 });
    }
    const sf = selecteerbaar(doc, [ann]);
    if (sf) return sf;
    return selecteerOpPagina(documentId, host.activeDocument(), [String(annotationId)], true, mijnBeurt);
  }

  return { navigateToPage, selectAnnotations, focusAnnotation };
}
