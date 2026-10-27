// "Beveiligen met wachtwoord": een beveiligde KOPIE van het geopende document,
// versleuteld volgens de PDF-norm (AES-256) door het Rust-commando
// protect_pdf_file. Het geopende document zelf verandert nooit.

import { getActiveDocument, state } from '../core/state.js';
import { saveFileDialog, invoke } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { standaardDoelPad, doelIsGeopend } from './print-doel.js';
import { STANDAARD_RECHTEN, controleerWachtwoorden, bronVoorBeveiliging, foutMelding } from './protect-pdf-regels.js';
import { opslaanGeweigerd } from './wachtwoord-pdf.js';

export const BEVEILIGD_ACHTERVOEGSEL = ' (protected)';

export { STANDAARD_RECHTEN, controleerWachtwoorden, foutMelding };

/**
 * Schrijft de beveiligde kopie. De kopie komt uit het bestand op schijf, dus
 * een gewijzigd document wordt eerst opgeslagen (na een vraag).
 * @returns {Promise<{ok:true, pad:string}|{ok:false, reden:string, fout?:string}>}
 */
export async function maakBeveiligdeKopie({ gebruiker, eigenaar, rechten }) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return { ok: false, reden: 'geen-document' };
  // Met een wachtwoord geopend: alleen-lezen, ook geen beveiligde kopie
  // (anders opent die kopie met alleen een rechtenwachtwoord zonder wachtwoord).
  if (opslaanGeweigerd(doc)) return { ok: false, reden: 'beveiligd' };

  if (doc.modified || doc.isUntitled || !doc.filePath) {
    const { showConfirm } = await import('../ui/chrome/confirm-dialog.js');
    const eerstOpslaan = await showConfirm({
      title: i18next.t('dialogs:protectPdf.title'),
      message: i18next.t('dialogs:protectPdf.saveFirst'),
    });
    if (!eerstOpslaan) return { ok: false, reden: 'afgebroken' };
    const { savePDF } = await import('./saver.js');
    if (!(await savePDF())) return { ok: false, reden: 'niet-opgeslagen' };
  }
  // Het opgeslagen bestand, niet een werkkopie van een paginabewerking.
  const bron = bronVoorBeveiliging(doc);
  if (!bron) return { ok: false, reden: 'niet-opgeslagen' };

  const doel = await saveFileDialog(standaardDoelPad(doc, null, BEVEILIGD_ACHTERVOEGSEL), [
    { name: 'PDF', extensions: ['pdf'] },
  ]);
  if (!doel) return { ok: false, reden: 'afgebroken' };
  if (doelIsGeopend(doel, state.documents)) return { ok: false, reden: 'doel-is-geopend' };

  // Ondertekend: de kopie wordt opnieuw geschreven, dus haar handtekeningen
  // zijn ongeldig (het origineel blijft ondertekend). Dezelfde vraag als bij
  // "Opslaan als" naar een ander bestand.
  const { bevestigOpslaanMetHandtekeningen } = await import('./handtekeningen/verificatie.js');
  if (!(await bevestigOpslaanMetHandtekeningen(doc, doel))) return { ok: false, reden: 'afgebroken' };

  try {
    await invoke('protect_pdf_file', {
      bron,
      doel,
      gebruikerswachtwoord: gebruiker || '',
      eigenaarwachtwoord: eigenaar || '',
      rechten: { ...STANDAARD_RECHTEN, ...rechten },
    });
  } catch (e) {
    return { ok: false, reden: 'mislukt', fout: String(e?.message ?? e) };
  }
  return { ok: true, pad: doel };
}
