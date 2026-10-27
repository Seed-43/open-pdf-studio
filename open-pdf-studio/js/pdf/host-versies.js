// De versies van een document van de site, voor de lijst in "Op deze site" (#707).
//
// De site geeft ze via het opslagcontract (`versions(id)`, in de werkplek het
// bericht `versies`) als [{ version, modified?, author? }]. De huidige versie
// opent gewoon (`open { bestand }`); een oudere versie opent sinds #712 met
// `open { bestand, versie }`: alleen-lezen, zonder slot, in een eigen
// tabblad met "Versie 3 van 5 – alleen-lezen" (pdf/host-document.js).

const alsGetal = (v) => (typeof v === 'number' ? v : (/^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : NaN));

/**
 * De versies, nieuwste eerst, met de huidige gemarkeerd.
 * Met alleen versienummers: aflopend op nummer en de hoogste is de huidige.
 * Anders blijft de volgorde van de site en is er geen huidige aan te wijzen.
 * @param {unknown} lijst
 * @returns {{ version: string, modified: string|null, author: string|null, huidig: boolean }[]}
 */
export function ordenVersies(lijst) {
  if (!Array.isArray(lijst)) return [];
  const versies = lijst
    .filter((v) => v && typeof v === 'object' && v.version !== undefined && v.version !== null && String(v.version) !== '')
    .map((v) => ({
      version: String(v.version),
      modified: typeof v.modified === 'string' && v.modified ? v.modified : null,
      author: typeof v.author === 'string' && v.author ? v.author : null,
      huidig: false,
    }));
  if (versies.length && versies.every((v) => Number.isFinite(alsGetal(v.version)))) {
    versies.sort((a, b) => alsGetal(b.version) - alsGetal(a.version));
    versies[0].huidig = true;
  }
  return versies;
}

/**
 * Het aantal versies voor "Versie 3 van 5": het hoogste versienummer, of
 * zonder nummers het aantal in de lijst.
 * @param {ReturnType<typeof ordenVersies>} versies
 */
export function aantalVersies(versies) {
  if (!Array.isArray(versies) || !versies.length) return null;
  const nummers = versies.map((v) => alsGetal(v.version));
  return nummers.every(Number.isFinite) ? Math.max(...nummers) : versies.length;
}

/**
 * "Versie 3 van 5 – alleen-lezen" voor een document dat als oudere versie
 * geopend is (doc.hostVersie), anders null.
 * @param {(sleutel: string, opties?: object) => string} t
 */
export function hostVersieLabel(doc, t) {
  const hv = doc?.hostVersie;
  if (!hv || hv.versie === null || hv.versie === undefined || hv.versie === '') return null;
  return hv.totaal
    ? t('hostVersionReadOnly', { version: hv.versie, total: hv.totaal })
    : t('hostVersionReadOnlyShort', { version: hv.versie });
}
