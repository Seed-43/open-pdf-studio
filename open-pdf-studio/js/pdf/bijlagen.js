// Bijlagen: bestanden die in de PDF zijn ingesloten (/Names /EmbeddedFiles).
//
// Toevoegen en verwijderen in het bijlagenpaneel verandert het geopende
// document niet meteen. De wijzigingen staan op het document
// (`doc.bijlagenWijzigingen`) en de saver schrijft ze bij elke save in het
// bestand (pasBijlagenToe). Toepassen is herhaalbaar: een toegevoegde bijlage
// vervangt een bestaande met dezelfde naam, en een verwijderde naam die er
// niet (meer) is wordt overgeslagen. Een tweede save, die voortbouwt op het
// zojuist opgeslagen bestand, past dezelfde wijzigingen dus nogmaals toe
// zonder iets te verdubbelen — de wijzigingen hoeven na een save niet weg.
//
// Puur pdf-lib, geen app-imports: zo is het in node te testen.

import { PDFName, PDFDict, PDFArray, PDFStream, PDFRef, PDFString, PDFHexString } from 'pdf-lib';

/** @typedef {{ naam: string, bytes: Uint8Array, mime?: string, beschrijving?: string,
 *              aangemaakt?: string, gewijzigd?: string }} Bijlage */
/** @typedef {{ toegevoegd: Bijlage[], verwijderd: string[] }} BijlagenWijzigingen */

/** De wijzigingen van een document als nieuw object (nooit het origineel muteren). */
export function wijzigingenVan(doc) {
  const w = doc?.bijlagenWijzigingen;
  return {
    toegevoegd: Array.isArray(w?.toegevoegd) ? [...w.toegevoegd] : [],
    verwijderd: Array.isArray(w?.verwijderd) ? [...w.verwijderd] : [],
  };
}

/** Een naam die nog niet in gebruik is: 'plan.pdf' wordt 'plan (2).pdf'. */
export function vrijeNaam(gewenst, inGebruik) {
  const bezet = new Set(inGebruik);
  const naam = String(gewenst || '').trim() || 'bijlage';
  if (!bezet.has(naam)) return naam;
  const punt = naam.lastIndexOf('.');
  const stam = punt > 0 ? naam.slice(0, punt) : naam;
  const ext = punt > 0 ? naam.slice(punt) : '';
  for (let n = 2; ; n++) {
    const kandidaat = `${stam} (${n})${ext}`;
    if (!bezet.has(kandidaat)) return kandidaat;
  }
}

/** Wijzigingen na het toevoegen van `bijlage` (een gelijknamige vervalt). */
export function metToegevoegd(wijzigingen, bijlage) {
  return {
    toegevoegd: [...wijzigingen.toegevoegd.filter((b) => b.naam !== bijlage.naam), bijlage],
    verwijderd: wijzigingen.verwijderd.filter((n) => n !== bijlage.naam),
  };
}

/**
 * Wijzigingen na het verwijderen van `naam`. Ook een net toegevoegde naam komt
 * in de verwijderlijst: die kan al in een eerder opgeslagen versie staan.
 */
export function metVerwijderd(wijzigingen, naam) {
  return {
    toegevoegd: wijzigingen.toegevoegd.filter((b) => b.naam !== naam),
    verwijderd: wijzigingen.verwijderd.includes(naam) ? [...wijzigingen.verwijderd] : [...wijzigingen.verwijderd, naam],
  };
}

/**
 * De bijlagen zoals het paneel ze toont: die uit het geopende bestand, zonder
 * de verwijderde en vervangen, plus de toegevoegde.
 * @param {{naam:string}[]} basis
 * @param {BijlagenWijzigingen} wijzigingen
 */
export function zichtbareBijlagen(basis, wijzigingen) {
  const weg = new Set([...wijzigingen.verwijderd, ...wijzigingen.toegevoegd.map((b) => b.naam)]);
  return [
    ...basis.filter((b) => !weg.has(b.naam)),
    ...wijzigingen.toegevoegd.map((b) => ({ ...b, nieuw: true })),
  ];
}

function tekstVan(obj) {
  if (obj instanceof PDFHexString || obj instanceof PDFString) {
    try { return obj.decodeText(); } catch { return null; }
  }
  return null;
}

/**
 * Alle [sleutel, waarde]-paren van een naamboom, ook verdeeld over /Kids.
 * `knoopRefs` verzamelt de indirecte knopen onder de wortel.
 */
function bladen(context, knoop, uit = [], gezien = new Set(), knoopRefs = []) {
  if (!(knoop instanceof PDFDict) || gezien.has(knoop)) return uit;
  gezien.add(knoop);
  const namen = knoop.lookup(PDFName.of('Names'));
  if (namen instanceof PDFArray) {
    for (let i = 0; i + 1 < namen.size(); i += 2) uit.push([context.lookup(namen.get(i)), namen.get(i + 1)]);
  }
  const kids = knoop.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      if (kids.get(i) instanceof PDFRef) knoopRefs.push(kids.get(i));
      bladen(context, kids.lookup(i), uit, gezien, knoopRefs);
    }
  }
  return uit;
}

function embeddedFiles(pdfDoc) {
  const names = pdfDoc.catalog.lookup(PDFName.of('Names'));
  const ef = names instanceof PDFDict ? names.lookup(PDFName.of('EmbeddedFiles')) : undefined;
  return { names: names instanceof PDFDict ? names : null, ef: ef instanceof PDFDict ? ef : null };
}

/** De namen van de ingesloten bestanden, in de volgorde van de naamboom. */
export function leesBijlageNamen(pdfDoc) {
  const { ef } = embeddedFiles(pdfDoc);
  return ef ? bladen(pdfDoc.context, ef).map(([sleutel]) => tekstVan(sleutel)).filter((n) => n !== null) : [];
}

function maakBestandsspecificatie(pdfDoc, bijlage) {
  const { context } = pdfDoc;
  const params = { Size: bijlage.bytes.length };
  const datum = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? PDFString.fromDate(d) : undefined; };
  params.CreationDate = datum(bijlage.aangemaakt);
  params.ModDate = datum(bijlage.gewijzigd);
  const stroom = context.register(context.flateStream(bijlage.bytes, {
    Type: 'EmbeddedFile',
    Subtype: bijlage.mime || undefined,
    Params: params,
  }));
  return context.register(context.obj({
    Type: 'Filespec',
    F: PDFHexString.fromText(bijlage.naam),
    UF: PDFHexString.fromText(bijlage.naam),
    EF: { F: stroom, UF: stroom },
    Desc: PDFHexString.fromText(bijlage.beschrijving || bijlage.naam),
    AFRelationship: 'Unspecified',
  }));
}

// Verwijst een object (diep, binnen directe woordenboeken en arrays) naar `ref`?
function verwijstNaar(obj, ref, diepte = 0) {
  if (obj === ref) return true;
  if (diepte > 8) return false;
  if (obj instanceof PDFStream) return verwijstNaar(obj.dict, ref, diepte + 1);
  if (obj instanceof PDFDict) {
    for (const [, waarde] of obj.entries()) if (verwijstNaar(waarde, ref, diepte + 1)) return true;
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) if (verwijstNaar(obj.get(i), ref, diepte + 1)) return true;
  }
  return false;
}

// Een verwijderd bestand hoort ook fysiek uit het bestand te gaan — maar
// alleen als niets anders er nog naar verwijst (een bijlage-annotatie kan
// dezelfde bestandsspecificatie gebruiken).
function ruimOp(context, specRef) {
  if (!(specRef instanceof PDFRef)) return;
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (ref !== specRef && verwijstNaar(obj, specRef)) return;
  }
  const spec = context.lookup(specRef);
  const ef = spec instanceof PDFDict ? spec.lookup(PDFName.of('EF')) : null;
  if (ef instanceof PDFDict) {
    for (const [, stroom] of ef.entries()) {
      if (!(stroom instanceof PDFRef)) continue;
      // Multiple filespecs can share one embedded stream. Removing a component
      // must not corrupt the bytes of the remaining component.
      const gedeeld = context.enumerateIndirectObjects().some(([ref, obj]) => ref !== specRef && verwijstNaar(obj, stroom));
      if (!gedeeld) context.delete(stroom);
    }
  }
  context.delete(specRef);
}

/**
 * Past de bijlagenwijzigingen toe op een pdf-lib-document: verwijderde en
 * vervangen bestanden gaan uit de naamboom (en uit /AF), toegevoegde komen
 * erin. De naamboom wordt één platte, gesorteerde lijst — ook als hij in het
 * bronbestand over /Kids verdeeld was.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {BijlagenWijzigingen|null|undefined} wijzigingen
 * @returns {boolean} of er iets veranderd is
 */
export function pasBijlagenToe(pdfDoc, wijzigingen) {
  const toegevoegd = wijzigingen?.toegevoegd || [];
  const verwijderd = wijzigingen?.verwijderd || [];
  if (!toegevoegd.length && !verwijderd.length) return false;
  const { context, catalog } = pdfDoc;
  const weg = new Set([...verwijderd, ...toegevoegd.map((b) => b.naam)]);
  let { names, ef } = embeddedFiles(pdfDoc);

  // De oude boom (en een indirecte /AF) gaat straks weg; anders blijven ze
  // naar de verwijderde bestanden wijzen en blijven die in het bestand staan.
  const oudeKnopen = [];
  const efRaw = names?.get(PDFName.of('EmbeddedFiles'));
  if (efRaw instanceof PDFRef) oudeKnopen.push(efRaw);
  const afRaw = catalog.get(PDFName.of('AF'));
  if (afRaw instanceof PDFRef) oudeKnopen.push(afRaw);

  const blijft = [];
  const wegSpecs = [];
  for (const [sleutel, waarde] of ef ? bladen(context, ef, [], new Set(), oudeKnopen) : []) {
    const naam = tekstVan(sleutel);
    if (naam !== null && weg.has(naam)) { wegSpecs.push(waarde); continue; }
    blijft.push({ naam: naam ?? '', sleutel, waarde });
  }
  if (!wegSpecs.length && !toegevoegd.length) return false;

  const nieuweSpecs = [];
  for (const bijlage of toegevoegd) {
    const spec = maakBestandsspecificatie(pdfDoc, bijlage);
    nieuweSpecs.push(spec);
    blijft.push({ naam: bijlage.naam, sleutel: PDFHexString.fromText(bijlage.naam), waarde: spec });
  }
  blijft.sort((a, b) => (a.naam < b.naam ? -1 : a.naam > b.naam ? 1 : 0));

  // /AF (geassocieerde bestanden) van de catalogus volgt de naamboom.
  const af = catalog.lookup(PDFName.of('AF'));
  const afLijst = af instanceof PDFArray ? af.asArray().filter((r) => !wegSpecs.includes(r)) : [];
  afLijst.push(...nieuweSpecs);
  if (afLijst.length) catalog.set(PDFName.of('AF'), context.obj(afLijst));
  else catalog.delete(PDFName.of('AF'));

  if (blijft.length) {
    if (!names) {
      names = context.obj({});
      catalog.set(PDFName.of('Names'), names);
    }
    names.set(PDFName.of('EmbeddedFiles'), context.obj({ Names: blijft.flatMap((b) => [b.sleutel, b.waarde]) }));
  } else if (names) {
    names.delete(PDFName.of('EmbeddedFiles'));
    if (!names.keys().length) catalog.delete(PDFName.of('Names'));
  }

  for (const ref of oudeKnopen) context.delete(ref);
  for (const spec of wegSpecs) ruimOp(context, spec);
  return true;
}
