// Alles vlakken en alles terughalen (#615) — de omzetting van het PDF-document
// zelf, zonder app-imports (alleen pdf-lib), zodat ze los te testen is.
//
// Vlakken: per pagina gaat de normale appearance (/AP /N) van elke markering
// als Form XObject de pagina-inhoud in, binnen een gemarkeerd blok
// (/OPSFlatten BMC … EMC) in een eigen inhoudsstroom die het kenmerk van deze
// vlak-partij draagt. De markering gaat uit /Annots. Elke lezer toont het
// resultaat dan als gewone pagina-inhoud. Een markering zonder appearance
// (een notitie, een meethulp van de app) of een verborgen markering heeft
// niets om te tekenen: die blijft gewoon een markering.
//
// Herstel (optioneel, standaard aan): een verliesvrije kopie van het
// app-model van de markeringen gaat als JSON-stroom in de catalogus
// (/OPS_Flatten), per partij. Terughalen haalt alleen de inhoudsstromen weg
// van de partijen die in die kopie staan; een partij die zonder herstel is
// gevlakt, is gewone pagina-inhoud geworden en blijft staan. Een tweede keer
// vlakken breidt de kopie uit in plaats van haar te vervangen.

import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFStream, PDFRawStream, PDFRef, PDFString,
  PDFHexString, PDFNumber, decodePDFRawStream,
} from 'pdf-lib';

/** Catalogussleutel van de herstelkopie (een JSON-stroom). */
export const FLATTEN_SLEUTEL = 'OPS_Flatten';
/** Op een gevlakte inhoudsstroom: het kenmerk van de partij (tekst). */
export const BATCH_SLEUTEL = 'OPS_FlattenBatch';
/** Op een gevlakte inhoudsstroom: het paginanummer bij het vlakken. */
export const PAGINA_SLEUTEL = 'OPS_FlattenPage';
/** Op een gevlakte inhoudsstroom: de XObject-namen die hij in de resources zette. */
export const NAMEN_SLEUTEL = 'OPS_FlattenNames';
/** Op een gevlakte inhoudsstroom: de /Properties-namen (lagen) die hij zette. */
export const OC_NAMEN_SLEUTEL = 'OPS_FlattenOC';
/** Op de herstelkopie: de vectorknipsel-sleutels waarvan de bron moet blijven. */
export const KNIPSEL_SLEUTELS = 'OPS_SnippetKeys';
/** Tag van het gemarkeerde blok in de pagina-inhoud. */
export const FLATTEN_TAG = 'OPSFlatten';
/**
 * Tijdelijk, alleen in het geheugen: de id van de model-annotatie waaruit de
 * saver een annotatie schreef (saver.js, bouwAnnotatieDocument). Vlakken haalt
 * hem weer weg.
 */
export const MODEL_ID_SLEUTEL = 'OPS_FlattenModelId';

const SNAPSHOT_VERSIE = 1;
const N = (s) => PDFName.of(s);

// Nooit vlakken: formuliervelden (het formulier moet blijven werken) en
// koppelingen (geen uiterlijk, wel gedrag).
const NOOIT = new Set(['/Widget', '/Link']);

/** Een nieuw partij-kenmerk. */
export function nieuwBatchId() {
  return `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * De herstelkopie als JSON. Functies en schermobjecten (een gecachet beeld,
 * een DOM-knoop) gaan niet mee; al het andere wel, zoals bij
 * cloneAnnotation().
 */
export function snapshotJson(snapshot) {
  return JSON.stringify(snapshot, (sleutel, waarde) => {
    if (typeof waarde === 'function') return undefined;
    if (sleutel === '_cachedImg') return undefined;
    if (waarde && typeof waarde === 'object' && typeof waarde.nodeType === 'number') return undefined;
    return waarde;
  });
}

function getallen(context, obj) {
  const arr = context.lookup(obj);
  if (!(arr instanceof PDFArray)) return null;
  const uit = arr.asArray().map((v) => {
    const n = context.lookup(v);
    return n instanceof PDFNumber ? n.asNumber() : NaN;
  });
  return uit.every(Number.isFinite) ? uit : null;
}

function normRect(r) {
  const [a, b, c, d] = r;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

const rond = (v) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * De matrix die de appearance op de Rect zet (PDF 32000-1, 12.5.5): de BBox,
 * door de /Matrix van de appearance getransformeerd, geeft een omhullende;
 * die wordt op de Rect geschaald en geschoven. De /Matrix zelf past `Do`
 * toe, dus die zit niet in deze matrix.
 * @returns {number[]} [a, b, c, d, e, f]
 */
export function bakMatrix(bbox, matrix, rect) {
  const [bx1, by1, bx2, by2] = normRect(bbox);
  const m = Array.isArray(matrix) && matrix.length === 6 ? matrix : [1, 0, 0, 1, 0, 0];
  const pt = ([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const hoeken = [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]].map(pt);
  const xs = hoeken.map((p) => p[0]);
  const ys = hoeken.map((p) => p[1]);
  const tx1 = Math.min(...xs); const tx2 = Math.max(...xs);
  const ty1 = Math.min(...ys); const ty2 = Math.max(...ys);
  const [rx1, ry1, rx2, ry2] = normRect(rect);
  const sx = tx2 - tx1 > 1e-9 ? (rx2 - rx1) / (tx2 - tx1) : 1;
  const sy = ty2 - ty1 > 1e-9 ? (ry2 - ry1) / (ty2 - ty1) : 1;
  return [sx, 0, 0, sy, rx1 - sx * tx1, ry1 - sy * ty1].map(rond);
}

const fmt = (v) => {
  const s = String(rond(v));
  return s.includes('e') ? rond(v).toFixed(6) : s;
};

function tekstVan(context, obj) {
  const v = context.lookup(obj);
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  if (v instanceof PDFName) return v.decodeText();
  return null;
}

function stroomBytes(stroom) {
  if (stroom instanceof PDFRawStream) return decodePDFRawStream(stroom).decode();
  if (typeof stroom?.getUnencodedContents === 'function') return stroom.getUnencodedContents();
  return stroom?.getContents?.() || new Uint8Array();
}

/**
 * De herstelkopie uit de catalogus, of null (geen of onleesbaar).
 * @returns {{version:number, batches:{id:string, savedAt:string, annotations:object[]}[]}|null}
 */
export function leesFlattenSnapshot(pdfDoc) {
  const stroom = pdfDoc.context.lookup(pdfDoc.catalog.get(N(FLATTEN_SLEUTEL)));
  if (!(stroom instanceof PDFStream)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(stroomBytes(stroom)));
    if (!data || !Array.isArray(data.batches)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * De vectorknipsel-sleutels die de herstelkopie nodig heeft. De saver ruimt
 * knipselbronnen op waar geen stempel meer naar verwijst; zonder deze lijst
 * zou een gevlakt knipsel na terughalen zijn bron kwijt zijn.
 * @returns {Set<string>}
 */
export function flattenKnipselSleutels(pdfDoc) {
  const uit = new Set();
  const context = pdfDoc.context;
  const stroom = context.lookup(pdfDoc.catalog.get(N(FLATTEN_SLEUTEL)));
  if (!(stroom instanceof PDFStream)) return uit;
  const lijst = context.lookup(stroom.dict.get(N(KNIPSEL_SLEUTELS)));
  if (!(lijst instanceof PDFArray)) return uit;
  for (const v of lijst.asArray()) {
    const t = tekstVan(context, v);
    if (t) uit.add(t);
  }
  return uit;
}

/** Alle indirecte objecten die vanaf `starts` bereikbaar zijn, op tag. */
function bereikbaar(context, starts) {
  const gezien = new Map();
  const stapel = [...starts];
  while (stapel.length) {
    let o = stapel.pop();
    if (o instanceof PDFRef) {
      if (gezien.has(o.tag)) continue;
      gezien.set(o.tag, o);
      o = context.lookup(o);
      if (!o) continue;
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stapel.push(v);
    else if (o instanceof PDFArray) for (const v of o.asArray()) stapel.push(v);
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stapel.push(v);
  }
  return gezien;
}

/** Wat vanaf `kandidaten` bereikbaar is maar niet meer vanaf de trailer: weg. */
function ruimOp(context, kandidaten) {
  if (!kandidaten.length) return 0;
  const t = context.trailerInfo;
  const levend = bereikbaar(context, [t.Root, t.Info, t.Encrypt, t.ID].filter(Boolean));
  let weg = 0;
  for (const [tag, ref] of bereikbaar(context, kandidaten)) {
    if (levend.has(tag)) continue;
    if (context.delete(ref)) weg++;
  }
  return weg;
}

/**
 * Alles wat niet meer vanaf de trailer bereikbaar is, uit het document. pdf-lib
 * schrijft onbereikbare objecten gewoon mee; zonder opruimen draagt een
 * gevlakt bestand de oude annotaties en appearances als ballast mee. Eerst
 * `await pdfDoc.flush()`, zodat ingebedde lettertypen en beelden echt in het
 * document staan.
 * @returns {number} het aantal verwijderde objecten
 */
export function ruimOnbereikbaarOp(pdfDoc) {
  const context = pdfDoc.context;
  return ruimOp(context, context.enumerateIndirectObjects().map(([ref]) => ref));
}

/** De appearance die getekend wordt: /N, of bij toestanden de toestand van /AS. */
function normaleAppearance(context, dict) {
  const ap = context.lookup(dict.get(N('AP')));
  if (!(ap instanceof PDFDict)) return { soort: 'geen' };
  const nRaw = ap.get(N('N'));
  const n = context.lookup(nRaw);
  if (n instanceof PDFStream) return { soort: 'stroom', ref: nRaw, stroom: n };
  if (n instanceof PDFDict) {
    const as = context.lookup(dict.get(N('AS')));
    if (as instanceof PDFName) {
      const sRaw = n.get(as);
      const s = context.lookup(sRaw);
      if (s instanceof PDFStream) return { soort: 'stroom', ref: sRaw, stroom: s };
    }
    return { soort: 'toestanden' };
  }
  return { soort: 'geen' };
}

function uniekeNaam(dict, basis) {
  const bestaand = new Set(dict.keys().map((k) => k.asString()));
  for (let i = 1; ; i++) {
    const naam = `${basis}${i}`;
    if (!bestaand.has(`/${naam}`)) return naam;
  }
}

/**
 * Vlak de markeringen van het document, in het document zelf.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {object} [opties]
 * @param {object[]} [opties.annotaties] het app-model van wat gevlakt wordt (voor de herstelkopie)
 * @param {boolean} [opties.herstelbaar=true] herstelkopie meeschrijven
 * @param {string} [opties.batchId]
 * @param {(ref: PDFRef, dict: PDFDict, subtype: string) => boolean} [opties.isTeVlakken]
 *   welke /Annots-ingangen vlakken; standaard alles behalve formuliervelden,
 *   koppelingen en pop-ups. Formuliervelden en koppelingen nooit.
 * @param {Date} [opties.nu]
 * @returns {{batchId:string, gebakken:number, verborgen:number, zonderUiterlijk:number,
 *   overgeslagen:number, paginas:number[], gebakkenIds:string[]}}
 *   `verborgen`, `zonderUiterlijk` en `overgeslagen` blijven annotatie. In de
 *   herstelkopie komen de `annotaties` waarvan de annotatie gebakken is
 *   (herkend aan MODEL_ID_SLEUTEL); draagt geen enkele annotatie die sleutel,
 *   dan alle `annotaties`.
 */
export function vlakDocument(pdfDoc, {
  annotaties = [], herstelbaar = true, batchId = nieuwBatchId(), isTeVlakken = null, nu = new Date(),
} = {}) {
  const context = pdfDoc.context;
  const teVlakken = isTeVlakken || ((_ref, _dict, subtype) => subtype !== '/Popup');
  const uitkomst = { batchId, gebakken: 0, verborgen: 0, zonderUiterlijk: 0, overgeslagen: 0, paginas: [], gebakkenIds: [] };
  const weg = [];
  let idsGezien = false;

  pdfDoc.getPages().forEach((pagina, index) => {
    const lijst = pagina.node.lookup(N('Annots'));
    if (!(lijst instanceof PDFArray) || lijst.size() === 0) return;
    const blijft = [];
    const verwijderd = new Set();
    const reden = new Map(); // ref -> teller waarin hij meetelt als hij blijft
    const ops = [];
    const xNamen = [];
    const ocNamen = [];

    for (const ref of lijst.asArray()) {
      const dict = context.lookup(ref);
      const subtype = dict instanceof PDFDict ? dict.get(N('Subtype'))?.toString() : null;
      if (!subtype || NOOIT.has(subtype) || !teVlakken(ref, dict, subtype)) {
        blijft.push(ref);
        continue;
      }
      // Een pop-up gaat alleen mee met zijn markering (hieronder).
      if (subtype === '/Popup') { blijft.push(ref); continue; }
      const modelId = tekstVan(context, dict.get(N(MODEL_ID_SLEUTEL)));
      if (modelId !== null) { idsGezien = true; dict.delete(N(MODEL_ID_SLEUTEL)); }
      const vlag = context.lookup(dict.get(N('F')));
      const f = vlag instanceof PDFNumber ? vlag.asNumber() : 0;
      if ((f & 2) || (f & 32)) { // Hidden of NoView: niets te tekenen
        uitkomst.verborgen++;
        reden.set(ref, 'verborgen');
        blijft.push(ref);
        continue;
      }
      const ap = normaleAppearance(context, dict);
      if (ap.soort === 'toestanden') { // geen /AS: niet te kiezen wat er staat
        uitkomst.overgeslagen++;
        reden.set(ref, 'overgeslagen');
        blijft.push(ref);
        continue;
      }
      const rect = getallen(context, dict.get(N('Rect')));
      if (ap.soort === 'geen' || !rect) {
        uitkomst.zonderUiterlijk++;
        reden.set(ref, 'zonderUiterlijk');
        blijft.push(ref);
        continue;
      }
      const bbox = getallen(context, ap.stroom.dict.get(N('BBox'))) || rect;
      const matrix = getallen(context, ap.stroom.dict.get(N('Matrix')));
      const m = bakMatrix(bbox, matrix, rect);
      const xRef = ap.ref instanceof PDFRef ? ap.ref : context.register(ap.stroom);
      const naam = pagina.node.newXObject('OPSFlat', xRef);
      xNamen.push(naam);
      const teken = `q ${m.map(fmt).join(' ')} cm ${naam.toString()} Do Q`;
      // Een markering op een annotatielaag houdt haar laag (#468).
      const oc = dict.get(N('OC'));
      if (oc) {
        const { Resources } = pagina.node.normalizedEntries();
        let props = Resources.lookupMaybe(N('Properties'), PDFDict);
        if (!props) { props = context.obj({}); Resources.set(N('Properties'), props); }
        const ocNaam = uniekeNaam(props, 'OPSOC');
        props.set(N(ocNaam), oc);
        ocNamen.push(N(ocNaam));
        ops.push(`/OC /${ocNaam} BDC ${teken} EMC`);
      } else {
        ops.push(teken);
      }
      uitkomst.gebakken++;
      if (modelId !== null) uitkomst.gebakkenIds.push(modelId);
      verwijderd.add(ref);
    }

    // De pop-up van een gebakken markering gaat mee, en zo ook haar
    // antwoorden en review-status (/IRT): die staan in het model van de
    // markering, dus in de herstelkopie.
    let rest = blijft;
    for (let veranderd = true; veranderd;) {
      veranderd = false;
      rest = rest.filter((ref) => {
        const d = context.lookup(ref);
        if (!(d instanceof PDFDict)) return true;
        const subtype = d.get(N('Subtype'))?.toString();
        const ouder = subtype === '/Popup' ? d.get(N('Parent')) : d.get(N('IRT'));
        if (!(ouder instanceof PDFRef) || !verwijderd.has(ouder)) return true;
        if (subtype !== '/Popup' && (NOOIT.has(subtype) || !teVlakken(ref, d, subtype))) return true;
        verwijderd.add(ref);
        if (reden.has(ref)) uitkomst[reden.get(ref)]--;
        veranderd = true;
        return false;
      });
    }

    if (verwijderd.size === 0) return;
    pagina.node.set(N('Annots'), context.obj(rest));
    weg.push(...verwijderd);
    if (!ops.length) return;
    const inhoud = `/${FLATTEN_TAG} BMC\n${ops.join('\n')}\nEMC\n`;
    const stroom = context.flateStream(new TextEncoder().encode(inhoud), {
      [BATCH_SLEUTEL]: PDFString.of(batchId),
      [PAGINA_SLEUTEL]: index + 1,
      [NAMEN_SLEUTEL]: xNamen,
      ...(ocNamen.length ? { [OC_NAMEN_SLEUTEL]: ocNamen } : {}),
    });
    pagina.node.addContentStream(context.register(stroom));
    uitkomst.paginas.push(index + 1);
  });

  // Herstelkopie: een bestaande uitbreiden, nooit vervangen. Zonder herstel
  // blijft een eerdere kopie (van eerdere, herstelbare partijen) staan.
  if (herstelbaar) {
    const oud = leesFlattenSnapshot(pdfDoc);
    const batches = oud ? [...oud.batches] : [];
    const gebakken = new Set(uitkomst.gebakkenIds);
    const herstel = idsGezien ? annotaties.filter((a) => gebakken.has(String(a?.id))) : annotaties;
    batches.push({ id: batchId, savedAt: nu.toISOString(), annotations: herstel });
    schrijfSnapshot(pdfDoc, { version: SNAPSHOT_VERSIE, batches });
  }
  ruimOp(context, weg);
  return uitkomst;
}

function schrijfSnapshot(pdfDoc, snapshot) {
  const context = pdfDoc.context;
  const oudRef = pdfDoc.catalog.get(N(FLATTEN_SLEUTEL));
  const sleutels = new Set();
  for (const b of snapshot.batches) {
    for (const a of b.annotations || []) {
      if (a && typeof a.snippetKey === 'string' && a.snippetKey) sleutels.add(a.snippetKey);
    }
  }
  const stroom = context.flateStream(new TextEncoder().encode(snapshotJson(snapshot)), {
    OPS_Format: PDFString.of('application/json'),
    ...(sleutels.size ? { [KNIPSEL_SLEUTELS]: [...sleutels].map((s) => PDFString.of(s)) } : {}),
  });
  pdfDoc.catalog.set(N(FLATTEN_SLEUTEL), context.register(stroom));
  if (oudRef instanceof PDFRef) ruimOp(context, [oudRef]);
}

/**
 * Haal de herstelbare partijen terug: hun inhoudsstromen en resources weg,
 * de herstelkopie weg, en het model terug.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {{snapshot: object|null, verwijderd:number, gevonden:number,
 *   annotaties: object[], verloren:number}}
 *   `gevonden` telt alle gevlakte blokken (ook die van onherstelbare partijen):
 *   zo is "nooit gevlakt" te onderscheiden van "gevlakt zonder herstel".
 */
export function ontvlakDocument(pdfDoc) {
  const context = pdfDoc.context;
  const snapshot = leesFlattenSnapshot(pdfDoc);
  const ids = new Set((snapshot?.batches || []).map((b) => b.id));
  const plaats = new Map(); // `${partij}|${pagina bij vlakken}` -> pagina nu
  const weg = [];
  let gevonden = 0;
  let verwijderd = 0;
  const paginas = pdfDoc.getPages();

  paginas.forEach((pagina, index) => {
    const inhoud = pagina.node.lookup(N('Contents'));
    if (!(inhoud instanceof PDFArray)) {
      if (inhoud instanceof PDFStream && inhoud.dict.get(N(BATCH_SLEUTEL))) gevonden++;
      return;
    }
    for (let i = inhoud.size() - 1; i >= 0; i--) {
      const ref = inhoud.get(i);
      const s = context.lookup(ref);
      if (!(s instanceof PDFStream)) continue;
      const partij = tekstVan(context, s.dict.get(N(BATCH_SLEUTEL)));
      if (partij === null) continue;
      gevonden++;
      if (!ids.has(partij)) continue;
      const oorspronkelijk = context.lookup(s.dict.get(N(PAGINA_SLEUTEL)));
      if (oorspronkelijk instanceof PDFNumber) plaats.set(`${partij}|${oorspronkelijk.asNumber()}`, index + 1);
      const res = pagina.node.Resources();
      const xo = res?.lookupMaybe(N('XObject'), PDFDict);
      const namen = context.lookup(s.dict.get(N(NAMEN_SLEUTEL)));
      if (xo && namen instanceof PDFArray) {
        for (const n of namen.asArray()) {
          if (!(n instanceof PDFName)) continue;
          const doel = xo.get(n);
          if (doel instanceof PDFRef) weg.push(doel);
          xo.delete(n);
        }
      }
      const props = res?.lookupMaybe(N('Properties'), PDFDict);
      const ocNamen = context.lookup(s.dict.get(N(OC_NAMEN_SLEUTEL)));
      if (props && ocNamen instanceof PDFArray) {
        for (const n of ocNamen.asArray()) if (n instanceof PDFName) props.delete(n);
      }
      inhoud.remove(i);
      if (ref instanceof PDFRef) weg.push(ref);
      verwijderd++;
    }
  });

  const annotaties = [];
  let verloren = 0;
  for (const b of snapshot?.batches || []) {
    for (const a of b.annotations || []) {
      if (!a || typeof a !== 'object') continue;
      const nu = plaats.get(`${b.id}|${a.page}`);
      const pagina = nu ?? (a.page >= 1 && a.page <= paginas.length ? a.page : null);
      if (pagina === null) { verloren++; continue; }
      annotaties.push(pagina === a.page ? a : { ...a, page: pagina });
    }
  }
  if (snapshot) {
    const ref = pdfDoc.catalog.get(N(FLATTEN_SLEUTEL));
    pdfDoc.catalog.delete(N(FLATTEN_SLEUTEL));
    if (ref instanceof PDFRef) weg.push(ref);
  }
  ruimOp(context, weg);
  return { snapshot, verwijderd, gevonden, annotaties, verloren };
}

/** vlakDocument op bytes: geeft de nieuwe bytes plus de uitkomst. */
export async function flattenBytes(bytes, opties = {}) {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const uitkomst = vlakDocument(pdfDoc, opties);
  return { ...uitkomst, bytes: new Uint8Array(await pdfDoc.save()) };
}

/** ontvlakDocument op bytes: geeft de nieuwe bytes plus de uitkomst. */
export async function unflattenBytes(bytes) {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const uitkomst = ontvlakDocument(pdfDoc);
  return { ...uitkomst, bytes: new Uint8Array(await pdfDoc.save()) };
}
