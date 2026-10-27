// De pdf.js-annotaties van één pagina omzetten naar het model, inclusief de
// koppelingen tussen annotaties onderling.
//
// - Aanhaallijnen van een tekstvak (PolyLine met /IRT en eigen sleutel) gaan
//   als leader aan hun tekstvak, niet als losse annotatie.
// - Review- en markeerstatus (Text + /IRT + /State, #308) wordt de status of
//   `marked` van de doel-annotatie.
// - Antwoorden die de app zelf schreef (Text + /IRT + /OPS_Subtype reply)
//   worden weer `replies` van hun doel-annotatie (#619).
// - Elke andere /IRT-koppeling blijft in het model als `inReplyTo` (id van de
//   doel-annotatie) en `replyType` ('reply' of 'group'), zodat de saver hem
//   terugschrijft (#619). Een vervanging (invoegteken en doorhaling, #508)
//   koppelt resolveGroupLinks daarna op haar eigen manier.
//
// Geen DOM: draait ook in de opslaan-en-heropenen-tests.

import { convertPdfAnnotation } from './annotation-converter.js';
import { statusReplyFromPdfAnnotation, applyStatusReplies } from './status-replies.js';
import { resolveGroupLinks } from './correction-load.js';
import { koppelAntwoorden, eigenAntwoordUitAnnot } from './annotatie-algemeen.js';
import { extraVoorAnnotatie } from './extra-sleutel.js';

/**
 * @returns {Promise<object[]>} de omgezette annotaties, in paginavolgorde
 */
export async function zetPaginaAnnotatiesOm(annots, pageNum, viewport, stampImageMap, annotColorMap) {
  const textboxByRect = new Map();
  const byPdfId = new Map();
  const pendingLeaders = [];
  const pendingStatuses = [];
  const antwoorden = []; // eigen antwoorden (replies), zie koppelAntwoorden
  const koppelingen = []; // overige /IRT-koppelingen
  const groepen = []; // /RT /Group-kinderen, zie resolveGroupLinks
  const nieuw = [];
  for (const annot of annots) {
    const statusReply = statusReplyFromPdfAnnotation(annot);
    if (statusReply) {
      pendingStatuses.push(statusReply);
      continue;
    }
    const antwoord = eigenAntwoordUitAnnot(annot, extraVoorAnnotatie(annotColorMap, annot));
    if (antwoord) {
      antwoorden.push({ ...antwoord, annot });
      continue;
    }
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (!converted) continue;
    if (converted.__textboxLeader) {
      pendingLeaders.push(converted);
      continue;
    }
    if (converted.type === 'textbox' && converted._pdfRectKey) {
      textboxByRect.set(converted._pdfRectKey, converted);
    }
    if (annot.id) byPdfId.set(annot.id, converted);
    if (annot.inReplyTo) {
      koppelingen.push({ converted, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    if (annot.replyType === 'Group' && annot.inReplyTo) {
      groepen.push({ converted, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    nieuw.push(converted);
    // Sommige converters leveren EXTRA annotaties naast de hoofdannotatie
    // (bv. een legacy meerpunts-betonbalk die in losse tweepunts-balken
    // gesplitst wordt). Die worden hier mee-gepusht.
    if (Array.isArray(converted.__extraAnnotations)) {
      for (const extra of converted.__extraAnnotations) nieuw.push(extra);
      delete converted.__extraAnnotations;
    }
  }
  for (const pl of pendingLeaders) {
    const parent = textboxByRect.get(pl.irtRectKey);
    if (parent) {
      if (!Array.isArray(parent.leaders)) parent.leaders = [];
      parent.leaders.push(pl.leader);
    }
  }
  for (const tb of textboxByRect.values()) delete tb._pdfRectKey;
  applyStatusReplies(pendingStatuses, byPdfId);
  // Een antwoord zonder doel op deze pagina blijft een gewone notitie.
  for (const { annot } of koppelAntwoorden(antwoorden, koppelingen, byPdfId)) {
    const notitie = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (notitie) nieuw.push(notitie);
  }
  // Vervangingen (#508): invoegteken + doorhaling, in beide richtingen. Na
  // koppelAntwoorden: deze koppeling wint.
  resolveGroupLinks(groepen, byPdfId);
  return nieuw;
}
