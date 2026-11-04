import { createSignal, For, onCleanup, onMount } from 'solid-js';
import * as pdfjsLib from 'pdfjs-dist';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { bereikTekst } from '../../../pdf/bron-paginas-kiezen.js';
import { pdfjsBronnen } from '../../../core/basis-url.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

// Which pages of a source PDF to insert or use as replacement (#963).
// data: { bytes, naam, aantal, doel: 'insert'|'replace', onDone(pages|null) }
export default function ChoosePagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const aantal = props.data?.aantal || 1;
  const alle = Array.from({ length: aantal }, (_, i) => i + 1);

  const [gekozen, setGekozen] = createSignal(new Set(alle));
  const [bereik, setBereik] = createSignal(bereikTekst(alle));
  const [bereikFout, setBereikFout] = createSignal(false);
  const doeken = [];
  let pdf = null;
  let gestopt = false;

  const lijst = () => alle.filter(p => gekozen().has(p));
  const zet = (paginas) => {
    setGekozen(new Set(paginas));
    setBereik(bereikTekst(paginas));
    setBereikFout(false);
  };
  const wissel = (p) => {
    const s = new Set(gekozen());
    s.has(p) ? s.delete(p) : s.add(p);
    zet(alle.filter(x => s.has(x)));
  };
  const typ = (tekst) => {
    setBereik(tekst);
    const paginas = parsePageRange(tekst, aantal);
    setBereikFout(!!tekst.trim() && !paginas.length);
    if (paginas.length) setGekozen(new Set(paginas));
  };

  const sluit = (paginas) => {
    closeDialog('choose-pages');
    props.data?.onDone?.(paginas);
  };
  const ok = () => {
    if (!lijst().length) { showMessage(tCommon('invalidPageRange')); return; }
    sluit(lijst());
  };

  // Thumbnails, one page at a time, so a large set shows its first pages fast.
  onMount(async () => {
    try {
      pdf = await pdfjsLib.getDocument({
        data: props.data.bytes.slice(), ...pdfjsBronnen(), isEvalSupported: false, verbosity: 0,
      }).promise;
      for (let p = 1; p <= aantal && !gestopt; p++) {
        const doek = doeken[p];
        if (!doek) continue;
        const pagina = await pdf.getPage(p);
        const basis = pagina.getViewport({ scale: 1 });
        const schaal = Math.min(150 / basis.width, 150 / basis.height);
        const vp = pagina.getViewport({ scale: schaal * (window.devicePixelRatio || 1) });
        doek.width = Math.ceil(vp.width);
        doek.height = Math.ceil(vp.height);
        doek.style.width = `${Math.ceil(vp.width / (window.devicePixelRatio || 1))}px`;
        await pagina.render({ canvasContext: doek.getContext('2d'), viewport: vp }).promise;
      }
    } catch (e) {
      console.warn('[choose-pages] thumbnails not drawn:', e?.message || e);
    }
  });
  onCleanup(() => { gestopt = true; pdf?.destroy?.(); });

  const footer = (
    <>
      <div class="choose-pages-footer-left">
        <button class="pref-btn pref-btn-secondary" onClick={() => zet(alle)}>{t('choosePages.all')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={() => zet([])}>{t('choosePages.none')}</button>
      </div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={ok}>
          {props.data?.doel === 'replace' ? t('choosePages.replace') : t('choosePages.insert')}
        </button>
        <button class="pref-btn pref-btn-secondary" onClick={() => sluit(null)}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('choosePages.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="choose-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={() => sluit(null)}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row extract-pages-info">
          {t('choosePages.from', { name: props.data?.naam || '', count: aantal })}
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('extractPages.pageRange')}</label>
          <input
            type="text"
            class="extract-pages-input-wide"
            classList={{ 'choose-pages-fout': bereikFout() }}
            placeholder={t('extractPages.placeholder')}
            value={bereik()}
            onInput={(e) => typ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ok(); }}
          />
        </div>
        <div class="choose-pages-grid">
          <For each={alle}>
            {(p) => (
              <label class="choose-pages-item" classList={{ 'is-gekozen': gekozen().has(p) }}>
                <canvas ref={(el) => { doeken[p] = el; }} class="choose-pages-thumb" />
                <span class="choose-pages-num">
                  <input type="checkbox" checked={gekozen().has(p)} onChange={() => wissel(p)} /> {p}
                </span>
              </label>
            )}
          </For>
        </div>
        <div class="extract-pages-row extract-pages-info">
          {t('choosePages.selected', { count: lijst().length, total: aantal })}
        </div>
      </div>
    </Dialog>
  );
}
