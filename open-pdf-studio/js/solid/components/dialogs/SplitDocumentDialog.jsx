import { createSignal, createMemo, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { isTauri, openFolderDialog } from '../../../core/platform.js';
import {
  bereikenPerAantal, bereikenOpBladwijzers, bovensteBladwijzers, bestandsnamenVoorDelen,
  standaardPatroon, geldigAantal, geldigeMb, mapVanPad, documentNaam,
} from '../../../pdf/splits-logica.js';

// Hoeveel bestandsnamen het overzicht toont.
const MAX_VOORBEELD = 4;

/**
 * "Document splitsen" (#381): per N pagina's, per bladwijzer op het hoogste
 * niveau of per maximale bestandsgrootte, naar een map met een patroon voor
 * de bestandsnamen. Het werk zelf doet splits-app.js.
 */
export default function SplitDocumentDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const doc = getActiveDocument();
  const totaal = doc?.pdfDoc?.numPages || 0;
  const bladwijzers = Array.isArray(doc?.bookmarks) ? doc.bookmarks : [];
  const aantalBoven = bovensteBladwijzers(bladwijzers).length;
  const naam = documentNaam(doc);
  const opDisk = isTauri();
  // De map van het document; een naamloos document staat in een tijdelijke map.
  const startMap = doc && !doc.isUntitled ? mapVanPad(doc.saveTargetPath || doc.filePath) : '';

  const [modus, setModus] = createSignal(aantalBoven > 0 ? 'bookmarks' : 'pages');
  const [aantal, setAantal] = createSignal('1');
  const [maxMb, setMaxMb] = createSignal('10');
  const [map, setMap] = createSignal(startMap);
  const [patroon, setPatroon] = createSignal(standaardPatroon(modus()));
  // Zolang de gebruiker het patroon niet zelf aanpast, volgt het de modus.
  let eigenPatroon = false;

  const close = () => closeDialog('split-document');

  function kiesModus(nieuw) {
    setModus(nieuw);
    if (!eigenPatroon) setPatroon(standaardPatroon(nieuw));
  }

  // De delen zoals ze nu zouden worden; bij de grootte pas tijdens het splitsen bekend.
  const delen = createMemo(() => {
    if (modus() === 'bookmarks') return bereikenOpBladwijzers(bladwijzers, totaal);
    if (modus() === 'pages') return bereikenPerAantal(totaal, geldigAantal(aantal(), 1));
    return null;
  });

  const namen = createMemo(() => {
    const d = delen();
    return d ? bestandsnamenVoorDelen(d, { patroon: patroon(), naam }) : null;
  });

  const overzicht = createMemo(() => {
    const n = namen();
    if (!n) return t('splitDocument.sizeSummary');
    if (n.length === 0) return t('splitDocument.noParts');
    return t('splitDocument.summary', { count: n.length });
  });

  const kanSplitsen = createMemo(() => totaal > 0 && (namen() === null || namen().length > 0)
    && (modus() !== 'bookmarks' || aantalBoven > 0));

  async function kiesMap() {
    const gekozen = await openFolderDialog(t('splitDocument.chooseFolder'));
    if (typeof gekozen === 'string' && gekozen) setMap(gekozen);
  }

  async function splits() {
    if (!kanSplitsen()) return;
    let doel = map().trim();
    if (opDisk && !doel) {
      const gekozen = await openFolderDialog(t('splitDocument.chooseFolder'));
      if (typeof gekozen !== 'string' || !gekozen) return;
      doel = gekozen;
      setMap(gekozen);
    }
    const keuzes = { modus: modus(), n: aantal(), maxMb: maxMb(), map: doel, patroon: patroon() };
    close();
    const { splitsDocument } = await import('../../../pdf/splits-app.js');
    await splitsDocument(keuzes);
  }

  const footer = (
    <>
      <div></div>
      <div class="split-doc-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={!kanSplitsen()} onClick={splits}>{t('splitDocument.split')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('splitDocument.title')}
      overlayClass="split-doc-overlay"
      dialogClass="split-doc-dialog"
      headerClass="split-doc-header"
      bodyClass="split-doc-content"
      footerClass="split-doc-footer"
      onClose={close}
      footer={footer}
    >
      <div class="split-doc-form">
        <fieldset class="split-doc-group">
          <legend>{t('splitDocument.method')}</legend>
          <label class="split-doc-radio">
            <input type="radio" name="split-doc-modus" checked={modus() === 'pages'} onChange={() => kiesModus('pages')} />
            <span>{t('splitDocument.everyN')}</span>
            <input
              type="text" inputmode="decimal" data-getal
              class="split-doc-number"
              min="1"
              max={Math.max(1, totaal)}
              value={aantal()}
              disabled={modus() !== 'pages'}
              onInput={(e) => setAantal(e.target.value)}
              onChange={(e) => { const v = String(geldigAantal(e.target.value, 1)); setAantal(v); e.target.value = v; }}
            />
            <span>{t('splitDocument.pages')}</span>
          </label>
          <label class="split-doc-radio" classList={{ disabled: aantalBoven === 0 }}>
            <input
              type="radio"
              name="split-doc-modus"
              checked={modus() === 'bookmarks'}
              disabled={aantalBoven === 0}
              onChange={() => kiesModus('bookmarks')}
            />
            <span>{t('splitDocument.byBookmarks')}</span>
            <span class="split-doc-hint">
              {aantalBoven > 0 ? `(${aantalBoven})` : t('splitDocument.noneHint')}
            </span>
          </label>
          <label class="split-doc-radio">
            <input type="radio" name="split-doc-modus" checked={modus() === 'size'} onChange={() => kiesModus('size')} />
            <span>{t('splitDocument.bySize')}</span>
            <input
              type="text"
              inputmode="decimal"
              class="split-doc-number"
              value={maxMb()}
              disabled={modus() !== 'size'}
              onInput={(e) => setMaxMb(e.target.value)}
              onChange={(e) => { const v = String(geldigeMb(e.target.value, 10)); setMaxMb(v); e.target.value = v; }}
            />
            <span>MB</span>
          </label>
        </fieldset>

        <fieldset class="split-doc-group">
          <legend>{t('splitDocument.output')}</legend>
          <Show
            when={opDisk}
            fallback={<div class="split-doc-row split-doc-info">{t('splitDocument.browserDownloads')}</div>}
          >
            <div class="split-doc-row">
              <label class="split-doc-label">{t('splitDocument.folder')}</label>
              <input
                type="text"
                class="split-doc-input-wide"
                value={map()}
                onInput={(e) => setMap(e.target.value)}
              />
              <button class="pref-btn pref-btn-secondary split-doc-browse" onClick={kiesMap}>{t('splitDocument.browse')}</button>
            </div>
          </Show>
          <div class="split-doc-row">
            <label class="split-doc-label">{t('splitDocument.fileNames')}</label>
            <input
              type="text"
              class="split-doc-input-wide"
              value={patroon()}
              onInput={(e) => { eigenPatroon = true; setPatroon(e.target.value); }}
            />
          </div>
          <div class="split-doc-row split-doc-info split-doc-indent">{t('splitDocument.placeholders')}</div>
        </fieldset>

        <div class="split-doc-summary">
          <div>{overzicht()}</div>
          <Show when={namen() && namen().length > 0}>
            <ul class="split-doc-names">
              <For each={namen().slice(0, MAX_VOORBEELD)}>{(n) => <li>{n}</li>}</For>
              <Show when={namen().length > MAX_VOORBEELD}>
                <li>{t('splitDocument.andMore', { count: namen().length - MAX_VOORBEELD })}</li>
              </Show>
            </ul>
          </Show>
        </div>

        <div class="split-doc-info">{t('splitDocument.keeps')}</div>
        <Show when={doc?.modified}>
          <div class="split-doc-warning">{t('splitDocument.unsaved')}</div>
        </Show>
      </div>
    </Dialog>
  );
}
