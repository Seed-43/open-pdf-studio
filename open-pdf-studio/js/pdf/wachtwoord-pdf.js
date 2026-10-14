// PDF's met een openingswachtwoord (gebruikerswachtwoord).
//
// PDF.js weigert zo'n bestand met een PasswordException. De app vraagt dan het
// wachtwoord; in de desktop-app maakt Rust (src-tauri/src/beveiligde_pdf.rs)
// een ontsleutelde werkkopie in een eigen tijdelijke map, en het document
// opent uit die kopie, zodat alle renderpaden die op PAD werken (PDFium, de
// worker-processen, tekst, miniaturen) gewoon werken. Het tabblad, de recente
// bestanden en het sessieherstel houden het ORIGINELE pad: na een herstart
// vraagt de app het wachtwoord opnieuw, de werkkopie komt nooit in de sessie.
//
// Zo'n document is alleen-lezen en dat blijft het (anders dan PDF/A, waar
// "Bewerken inschakelen" bestaat): opslaan, opslaan als en bewerken zijn
// uitgeschakeld, het origineel blijft onaangetast en beveiligd.
//
// Puur: geen app-state, geen DOM. De loader, de saver, de tabbladen en de
// sessie gebruiken deze beslissingen; de unit-test toetst ze los.

/** Foutcode van het Rust-commando bij een verkeerd wachtwoord. */
export const FOUT_VERKEERD_WACHTWOORD = 'WRONG_PASSWORD';

// pdf.js PasswordResponses
const PDFJS_WACHTWOORD_NODIG = 1;
const PDFJS_WACHTWOORD_ONJUIST = 2;

/** Weigerde PDF.js het bestand omdat er een wachtwoord nodig is? */
export function isWachtwoordFout(fout) {
  return !!fout && fout.name === 'PasswordException';
}

/** PDF.js kreeg een wachtwoord, maar het klopte niet. */
export function isOnjuistWachtwoordPdfjs(fout) {
  return isWachtwoordFout(fout) && fout.code === PDFJS_WACHTWOORD_ONJUIST;
}

/** PDF.js vraagt (voor het eerst) om een wachtwoord. */
export function isWachtwoordNodigPdfjs(fout) {
  return isWachtwoordFout(fout) && fout.code === PDFJS_WACHTWOORD_NODIG;
}

/**
 * Soort fout van het ontsleutelen. Het Rust-commando geeft een tekst terug
 * (invoke wijst af met een string); een Error mag ook.
 * @returns {'verkeerd-wachtwoord'|'geen-pdfium'|'mislukt'}
 */
export function soortOntsleutelFout(fout) {
  if (isOnjuistWachtwoordPdfjs(fout)) return 'verkeerd-wachtwoord';
  const tekst = String((fout && typeof fout === 'object' ? fout.message : fout) ?? '').trim();
  if (tekst === FOUT_VERKEERD_WACHTWOORD || tekst.startsWith(`${FOUT_VERKEERD_WACHTWOORD}:`)) return 'verkeerd-wachtwoord';
  if (tekst.startsWith('PDFIUM_UNAVAILABLE')) return 'geen-pdfium';
  return 'mislukt';
}

/** Is dit document met een wachtwoord geopend? */
export function isBeveiligdDocument(doc) {
  return !!doc && doc.passwordProtected === true;
}

/**
 * Alleen-lezen: met een wachtwoord geopend (altijd), of PDF/A zolang de
 * gebruiker bewerken niet heeft ingeschakeld.
 */
export function isAlleenLezen(doc) {
  if (!doc) return false;
  if (isBeveiligdDocument(doc)) return true;
  return !!doc.pdfaCompliance && !doc.pdfADismissed;
}

/** Mag dit document niet opgeslagen worden? (PDF/A mag wel.) */
export function opslaanGeweigerd(doc) {
  return isBeveiligdDocument(doc);
}

/**
 * Het pad dat de gebruiker ziet en dat de app onthoudt: het origineel, ook als
 * het document uit een ontsleutelde werkkopie rendert.
 */
export function bronPad(doc) {
  if (!doc) return null;
  return doc.originalFilePath || doc.filePath || null;
}

/** Hoort dit document bij dit pad (werkkopie of origineel)? */
export function hoortBijPad(doc, pad) {
  if (!doc || !pad) return false;
  return doc.filePath === pad || (!!doc.originalFilePath && doc.originalFilePath === pad);
}

/**
 * De bestanden voor het sessieherstel: originele paden, nooit een werkkopie,
 * geen naamloze documenten (die staan in een tijdelijk bestand).
 */
export function sessieBestanden(documenten) {
  return (documenten || [])
    .filter((d) => d && !d.isUntitled && bronPad(d))
    .map((d) => bronPad(d));
}

/**
 * Vraagt het wachtwoord tot het klopt of de gebruiker annuleert.
 *  - `vraag({ verkeerd })` geeft het wachtwoord, of null bij Annuleren;
 *    `verkeerd` is true als de vorige poging niet klopte.
 *  - `ontsleutel(wachtwoord)` geeft het resultaat, of gooit een fout; een
 *    verkeerd wachtwoord (soortOntsleutelFout) leidt tot een nieuwe vraag,
 *    elke andere fout gaat door naar de aanroeper.
 * @returns {Promise<any|null>} het resultaat van ontsleutel, of null
 */
export async function vraagEnOntsleutel({ vraag, ontsleutel }) {
  let verkeerd = false;
  for (;;) {
    const wachtwoord = await vraag({ verkeerd });
    if (wachtwoord === null || wachtwoord === undefined) return null;
    try {
      return await ontsleutel(wachtwoord);
    } catch (fout) {
      if (soortOntsleutelFout(fout) !== 'verkeerd-wachtwoord') throw fout;
      verkeerd = true;
    }
  }
}

/** Zet het document als met een wachtwoord geopend, met zijn originele pad. */
export function markeerBeveiligd(doc, origineelPad) {
  doc.passwordProtected = true;
  doc.originalFilePath = origineelPad || null;
}
