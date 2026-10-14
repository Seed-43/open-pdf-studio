/**
 * Bijdrageregister per extensie (#550, #551).
 *
 * Elke registratie via de plug-in-API loopt via een scope van de extensie.
 * Bij deactiveren of herladen ruimt `ruimOp()` alles op, in omgekeerde
 * volgorde: wat het laatst is geregistreerd, gaat het eerst weg (een opdracht
 * verdwijnt zo vóór het tabblad dat hem toont). Een opruimfunctie die gooit,
 * stopt de rest niet; de fout komt terug als waarschuwing CLEANUP_FAILED.
 *
 * Voor de nieuwe soorten (`ribbonTab`, `command`) bewaakt een globale tabel
 * het eigenaarschap: een sleutel die al bij een (andere) extensie hoort, geeft
 * CONTRIBUTION_CONFLICT. Een extensie kan dus nooit het tabblad of de opdracht
 * van een andere vervangen of verwijderen.
 *
 * Zuivere module zonder app-afhankelijkheden, zodat ze onder node:test draait.
 */

/** Fout bij het registreren van een bijdrage; `code` is machineleesbaar. */
export class ExtensionContributionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ExtensionContributionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

// Strikt extensie-id (dezelfde regel als `valideer_extensie_id` in
// src-tauri/src/extensie_installatie.rs): kleine letters, cijfers, `-` en `.`,
// 1-64 tekens, en het eerste segment is geen Windows-apparaatnaam.
const STRIKT_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const APPARAATNAMEN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Voldoet dit id aan de strikte regel voor extensie-id's? */
export function isStriktExtensieId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && STRIKT_ID.test(id)
    && !APPARAATNAMEN.test(id.split('.')[0]);
}

// Soorten waarvan het eigenaarschap globaal wordt bewaakt. De bestaande
// soorten (annotatietypen, paletten, panelen) volgen later (§13 van het ontwerp);
// 'structuredCommand' is een opdracht met schema's (#575).
const BEWAAKTE_SOORTEN = new Set(['ribbonTab', 'command', 'structuredCommand']);

// `${soort}\u0000${sleutel}` -> extensie-id
const eigenaars = new Map();

const tabelSleutel = (soort, sleutel) => `${soort}\u0000${sleutel}`;

/** De extensie die deze bijdrage bezit, of null. Alleen voor bewaakte soorten. */
export function eigenaarVan(soort, sleutel) {
  return eigenaars.get(tabelSleutel(soort, sleutel)) ?? null;
}

/** Alleen voor tests: begin met een lege eigenaarstabel. */
export function _wisEigenaars() {
  eigenaars.clear();
}

/**
 * Maak de scope van één extensie.
 * @param {string} extId
 */
export function maakBijdrageScope(extId) {
  if (typeof extId !== 'string' || !extId) throw new TypeError('extension id required');
  // Registratievolgorde; elk element { soort, sleutel, opruimen }.
  const bijdragen = [];
  let actief = true;

  const zoek = (soort, sleutel) => bijdragen.findIndex((b) => b.soort === soort && b.sleutel === sleutel);

  function geefVrij(b) {
    if (BEWAAKTE_SOORTEN.has(b.soort) && eigenaars.get(tabelSleutel(b.soort, b.sleutel)) === extId) {
      eigenaars.delete(tabelSleutel(b.soort, b.sleutel));
    }
  }

  function voerOpruimenUit(b, waarschuwingen) {
    geefVrij(b);
    try {
      b.opruimen();
    } catch (fout) {
      waarschuwingen.push({
        code: 'CLEANUP_FAILED', soort: b.soort, sleutel: b.sleutel,
        message: String(fout?.message ?? fout),
      });
    }
  }

  return {
    extId,

    /** Is de scope nog open voor registraties? */
    actief: () => actief,

    /**
     * Gooit EXTENSION_INACTIVE na `ruimOp()`. Voor registraties die niet via
     * `voegToe` lopen (annotatietypen, paletten, panelen, luisteraars): een
     * late registratie van een al opgeruimde extensie blijft zo nooit hangen.
     */
    eisActief(soort, sleutel) {
      if (!actief) {
        throw new ExtensionContributionError('EXTENSION_INACTIVE',
          `extension ${extId} is no longer active; ${soort} "${sleutel}" was not registered`);
      }
    },

    /**
     * Houd een bijdrage bij. Gooit EXTENSION_INACTIVE na `ruimOp()` en
     * CONTRIBUTION_CONFLICT als de sleutel al in gebruik is.
     */
    voegToe(soort, sleutel, opruimen) {
      if (typeof soort !== 'string' || !soort) throw new TypeError('contribution kind required');
      if (typeof sleutel !== 'string' || !sleutel) throw new TypeError('contribution key required');
      if (typeof opruimen !== 'function') throw new TypeError('cleanup function required');
      this.eisActief(soort, sleutel);
      const bestaande = BEWAAKTE_SOORTEN.has(soort) ? eigenaarVan(soort, sleutel) : null;
      if (bestaande || zoek(soort, sleutel) >= 0) {
        throw new ExtensionContributionError('CONTRIBUTION_CONFLICT',
          `${soort} "${sleutel}" is already registered${bestaande && bestaande !== extId ? ` by ${bestaande}` : ''}`);
      }
      if (BEWAAKTE_SOORTEN.has(soort)) eigenaars.set(tabelSleutel(soort, sleutel), extId);
      bijdragen.push({ soort, sleutel, opruimen });
    },

    /**
     * Ruim één bijdrage van deze extensie op. Geeft false als ze niet (meer)
     * bij deze scope hoort. Fouten van de opruimfunctie komen terug als lijst.
     */
    verwijder(soort, sleutel) {
      const i = zoek(soort, sleutel);
      if (i < 0) return false;
      const [b] = bijdragen.splice(i, 1);
      const waarschuwingen = [];
      voerOpruimenUit(b, waarschuwingen);
      if (waarschuwingen.length) console.warn('[extensies] opruimen mislukt', waarschuwingen[0]);
      return true;
    },

    /** De bijdragen in registratievolgorde, als { soort, sleutel }. */
    lijst() {
      return bijdragen.map(({ soort, sleutel }) => ({ soort, sleutel }));
    },

    /**
     * Ruim alles op, in omgekeerde volgorde. Idempotent: een tweede aanroep
     * doet niets. Geeft de waarschuwingen (CLEANUP_FAILED) terug.
     */
    ruimOp() {
      actief = false;
      const waarschuwingen = [];
      while (bijdragen.length) voerOpruimenUit(bijdragen.pop(), waarschuwingen);
      return waarschuwingen;
    },
  };
}
