// ── De tekstlaag bij een tekstbewerking van bestaande tekst (#719) ──
//
// Na een tekstbewerking zet finishPdfTextEditing de nieuwe tekst in de spans
// van de tekstlaag: zoeken, selecteren en een volgende klik zien dan de
// nieuwe tekst (een klik heropent via dataset.editId hetzelfde record).
// Ongedaan maken zet de originele tekst terug; opnieuw uitvoeren liet de
// laag op de originele tekst staan. Zoeken vond dan de oude tekst, en een
// klik erop begon een tweede bewerking van dezelfde run, waarvoor de saver
// terugviel op het afdekvlak.
//
// Deze helpers vinden de spans van een bewerking en zetten hun tekst. Ze
// hebben geen DOM nodig: een laag met querySelectorAll volstaat.

import { textEditLineAnchor } from './text-edit-appearance.js';

function positie(span) {
  let t = null;
  try { t = JSON.parse(span.dataset?.pdfTransform || 'null'); } catch (_) { t = null; }
  if (!Array.isArray(t) || t.length < 6) return null;
  const x = Number(t[4]);
  const y = Number(t[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const hoek = ((Math.atan2(Number(t[1]) || 0, Number(t[0]) || 0) * 180 / Math.PI) % 360 + 360) % 360;
  return { span, x, y, hoek };
}

function hoekVerschil(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * De spans van de tekstlaag die bij een bewerking horen: per regel van de
 * originele tekst (originalSpanTexts) de spans in leesvolgorde, vanaf het
 * anker van die regel; null als de regel niet te vinden is. Een regel heeft
 * zoveel spans als er originele span-teksten waren.
 */
export function bewerkingSpans(laag, edit) {
  const origineel = Array.isArray(edit?.originalSpanTexts) ? edit.originalSpanTexts : null;
  if (!laag || !origineel) return [];
  const hoek = Number(edit.textAngle) || 0;
  const rad = hoek * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const u = (p) => p.x * cos + p.y * sin;   // langs de leesrichting
  const v = (p) => -p.x * sin + p.y * cos;  // loodrecht erop
  const fs = Number(edit.fontSize) > 0 ? Number(edit.fontSize) : 12;
  const tol = fs * 0.3;
  const ls = Number(edit.lineSpacing) > 0 ? Number(edit.lineSpacing) : fs * 1.2;
  const items = [...laag.querySelectorAll('span[data-pdf-transform]')]
    .filter(sp => !sp.dataset?.synthetic)
    .map(positie)
    .filter(p => p && hoekVerschil(p.hoek, hoek) <= 5);

  return origineel.map((teksten, li) => {
    // Het originele anker van de regel; een verplaatst blok heeft een ander
    // pdfX/pdfY, de spans staan nog op de oude plek.
    const oli = Array.isArray(edit.originalLineInfo) ? edit.originalLineInfo[li] : null;
    const anker = oli && Number.isFinite(Number(oli.x)) && Number.isFinite(Number(oli.y))
      ? { x: Number(oli.x), y: Number(oli.y) }
      : textEditLineAnchor(Number(edit.pdfX) || 0, Number(edit.pdfY) || 0, li, ls, hoek);
    let dichtst = null;
    let afstand = Infinity;
    for (const it of items) {
      const d = Math.abs(v(it) - v(anker));
      if (d < afstand) { afstand = d; dichtst = it; }
    }
    if (!dichtst || afstand > tol * 3) return null;
    const regel = items.filter(it => Math.abs(v(it) - v(dichtst)) <= tol).sort((a, b) => u(a) - u(b));
    let start = 0;
    let beste = Infinity;
    regel.forEach((it, k) => {
      const d = Math.abs(u(it) - u(anker));
      if (d < beste) { beste = d; start = k; }
    });
    const aantal = Array.isArray(teksten) ? teksten.length : 1;
    return regel.slice(start, start + aantal).map(it => it.span);
  });
}

/**
 * De span-teksten na een bewerking, zoals finishPdfTextEditing ze zet: per
 * regel de nieuwe regel in de eerste span (tabs als spatie) en de rest leeg;
 * regels die er niet meer zijn, leeg.
 */
export function spanTekstenNa(edit) {
  const origineel = Array.isArray(edit?.originalSpanTexts) ? edit.originalSpanTexts : [];
  const nieuw = String(edit?.newText ?? '').split('\n');
  const tekst = String(edit?.newText ?? '') === '' ? [] : nieuw;
  return origineel.map((teksten, li) => (Array.isArray(teksten) ? teksten : ['']).map((_, si) => (
    si === 0 && li < tekst.length ? tekst[li].replace(/\t/g, ' ') : ''
  )));
}

const vergelijkbaar = (teksten) => (Array.isArray(teksten) ? teksten.join('') : String(teksten ?? ''))
  .replace(/\s+/g, '');

/**
 * Zet de span-teksten van een bewerking in de tekstlaag.
 * @param {object} laag    de .textLayer (querySelectorAll)
 * @param {object} edit    het tekstbewerkingsrecord
 * @param {string[][]} teksten  per regel de teksten van de spans
 * @param {{editId?: string|null, verwacht?: string[][]}} opties
 *   editId: koppel de spans aan het record (een klik heropent het); null:
 *   koppeling weghalen. verwacht: wat de spans nu moeten tonen; een regel die
 *   iets anders toont (de laag is intussen opnieuw opgebouwd, bv. uit een
 *   opgeslagen bestand) blijft ongemoeid.
 * @returns {number} het aantal regels dat gezet is
 */
export function zetBewerkingInTekstlaag(laag, edit, teksten, { editId, verwacht } = {}) {
  let gezet = 0;
  bewerkingSpans(laag, edit).forEach((spans, li) => {
    if (!spans || spans.length === 0) return;
    if (verwacht && vergelijkbaar(spans.map(sp => sp.textContent)) !== vergelijkbaar(verwacht[li])) return;
    gezet++;
    spans.forEach((sp, si) => {
      const t = teksten?.[li]?.[si];
      if (typeof t === 'string') sp.textContent = t;
      if (typeof editId === 'string') sp.dataset.editId = editId;
      else if (editId === null && sp.dataset.editId === String(edit.id)) delete sp.dataset.editId;
    });
  });
  return gezet;
}

const bestaandeTekst = (edit) => Array.isArray(edit?.originalSpanTexts) && !!edit.originalText;

/**
 * De originele tekst terug in de laag (ongedaan maken van een bewerking).
 * `na`: de span-teksten die de bewerking zette (anders afgeleid).
 */
export function toonOrigineelInTekstlaag(laag, edit, na = null) {
  if (!bestaandeTekst(edit)) return 0;
  return zetBewerkingInTekstlaag(laag, edit, edit.originalSpanTexts,
    { editId: null, verwacht: na || spanTekstenNa(edit) });
}

/**
 * De bewerkte tekst in de laag (opnieuw uitvoeren, herbewerken). `teksten`:
 * de span-teksten die de bewerking bij het bevestigen zette (kolom-
 * segmenten); anders afgeleid uit de nieuwe tekst. `vorige`: de versie die
 * de laag nu toont (een herbewerking: het oude record); zonder: het origineel.
 */
export function toonBewerkingInTekstlaag(laag, edit, { teksten = null, vorige = null } = {}) {
  if (!bestaandeTekst(edit)) return 0;
  return zetBewerkingInTekstlaag(laag, edit, teksten || spanTekstenNa(edit), {
    editId: String(edit.id),
    verwacht: vorige ? spanTekstenNa(vorige) : edit.originalSpanTexts,
  });
}
