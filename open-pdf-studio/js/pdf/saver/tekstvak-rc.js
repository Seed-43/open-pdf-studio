// Opmaak van een tekstvak in /DS en /RC (#619).
//
// /DS is de standaardstijl van het hele vak (CSS-declaraties), /RC de tekst
// als rich text (XHTML met <p>, <b>, <i> en <span style>, de elementen die de
// PDF-specificatie voor rich text noemt). Onderstreept en doorgehaald gaan in
// beide als text-decoration, zodat een lezer die maar één van de twee leest de
// opmaak toch ziet; de lader leest /RC eerst en valt terug op /DS.

import { hasMixedRuns, textboxLineRuns } from '../../annotations/rendering/textbox-layout.js';

/** 'underline', 'line-through' of beide, of '' zonder decoratie. */
function decoratie(underline, strikethrough) {
  return [underline ? 'underline' : '', strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
}

/** De text-decoration-declaratie voor /DS, of '' zonder decoratie. */
export function dsTekstDecoratie(ann) {
  const d = decoratie(!!ann?.fontUnderline, !!ann?.fontStrikethrough);
  return d ? `text-decoration:${d};` : '';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * /RC voor een tekstvak met opmaak per stuk tekst (vet, cursief, kleur,
 * onderstreept, doorgehaald), of null als alles in de basisstijl staat.
 * @param {object} ann
 * @param {{ fontSize: number, fontFamily: string, color: string }} stijl
 */
export function tekstvakRc(ann, { fontSize, fontFamily, color }) {
  if (!hasMixedRuns(ann)) return null;
  const body = textboxLineRuns(ann).map((line) => '<p>' + (line.map((r) => {
    let h = esc(r.text);
    if (r.italic) h = `<i>${h}</i>`;
    if (r.bold) h = `<b>${h}</b>`;
    const stijl = [];
    const d = decoratie(r.underline, r.strikethrough);
    if (d) stijl.push(`text-decoration:${d}`);
    if (r.color) stijl.push(`color:${r.color}`);
    if (stijl.length) h = `<span style="${stijl.join(';')}">${h}</span>`;
    return h;
  }).join('') || '&#160;') + '</p>').join('');
  return `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="OpenPDFStudio" xfa:spec="2.0.2" style="font:${fontSize}pt ${fontFamily};color:${color}">${body}</body>`;
}
