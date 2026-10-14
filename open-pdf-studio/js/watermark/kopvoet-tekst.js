// Kop- en voetteksten: de variabelen en de Bates-nummering.
//
// Eén plek voor wat scherm (watermark-renderer.js) en bestand
// (pdf/saver/watermarks.js) invullen, zodat ze nooit uiteenlopen.
//
// Variabelen: {page}, {pages}, {date}, {time}, {filename}, {title} en {bates}.
// Een Bates-nummer is voorvoegsel + volgnummer (met voorloopnullen) +
// achtervoegsel. Het telt door over de pagina's waarop deze kop-/voettekst
// staat: bij "pagina 3-5" krijgt pagina 3 het startnummer.

export const KOPVOET_VARIABELEN = ['{page}', '{pages}', '{date}', '{time}', '{filename}', '{title}', '{bates}'];

export const BATES_STANDAARD = Object.freeze({ batesPrefix: '', batesStart: 1, batesDigits: 6, batesSuffix: '' });

const geheel = (waarde, standaard, min, max) => {
  const n = Number.parseInt(waarde, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : standaard;
};

/** De Bates-instellingen van een kop-/voettekst, opgeschoond. */
export function batesInstellingen(wm) {
  return {
    batesPrefix: String(wm?.batesPrefix ?? BATES_STANDAARD.batesPrefix),
    batesStart: geheel(wm?.batesStart, BATES_STANDAARD.batesStart, 0, 999999999999),
    batesDigits: geheel(wm?.batesDigits, BATES_STANDAARD.batesDigits, 1, 12),
    batesSuffix: String(wm?.batesSuffix ?? BATES_STANDAARD.batesSuffix),
  };
}

/** Het Bates-nummer voor het `volgnummer`-de blad (0 = het eerste). */
export function batesNummer(wm, volgnummer) {
  const b = batesInstellingen(wm);
  return `${b.batesPrefix}${String(b.batesStart + Math.max(0, volgnummer)).padStart(b.batesDigits, '0')}${b.batesSuffix}`;
}

/**
 * De pagina's (1-based, oplopend) waarop deze kop-/voettekst staat.
 * `paginaBereik` is parsePageRange (exporter.js); meegegeven zodat deze
 * module zonder app-imports te testen is.
 */
export function toegepastePaginas(wm, totaal, paginaBereik) {
  if (!wm?.enabled) return [];
  if (wm.pageRange === 'first') return totaal >= 1 ? [1] : [];
  if (wm.pageRange === 'custom' && wm.customPages) return paginaBereik(wm.customPages, totaal);
  return Array.from({ length: Math.max(0, totaal) }, (_, i) => i + 1);
}

/** De bestandsnaam zonder .pdf: de titel als het document er zelf geen heeft. */
export function documentTitel(titel, bestandsnaam) {
  const eigen = String(titel ?? '').trim();
  if (eigen) return eigen;
  return String(bestandsnaam ?? '').replace(/\.pdf$/i, '');
}

/**
 * Vult de variabelen in. `waarden`: { pagina, paginas, datum, tijd,
 * bestandsnaam, titel, bates }.
 */
export function vulKopVoetIn(tekst, waarden) {
  if (!tekst) return '';
  const tabel = {
    '{page}': waarden.pagina, '{pages}': waarden.paginas, '{date}': waarden.datum,
    '{time}': waarden.tijd, '{filename}': waarden.bestandsnaam, '{title}': waarden.titel,
    '{bates}': waarden.bates,
  };
  return String(tekst).replace(/\{(?:page|pages|date|time|filename|title|bates)\}/g, (v) => String(tabel[v] ?? ''));
}

/**
 * De waarden voor één pagina. `toegepast` is de uitkomst van
 * toegepastePaginas (voor het Bates-volgnummer).
 */
export function kopVoetWaarden(wm, { pagina, paginas, toegepast, bestandsnaam = '', titel = '', nu = new Date() }) {
  const volgnummer = Math.max(0, (toegepast || []).indexOf(pagina));
  return {
    pagina, paginas,
    datum: nu.toLocaleDateString(),
    tijd: nu.toLocaleTimeString(),
    bestandsnaam,
    titel: documentTitel(titel, bestandsnaam),
    bates: batesNummer(wm, volgnummer),
  };
}

/** De zes vakken van een kop-/voettekst, in vaste volgorde. */
export const KOPVOET_VAKKEN = [
  { sleutel: 'headerLeft', rij: 'kop', uitlijning: 'left' },
  { sleutel: 'headerCenter', rij: 'kop', uitlijning: 'center' },
  { sleutel: 'headerRight', rij: 'kop', uitlijning: 'right' },
  { sleutel: 'footerLeft', rij: 'voet', uitlijning: 'left' },
  { sleutel: 'footerCenter', rij: 'voet', uitlijning: 'center' },
  { sleutel: 'footerRight', rij: 'voet', uitlijning: 'right' },
];

/**
 * Waar een vak staat, in weergaveruimte (y omlaag, oorsprong linksboven):
 * de BASISLIJN van de kop ligt `marginTop` onder de bovenrand, die van de
 * voet `marginBottom` boven de onderrand. Scherm en bestand gebruiken dit
 * allebei.
 */
export function vakPositie(wm, vak, breedte, hoogte) {
  const ml = wm.marginLeft || 40, mr = wm.marginRight || 40;
  const mt = wm.marginTop || 30, mb = wm.marginBottom || 30;
  const x = vak.uitlijning === 'left' ? ml : vak.uitlijning === 'right' ? breedte - mr : breedte / 2;
  return { x, basislijn: vak.rij === 'kop' ? mt : hoogte - mb };
}

/**
 * Staat deze kop-/voettekst al als pagina-inhoud in het bestand waaruit de
 * pagina's nu getekend worden? Dan tekent het scherm hem niet nog eens
 * (zie kopvoet-weergave.js).
 */
export function kopVoetInWeergave(doc, wm) {
  return !!(wm?.uitBestand && doc?._kopVoetBron && doc._kopVoetBron === doc.filePath);
}
