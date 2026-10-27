// Momentopnamen schrijven en lezen in de herstelmap, via een adapter.
//
// De adapter levert vier handelingen op paden binnen de herstelmap; in de app
// zijn dat Tauri-commando's (herstel.rs), in de tests een nep-schijf:
//   schrijf(rel, bytes)  atomisch: tijdelijk bestand + hernoemen
//   leesTekst(rel)       tekst of null
//   lijst(rel)           [{naam, map, grootte, gewijzigdMs}], [] als de map ontbreekt
//   verwijder(rel)       bestand of map met inhoud
//
// Volgorde bij schrijven, zodat een crash op elk moment een bruikbare
// momentopname achterlaat:
//   1. momentopname-<n+1>.pdf (atomisch; de vorige blijft staan);
//   2. manifest.json (atomisch) — pas hierna wijst het manifest naar de nieuwe;
//   3. oudere momentopname-*.pdf weg (alleen de nieuwste blijft).
// Valt de app tussen 1 en 2 weg, dan wijst het manifest nog naar de vorige,
// complete momentopname; het losse nieuwe bestand ruimt de volgende opname op.

import { MANIFEST_NAAM, pdfNaam, generatieVan, leesManifest } from './manifest.js';

const tekstNaarBytes = (t) => new TextEncoder().encode(t);

/**
 * Schrijf een momentopname. Geeft het geschreven manifest terug.
 * @param {object} adapter
 * @param {{sleutel:string, bytes:Uint8Array, manifest:object}} o
 */
export async function schrijfMomentopname(adapter, { sleutel, bytes, manifest }) {
  const vorige = leesManifest(await leesVeilig(adapter, `${sleutel}/${MANIFEST_NAAM}`));
  const bestanden = await adapter.lijst(sleutel).catch(() => []);
  const hoogste = Math.max(
    0,
    vorige?.generatie || 0,
    ...bestanden.map((b) => generatieVan(b.naam) || 0),
  );
  const generatie = hoogste + 1;
  const pdf = pdfNaam(generatie);
  await adapter.schrijf(`${sleutel}/${pdf}`, bytes);
  const nieuw = { ...manifest, sleutel, generatie, pdf, pdfGrootte: bytes.length };
  await adapter.schrijf(`${sleutel}/${MANIFEST_NAAM}`, tekstNaarBytes(JSON.stringify(nieuw, null, 2)));
  for (const b of bestanden) {
    const g = generatieVan(b.naam);
    if (g != null && g !== generatie) {
      try { await adapter.verwijder(`${sleutel}/${b.naam}`); } catch { /* volgende keer */ }
    }
  }
  return nieuw;
}

/** Herschrijf alleen het manifest (na overnemen door een andere sessie). */
export async function schrijfManifest(adapter, sleutel, manifest) {
  await adapter.schrijf(`${sleutel}/${MANIFEST_NAAM}`, tekstNaarBytes(JSON.stringify({ ...manifest, sleutel }, null, 2)));
}

async function leesVeilig(adapter, rel) {
  try { return await adapter.leesTekst(rel); } catch { return null; }
}

/**
 * Alle momentopnamemappen met hun manifest (of null) en totale grootte.
 * De map `markers` hoort er niet bij.
 */
export async function leesAlle(adapter) {
  const mappen = (await adapter.lijst('').catch(() => [])).filter((i) => i.map && i.naam !== 'markers');
  const uit = [];
  for (const m of mappen) {
    const bestanden = await adapter.lijst(m.naam).catch(() => []);
    const manifest = leesManifest(await leesVeilig(adapter, `${m.naam}/${MANIFEST_NAAM}`));
    const pdf = manifest ? bestanden.find((b) => b.naam === manifest.pdf) : null;
    uit.push({
      sleutel: m.naam,
      manifest: manifest && pdf ? manifest : null,
      // Niet bruikbaar: geen (geldig) manifest, of het bestand ontbreekt.
      onvolledig: !(manifest && pdf),
      grootte: bestanden.reduce((s, b) => s + (b.map ? 0 : (b.grootte || 0)), 0),
      gewijzigdMs: Math.max(m.gewijzigdMs || 0, ...bestanden.map((b) => b.gewijzigdMs || 0)),
    });
  }
  return uit;
}

/** De "draait"-markeringen van alle instanties. */
export async function leesMarkers(adapter) {
  const bestanden = (await adapter.lijst('markers').catch(() => [])).filter((b) => !b.map && b.naam.endsWith('.json'));
  const uit = [];
  for (const b of bestanden) {
    try {
      const m = JSON.parse((await adapter.leesTekst(`markers/${b.naam}`)) || 'null');
      if (m && typeof m.id === 'string') uit.push({ ...m, bestand: b.naam });
    } catch { /* kapotte markering: overslaan */ }
  }
  return uit;
}
