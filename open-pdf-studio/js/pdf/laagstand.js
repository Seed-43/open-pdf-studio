// Lagen (optionele inhoud) aan- en uitzetten in de weergave (#684).
//
// De pagina's tekent PDFium uit het bestand zelf, en PDFium kent geen andere
// laagstand dan de standaardconfiguratie van het document (/OCProperties /D).
// Een laag schakelen gaat daarom via een weergavekopie: het originele bestand
// met één incrementele update erachter die alleen /D vervangt, met
// /BaseState /ON en in /OFF precies de lagen die uit moeten. De rest van het
// bestand blijft byte voor byte gelijk; de kopie is dus snel gemaakt en tekent
// dezelfde pagina's. Rust leidt de renders van het document naar die kopie
// (set_layer_view, zie lagen-schakelen.js); het document zelf, opslaan en het
// pad blijven ongemoeid.
//
// Herschreven wordt het binnenste indirecte object dat /D bevat: /D zelf als
// die een los object is, anders /OCProperties of de catalogus. Het houdt zijn
// objectnummer, dus in een versleuteld document blijven de tekenreeksen erin
// (versleuteld met de sleutel van dat object) geldig. /AS (automatische stand
// per gebruik) valt weg: de keuze van de gebruiker geldt, zoals in pdf.js.
//
// Het vervolg volgt de laatste kruisverwijzing van het bestand: na een
// xref-tabel een tabel met trailer, na een xref-stroom een (ongecomprimeerde)
// xref-stroom.

import { PDFArray, PDFDict, PDFName, PDFRef } from 'pdf-lib';

const N = PDFName.of;
const WEG_UIT_D = new Set(['BaseState', 'ON', 'OFF', 'AS'].map((s) => N(s)));
const latin1 = (tekst) => Uint8Array.from(tekst, (c) => c.charCodeAt(0) & 0xff);

/** Laag-id van pdf.js (`12R`, met generatie `12R3`) naar een objectverwijzing. */
export function laagRef(id) {
  const m = /^(\d+)R(\d*)$/.exec(String(id || ''));
  return m ? { nummer: Number(m[1]), generatie: m[2] ? Number(m[2]) : 0 } : null;
}

/** De positie uit het laatste `startxref` van het bestand, of null. */
export function startxrefVan(bytes) {
  let staart = '';
  for (const b of bytes.subarray(Math.max(0, bytes.length - 2048))) staart += String.fromCharCode(b);
  const treffers = [...staart.matchAll(/startxref\s+(\d+)/g)];
  return treffers.length ? Number(treffers[treffers.length - 1][1]) : null;
}

function tekstVan(bytes, van, lengte) {
  let tekst = '';
  for (const b of bytes.subarray(van, Math.min(bytes.length, van + lengte))) tekst += String.fromCharCode(b);
  return tekst;
}

function zoekBytes(bytes, woord, van) {
  const eerste = woord.charCodeAt(0);
  for (let i = bytes.indexOf(eerste, van); i >= 0; i = bytes.indexOf(eerste, i + 1)) {
    let ok = true;
    for (let j = 1; j < woord.length && ok; j += 1) ok = bytes[i + j] === woord.charCodeAt(j);
    if (ok) return i;
  }
  return -1;
}

/**
 * /Size van de laatste kruisverwijzing: het eerste vrije objectnummer. pdf-lib
 * telt de xref-stromen zelf niet mee in largestObjectNumber, dus die alleen is
 * te laag; een nieuw object met zo'n nummer zou de xref-stroom vervangen.
 */
function grootteVan(bytes, startxref, tabel) {
  let grootte = 0;
  let begin = startxref;
  if (tabel) {
    begin = zoekBytes(bytes, 'trailer', startxref);
    if (begin < 0) return 0;
  }
  const kop = tekstVan(bytes, begin, 4096);
  const nummer = /^\s*(\d+)\s+\d+\s+obj/.exec(kop);
  if (!tabel && nummer) grootte = Number(nummer[1]) + 1;
  const size = /\/Size\s+(\d+)/.exec(kop);
  if (size) grootte = Math.max(grootte, Number(size[1]));
  return grootte;
}

function isXrefTabel(bytes, positie) {
  let i = positie;
  while (i < bytes.length && /\s/.test(String.fromCharCode(bytes[i]))) i += 1;
  return String.fromCharCode(...bytes.subarray(i, i + 4)) === 'xref';
}

/**
 * Leest wat de updates nodig hebben, één keer per stand van de bytes.
 * @param {Uint8Array} bytes  het bestand zoals het op schijf staat
 * @returns {Promise<object|null>} null als het document geen lagen heeft
 */
export async function laagstandBasis(bytes) {
  const startxref = startxrefVan(bytes);
  if (startxref == null) return null;
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const ctx = pdf.context;
  const root = ctx.trailerInfo.Root;
  if (!(root instanceof PDFRef)) return null;

  let houder = { ref: root, dict: ctx.lookupMaybe(root, PDFDict) };
  let pad = [];
  let huidig = houder.dict;
  for (const sleutel of ['OCProperties', 'D']) {
    if (!huidig) return null;
    const waarde = huidig.get(N(sleutel));
    if (waarde instanceof PDFRef) {
      const dict = ctx.lookupMaybe(waarde, PDFDict);
      houder = { ref: waarde, dict };
      pad = [];
      huidig = dict;
    } else if (waarde instanceof PDFDict) {
      pad.push(sleutel);
      huidig = waarde;
    } else {
      return null;
    }
  }
  if (!huidig) return null;

  const xrefTabel = isXrefTabel(bytes, startxref);
  return {
    pdf,
    houder,
    pad,
    startxref,
    xrefTabel,
    grootte: Math.max(ctx.largestObjectNumber + 1, grootteVan(bytes, startxref, xrefTabel)),
    lengte: bytes.length,
  };
}

function kopieZonder(ctx, dict, weg = new Set()) {
  const kopie = ctx.obj({});
  for (const [sleutel, waarde] of dict.entries()) if (!weg.has(sleutel)) kopie.set(sleutel, waarde);
  return kopie;
}

/** Het herschreven houder-object, met de lagen uit `uit` in /OFF. */
function nieuweHouder(basis, uit) {
  const ctx = basis.pdf.context;
  const keten = [basis.houder.dict];
  for (const sleutel of basis.pad) keten.push(keten[keten.length - 1].get(N(sleutel)));

  const d = kopieZonder(ctx, keten[keten.length - 1], WEG_UIT_D);
  d.set(N('BaseState'), N('ON'));
  const refs = [...uit].map(laagRef).filter(Boolean).map((r) => PDFRef.of(r.nummer, r.generatie));
  if (refs.length) d.set(N('OFF'), PDFArray.withContext(ctx));
  for (const ref of refs) d.lookup(N('OFF'), PDFArray).push(ref);

  let binnen = d;
  for (let i = basis.pad.length - 1; i >= 0; i -= 1) {
    const buiten = kopieZonder(ctx, keten[i]);
    buiten.set(N(basis.pad[i]), binnen);
    binnen = buiten;
  }
  return binnen;
}

function trailerVelden(basis, grootte) {
  const t = basis.pdf.context.trailerInfo;
  let velden = `/Size ${grootte} /Root ${t.Root} /Prev ${basis.startxref}`;
  if (t.Info) velden += ` /Info ${t.Info}`;
  if (t.Encrypt) velden += ` /Encrypt ${t.Encrypt}`;
  if (t.ID) velden += ` /ID ${t.ID}`;
  return velden;
}

const tienCijfers = (n) => String(n).padStart(10, '0');
const vijfCijfers = (n) => String(n).padStart(5, '0');

/**
 * De incrementele update die achter het origineel komt.
 * @param {object} basis  uit laagstandBasis
 * @param {Iterable<string>} uit  laag-id's (pdf.js) die uit moeten
 * @returns {Uint8Array}
 */
export function laagstandUpdate(basis, uit) {
  const { nummer: num, generatie: gen } = {
    nummer: basis.houder.ref.objectNumber,
    generatie: basis.houder.ref.generationNumber,
  };
  const delen = [];
  let lengte = basis.lengte;
  const schrijf = (deel) => {
    const b = typeof deel === 'string' ? latin1(deel) : deel;
    delen.push(b);
    lengte += b.length;
  };

  schrijf('\n');
  const objectPositie = lengte;
  schrijf(`${num} ${gen} obj\n${nieuweHouder(basis, uit)}\nendobj\n`);

  if (basis.xrefTabel) {
    const xrefPositie = lengte;
    const grootte = Math.max(basis.grootte, num + 1);
    schrijf(`xref\n${num} 1\n${tienCijfers(objectPositie)} ${vijfCijfers(gen)} n\r\n`);
    schrijf(`trailer\n<< ${trailerVelden(basis, grootte)} >>\nstartxref\n${xrefPositie}\n%%EOF\n`);
  } else {
    // Xref-stroom: het eigen objectnummer komt na het hoogste van het bestand.
    const eigen = Math.max(basis.grootte, num + 1);
    const xrefPositie = lengte;
    const breedte = xrefPositie > 0xffffffff ? 8 : 4;
    const regels = [[num, objectPositie, gen], [eigen, xrefPositie, 0]];
    const data = new Uint8Array(regels.length * (1 + breedte + 2));
    regels.forEach(([, positie, g], r) => {
      const o = r * (1 + breedte + 2);
      data[o] = 1;
      for (let i = 0; i < breedte; i += 1) data[o + 1 + i] = Math.floor(positie / 2 ** (8 * (breedte - 1 - i))) & 0xff;
      data[o + 1 + breedte] = (g >> 8) & 0xff;
      data[o + 2 + breedte] = g & 0xff;
    });
    schrijf(`${eigen} 0 obj\n<< /Type /XRef ${trailerVelden(basis, eigen + 1)} `
      + `/Index [${num} 1 ${eigen} 1] /W [1 ${breedte} 2] /Length ${data.length} >>\nstream\r\n`);
    schrijf(data);
    schrijf(`\r\nendstream\nendobj\nstartxref\n${xrefPositie}\n%%EOF\n`);
  }

  const uitkomst = new Uint8Array(lengte - basis.lengte);
  let o = 0;
  for (const deel of delen) {
    uitkomst.set(deel, o);
    o += deel.length;
  }
  return uitkomst;
}

/** Origineel plus update: de bytes van de weergavekopie. */
export function weergaveBytes(origineel, update) {
  const uit = new Uint8Array(origineel.length + update.length);
  uit.set(origineel, 0);
  uit.set(update, origineel.length);
  return uit;
}

/** De laag-id's die in deze stand uit staan. */
export function uitgezet(config) {
  return [...config].filter(([, groep]) => groep && groep.visible === false).map(([id]) => id);
}

/** Is de stand gelijk aan de beginstand van het document? */
export function isBeginstand(config, begin) {
  const a = new Set(uitgezet(config));
  const b = new Set(uitgezet(begin));
  return a.size === b.size && [...a].every((id) => b.has(id));
}
