import { createSignal, For, Index, Show, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { openDialog, closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { state } from '../../../core/state.js';
import { labelVan, vulSjabloon } from '../../../pdf/pagina-labels.js';
import { leesGebied, leesAllePaginas, zetPaginaLabels } from '../../../pdf/pagina-labels-app.js';
import { kiesLabelGebied } from '../../../tools/tools/label-gebied-tool.js';

// Naambouwer voor paginalabels (#580). De gebruiker typt de naam in één veld;
// "Selecteren" zet op de cursorplek een {OCR1}, {OCR2}... voor tekst die hij op
// de pagina aanwijst, en die tekst wordt op elke pagina op dezelfde plek
// gelezen. De stand staat op moduleniveau: de dialoog gaat dicht terwijl de
// gebruiker een vak sleept en komt daarna terug.
export const DIALOOG = 'page-labels';

const [sjabloon, setSjabloon] = createSignal('');
const [gebieden, setGebieden] = createSignal([]); // [{ n, rect, page, voorbeeld }]
const [metOcr, setMetOcr] = createSignal(true);
const [rijen, setRijen] = createSignal([]);       // [{ page, teksten, ocr, label, bewerkt }]
const [voortgang, setVoortgang] = createSignal(null);
let docId = null;
let afgebroken = false;
let volgendeN = 1;
let cursorNaKeuze = null; // cursorplek in het veld na het invoegen van een {OCRn}

const actiefDoc = () => state.documents[state.activeDocumentIndex] || null;

function begin(doc) {
  if ((doc?.id ?? null) === docId) return;
  docId = doc?.id ?? null;
  afgebroken = true;
  setSjabloon('');
  setGebieden([]);
  setRijen([]);
  setVoortgang(null);
  volgendeN = 1;
  cursorNaKeuze = null;
}

const voorbeeldTeksten = () => Object.fromEntries(gebieden().map((g) => [g.n, g.voorbeeld]));

function herbereken() {
  setRijen((rs) => rs.map((r) => (r.bewerkt ? r : { ...r, label: vulSjabloon(sjabloon(), r.teksten) })));
}

export default function PageLabelsDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tc } = useTranslation('common');
  const tx = (key, opts) => t(`pageLabels.${key}`, opts);
  let veld;

  begin(actiefDoc());

  onMount(() => {
    if (!veld) return;
    veld.focus();
    if (cursorNaKeuze != null) {
      veld.setSelectionRange(cursorNaKeuze, cursorNaKeuze);
      cursorNaKeuze = null;
    }
  });

  const sluit = () => {
    afgebroken = true;
    closeDialog(DIALOOG);
  };

  async function selecteer() {
    const cursor = veld ? [veld.selectionStart, veld.selectionEnd] : null;
    closeDialog(DIALOOG);
    const keuze = await kiesLabelGebied(tx('pickHint'));
    const doc = actiefDoc();
    if (keuze && doc?.pdfDoc && (doc.id ?? null) === docId) {
      const { tekst } = await leesGebied(doc, keuze.page, keuze.rect, { ocr: metOcr() });
      const n = volgendeN++;
      setGebieden((gs) => [...gs, { n, rect: keuze.rect, page: keuze.page, voorbeeld: tekst }]);
      const s = sjabloon();
      const teken = `{OCR${n}}`;
      const [a, b] = cursor && cursor[0] != null ? cursor : [s.length, s.length];
      setSjabloon(s.slice(0, a) + teken + s.slice(b));
      cursorNaKeuze = a + teken.length;
      // Een nieuw vak: de gelezen tabel klopt niet meer.
      setRijen([]);
    }
    openDialog(DIALOOG);
  }

  function verwijderGebied(n) {
    setGebieden((gs) => gs.filter((g) => g.n !== n));
    setSjabloon((s) => s.replace(new RegExp(`\\{OCR${n}\\}`, 'gi'), ''));
    setRijen([]);
  }

  async function leesAlles() {
    const doc = actiefDoc();
    if (!doc?.pdfDoc || !gebieden().length) return;
    afgebroken = false;
    setVoortgang({ klaar: 0, totaal: doc.pdfDoc.numPages });
    try {
      const uitkomst = await leesAllePaginas(doc, gebieden(), {
        ocr: metOcr(),
        isAfgebroken: () => afgebroken,
        bijVoortgang: (klaar, totaal) => setVoortgang({ klaar, totaal }),
      });
      if ((doc.id ?? null) !== docId) return;
      setRijen(uitkomst.map((r) => ({ ...r, bewerkt: false, label: vulSjabloon(sjabloon(), r.teksten) })));
    } finally {
      setVoortgang(null);
    }
  }

  function pasToe() {
    const doc = actiefDoc();
    if (!doc?.pdfDoc || (doc.id ?? null) !== docId) return;
    const labels = Array.from({ length: doc.pdfDoc.numPages }, (_, i) => labelVan(doc.pageLabels, i + 1));
    for (const r of rijen()) if (r.page <= labels.length) labels[r.page - 1] = r.label;
    zetPaginaLabels(doc, labels);
    sluit();
  }

  function herstel() {
    const doc = actiefDoc();
    if (doc?.pdfDoc) zetPaginaLabels(doc, null);
    setRijen([]);
    sluit();
  }

  const voorbeeld = () => vulSjabloon(sjabloon(), voorbeeldTeksten());
  const bezig = () => !!voortgang();
  const heeftOcrRij = () => rijen().some((r) => r.ocr);

  const footer = (
    <>
      <button class="pref-btn pref-btn-secondary" onClick={herstel}>{tx('reset')}</button>
      <div class="page-labels-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={!rijen().length || bezig()} onClick={pasToe}>{tc('apply')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={sluit}>{tc('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={tx('title')}
      overlayClass="page-labels-overlay"
      dialogClass="page-labels-dialog"
      bodyClass="page-labels-body"
      onClose={sluit}
      footer={footer}
    >
      <div class="page-labels-intro">{tx('intro', { select: tc('select') })}</div>

      <div class="page-labels-row">
        <label class="page-labels-label" for="page-labels-template">{tx('name')}</label>
        <input
          id="page-labels-template"
          ref={veld}
          class="page-labels-field"
          type="text"
          spellcheck={false}
          value={sjabloon()}
          placeholder="{OCR1} - {OCR2}"
          onInput={(e) => { setSjabloon(e.currentTarget.value); herbereken(); }}
        />
        <button class="pref-btn" disabled={bezig()} onClick={selecteer}>{tc('select')}</button>
      </div>

      <Show when={gebieden().length}>
        <div class="page-labels-regions">
          <For each={gebieden()}>
            {(g) => (
              <div class="page-labels-region">
                <span class="page-labels-token">{`{OCR${g.n}}`}</span>
                <span class="page-labels-sample" classList={{ empty: !g.voorbeeld }}>{g.voorbeeld || tx('noText')}</span>
                <span class="page-labels-region-page">{tc('page')} {g.page}</span>
                <button class="page-labels-remove" title={tc('delete')} onClick={() => verwijderGebied(g.n)}>
                  <svg width="8" height="8" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.4"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.4"/></svg>
                </button>
              </div>
            )}
          </For>
        </div>
        <div class="page-labels-example">{tx('example')} <b>{voorbeeld() || '-'}</b></div>
      </Show>

      <label class="page-labels-check">
        <input type="checkbox" checked={metOcr()} onChange={(e) => setMetOcr(e.currentTarget.checked)} />
        {tx('useOcr')}
      </label>

      <div class="page-labels-actions">
        <button class="pref-btn" disabled={bezig() || !gebieden().length} onClick={leesAlles}>{tx('read')}</button>
        <Show when={voortgang()}>
          <span class="page-labels-progress">
            {tx('reading', { done: Math.min(voortgang().klaar + 1, voortgang().totaal), total: voortgang().totaal })}
          </span>
          <button class="pref-btn pref-btn-secondary" onClick={() => { afgebroken = true; }}>{tc('cancel')}</button>
        </Show>
      </div>

      <Show when={rijen().length}>
        <div class="page-labels-table-wrap">
          <table class="page-labels-table">
            <thead>
              <tr>
                <th class="page-labels-col-page">{tc('page')}</th>
                <th>{tx('colLabel')}</th>
              </tr>
            </thead>
            <tbody>
              <Index each={rijen()}>
                {(rij) => (
                  <tr classList={{ ocr: rij().ocr }}>
                    <td class="page-labels-col-page">
                      {rij().page}
                      <Show when={rij().ocr}><span class="page-labels-ocr">OCR</span></Show>
                    </td>
                    <td>
                      <input
                        type="text"
                        spellcheck={false}
                        value={rij().label}
                        placeholder={String(rij().page)}
                        onInput={(e) => {
                          const waarde = e.currentTarget.value;
                          const pagina = rij().page;
                          setRijen((rs) => rs.map((r) => (r.page === pagina ? { ...r, label: waarde, bewerkt: true } : r)));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
        </div>
        <Show when={heeftOcrRij()}>
          <div class="page-labels-legend">{tx('ocrLegend')}</div>
        </Show>
      </Show>
    </Dialog>
  );
}
