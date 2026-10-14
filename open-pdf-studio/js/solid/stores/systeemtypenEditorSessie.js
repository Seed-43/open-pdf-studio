// De sessie van de native systeemtypen-editor (#567), zonder UI: werkkopie
// en basis, bewerken, de omzet-wachtrij, Toepassen, Annuleren en focus.
// SysteemtypenDialog.jsx toont alleen wat deze sessie bijhoudt en roept haar
// methoden aan; zo is het gedrag van de dialoog onder node:test te toetsen
// (systeemtypenEditorSessie.test.mjs).
//
//  - BASIS = de registrystand bij openen of na de vorige Toepassen; WERK = de
//    werkkopie die de gebruiker bewerkt.
//  - Toepassen schrijft alleen het VERSCHIL (planEditorToepassen) via de ene
//    commit van de registry (opslaan, hertekenen, melding). Eerst gaan de
//    omzettingen uit de wachtrij naar de open documenten (doc.modified alleen
//    waar echt iets omgezet is). Zonder verschil: geen commit en geen melding.
//  - Annuleren gooit werkkopie en wachtrij weg: registry, documenten,
//    tool-keuze en meldingen blijven ongemoeid.
//  - Bewerken controleert de fysieke maten (controleerEditorInvoer): een
//    waarde buiten het bereik of klein > raveel komt niet in de werkkopie;
//    een leeg veld maakt de maat onbevestigd (geen standaardmaat).
//
// Host: { registry: { getSysteemTypenData, commitSysteemTypen },
//         documenten() → open documenten, redraw() }.
import {
  findSysteemType, normalizeSysteemType, duplicateSysteemType, removeSysteemTypeFrom,
  reassignSysteemType, newSysteemTypeId,
} from '../../annotations/systeem-typen.js';
import {
  planEditorToepassen, beginSelectie, focusOpType, gebruikNaWachtrij, controleerEditorInvoer,
} from '../../annotations/systeem-typen-contract.js';

const kloon = (x) => JSON.parse(JSON.stringify(x));

/** Een nieuwe editorsessie, met `typeId` als beginselectie. */
export function maakEditorSessie({ host, typeId } = {}) {
  let basis = kloon(host.registry.getSysteemTypenData());
  let werk = kloon(basis);
  let selectedId = beginSelectie(werk, typeId);
  // Omzettingen { vanId, naarId }: pas bij Toepassen uitgevoerd.
  let wachtrij = [];
  // Verwijder-flow: null of { id, count, doelId }.
  let verwijderVraag = null;
  // Melding bij een geweigerde invoer (Nederlands, voor de dialoog).
  let melding = null;
  const luisteraars = new Set();

  function gewijzigd() {
    for (const f of [...luisteraars]) f();
  }

  // Alle annotaties van alle open documenten (voor in-gebruik-detectie).
  function alleAnnotaties() {
    const uit = [];
    for (const doc of host.documenten() || []) {
      for (const a of doc?.annotations || []) uit.push(a);
    }
    return uit;
  }

  const huidig = () => findSysteemType(werk, selectedId) || werk.typen[0] || null;

  function verwijderUitWerk(id) {
    werk = removeSysteemTypeFrom(werk, id);
    selectedId = werk.typen[0]?.id || '';
    verwijderVraag = null;
  }

  return {
    /** Luister naar elke verandering van de sessie; geeft de afmeldfunctie. */
    luister(f) {
      luisteraars.add(f);
      return () => luisteraars.delete(f);
    },
    werk: () => werk,
    typen: () => werk.typen,
    huidig,
    verwijderVraag: () => verwijderVraag,
    melding: () => melding,
    /** Verschilt de werkkopie (of de wachtrij) van de basis? */
    heeftWijzigingen() {
      return wachtrij.length > 0 || planEditorToepassen(basis, werk, basis, []).wijzigingen.length > 0;
    },

    selecteer(id) {
      selectedId = id;
      verwijderVraag = null;
      gewijzigd();
    },

    /**
     * Bewerk het geselecteerde type in de werkkopie. Een fysieke maat buiten
     * het bereik (of klein > raveel) wordt geweigerd met een melding.
     * @returns {boolean} of de bewerking is doorgevoerd.
     */
    muteer(patch) {
      const t = huidig();
      if (!t) return false;
      const fout = controleerEditorInvoer(patch);
      if (fout) {
        melding = fout.melding;
        gewijzigd();
        return false;
      }
      const idx = werk.typen.findIndex(x => x.id === t.id);
      // Normaliseren zonder verzonnen maten: een leeg veld = onbevestigd.
      werk.typen[idx] = normalizeSysteemType({ ...t, ...patch, id: t.id });
      melding = null;
      gewijzigd();
      return true;
    },

    nieuw() {
      const bron = huidig() || normalizeSysteemType({ id: newSysteemTypeId(), naam: 'Systeemtype' });
      const copy = duplicateSysteemType(bron, 'Nieuw systeemtype');
      werk.typen.push(copy);
      selectedId = copy.id;
      gewijzigd();
    },

    dupliceer() {
      const t = huidig();
      if (!t) return;
      const copy = duplicateSysteemType(t);
      werk.typen.push(copy);
      selectedId = copy.id;
      gewijzigd();
    },

    /** Verwijder het geselecteerde type uit de werkkopie; is het (na de
     *  wachtrij) in gebruik, dan eerst de vraag om om te zetten. */
    verwijder() {
      const t = huidig();
      if (!t || werk.typen.length <= 1) return;
      const count = gebruikNaWachtrij(alleAnnotaties(), wachtrij, t.id);
      if (count > 0) {
        const doel = werk.typen.find(x => x.id !== t.id);
        verwijderVraag = { id: t.id, count, doelId: doel?.id || '' };
      } else {
        verwijderUitWerk(t.id);
      }
      gewijzigd();
    },

    zetOmzetDoel(doelId) {
      if (!verwijderVraag) return;
      verwijderVraag = { ...verwijderVraag, doelId };
      gewijzigd();
    },

    annuleerVerwijderVraag() {
      verwijderVraag = null;
      gewijzigd();
    },

    /** Omzetten en verwijderen: alleen in de wachtrij; de documenten
     *  veranderen pas bij Toepassen. */
    bevestigOmzetten() {
      const v = verwijderVraag;
      const doel = v ? findSysteemType(werk, v.doelId) : null;
      if (!v || !doel) return;
      wachtrij = [...wachtrij, { vanId: v.id, naarId: doel.id }];
      verwijderUitWerk(v.id);
      gewijzigd();
    },

    /** Toepassen (ook de eerste helft van OK). */
    toepassen() {
      const plan = planEditorToepassen(basis, werk, host.registry.getSysteemTypenData(), wachtrij);
      // Eerst de omzettingen: de instanties volgen hun nieuwe type (geen
      // undo-stap, zoals voorheen). Een tussendoel dat zelf ook verwijderd
      // is, komt uit de basis; de volgende omzetting brengt ze verder.
      for (const o of plan.omzettingen) {
        const doel = findSysteemType(plan.data, o.naarId)
          || findSysteemType(basis, o.naarId) || findSysteemType(werk, o.naarId);
        if (!doel) continue;
        for (const doc of host.documenten() || []) {
          if (doc && reassignSysteemType(doc.annotations || [], o.vanId, doel) > 0) doc.modified = true;
        }
      }
      // Daarna de typewijziging via de ene commit. Zonder verschil geen
      // commit en geen melding; alleen omzettingen: wel hertekenen.
      if (plan.wijzigingen.length) host.registry.commitSysteemTypen(plan.data, plan.wijzigingen, 'editor');
      else if (plan.omzettingen.length) host.redraw();
      wachtrij = [];
      // Alles is toegepast: de nieuwe registrystand is basis én werkkopie.
      basis = kloon(host.registry.getSysteemTypenData());
      werk = kloon(basis);
      if (!findSysteemType(werk, selectedId)) selectedId = werk.typen[0]?.id || '';
      verwijderVraag = null;
      melding = null;
      gewijzigd();
    },

    /** Annuleren (ook Escape en de sluitknop): werkkopie en wachtrij weg. */
    annuleren() {
      werk = kloon(basis);
      wachtrij = [];
      verwijderVraag = null;
      melding = null;
      if (!findSysteemType(werk, selectedId)) selectedId = werk.typen[0]?.id || '';
      gewijzigd();
    },

    /** Focusverzoek terwijl de editor open is (§9.1): alleen de selectie;
     *  een later geregistreerd type komt ongewijzigd in basis en werkkopie.
     *  @returns {boolean} of de selectie veranderde. */
    focus(typeId) {
      const r = focusOpType({ basis, werk, huidig: host.registry.getSysteemTypenData(), typeId });
      if (!r) return false;
      basis = r.basis;
      werk = r.werk;
      selectedId = r.selectedId;
      verwijderVraag = null;
      gewijzigd();
      return true;
    },
  };
}
