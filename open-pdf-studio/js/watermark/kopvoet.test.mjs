import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict, degrees, StandardFonts } from 'pdf-lib';
import {
  batesNummer, batesInstellingen, toegepastePaginas, vulKopVoetIn, kopVoetWaarden, documentTitel, vakPositie,
  KOPVOET_VAKKEN, kopVoetInWeergave,
} from './kopvoet-tekst.js';
import {
  schrijfKopVoeten, vindKopVoetIds, verwijderKopVoetStromen, leesKopVoetDefinities, zonderKopVoetStromen,
} from '../pdf/saver/kopvoet.js';

// Zoals exporter.js#parsePageRange, voldoende voor deze tests.
const paginaBereik = (tekst, totaal) => {
  const uit = new Set();
  for (const deel of tekst.split(',')) {
    const [a, b = a] = deel.split('-').map((n) => Number(n.trim()));
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= totaal) uit.add(p);
  }
  return [...uit].sort((x, y) => x - y);
};

const kopVoet = (extra = {}) => ({
  id: 'wm-test', type: 'headerFooter', enabled: true, pageRange: 'all', customPages: '',
  headerLeft: '{title}', headerCenter: '', headerRight: 'Page {page} of {pages}',
  footerLeft: '', footerCenter: '{bates}', footerRight: '',
  fontFamily: 'Helvetica', fontSize: 10, color: '#000000',
  marginTop: 30, marginBottom: 30, marginLeft: 40, marginRight: 40,
  batesPrefix: 'ABC', batesStart: 1, batesDigits: 6, batesSuffix: '',
  ...extra,
});

async function pdfMet(aantal, { rotatie = 0 } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Tekeningenset Noord');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < aantal; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Inhoud ${i + 1}`, { x: 200, y: 400, size: 12, font });
    if (rotatie) page.setRotation(degrees(rotatie));
  }
  return pdf;
}

// Tekst per pagina zoals een andere lezer (PDF.js) hem leest, met de
// positie in weergaveruimte (y omlaag, ná /Rotate).
async function tekstVolgensPdfJs(bytes) {
  const { getDocument, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: true }).promise;
  try {
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      paginas.push(items.filter((i) => i.str.trim()).map((i) => {
        const m = Util.transform(viewport.transform, i.transform);
        return { tekst: i.str, x: m[4], y: m[5], breedte: viewport.width, hoogte: viewport.height };
      }));
    }
    return paginas;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
const teksten = (pagina) => pagina.map((i) => i.tekst);

function kopVoetStreamsOp(pdf, paginaIndex) {
  const lijst = pdf.context.lookup(pdf.getPage(paginaIndex).node.get(PDFName.of('Contents')));
  let n = 0;
  for (let i = 0; i < lijst.size(); i++) {
    if (pdf.context.lookup(lijst.get(i)).dict.has(PDFName.of('OPS_KopVoet'))) n++;
  }
  return n;
}

test('Bates numbers: prefix, start, leading zeros and suffix, counted over the pages it is on', () => {
  assert.equal(batesNummer({ batesPrefix: 'ABC', batesStart: 1, batesDigits: 6 }, 0), 'ABC000001');
  assert.equal(batesNummer({ batesPrefix: 'X-', batesStart: 98, batesDigits: 2, batesSuffix: '/B' }, 3), 'X-101/B');
  assert.deepEqual(batesInstellingen({ batesStart: '-4', batesDigits: '40' }), { batesPrefix: '', batesStart: 0, batesDigits: 12, batesSuffix: '' });
  const wm = kopVoet({ pageRange: 'custom', customPages: '3-5' });
  const toegepast = toegepastePaginas(wm, 6, paginaBereik);
  assert.deepEqual(toegepast, [3, 4, 5]);
  const opPagina = (p) => kopVoetWaarden(wm, { pagina: p, paginas: 6, toegepast, bestandsnaam: 'set.pdf' }).bates;
  assert.deepEqual([3, 4, 5].map(opPagina), ['ABC000001', 'ABC000002', 'ABC000003']);
  assert.deepEqual(toegepastePaginas({ ...wm, enabled: false }, 6, paginaBereik), []);
  assert.deepEqual(toegepastePaginas(kopVoet({ pageRange: 'first' }), 6, paginaBereik), [1]);
});

test('placeholders: {title} falls back to the file name, unknown braces stay', () => {
  const waarden = kopVoetWaarden(kopVoet(), { pagina: 2, paginas: 9, toegepast: [1, 2], bestandsnaam: 'Plan B.pdf', titel: '' });
  assert.equal(vulKopVoetIn('{title} – {filename} – {page}/{pages} – {bates} – {other}', waarden),
    'Plan B – Plan B.pdf – 2/9 – ABC000002 – {other}');
  assert.equal(documentTitel('  Eigen titel ', 'x.pdf'), 'Eigen titel');
  assert.equal(documentTitel('', 'tekening.PDF'), 'tekening');
});

test('screen and file share one baseline rule', () => {
  const wm = kopVoet({ marginTop: 20, marginBottom: 25, marginLeft: 10, marginRight: 15 });
  const [kopLinks, kopMidden, kopRechts, voetLinks] = KOPVOET_VAKKEN.map((v) => vakPositie(wm, v, 600, 800));
  assert.deepEqual(kopLinks, { x: 10, basislijn: 20 });
  assert.deepEqual(kopMidden, { x: 300, basislijn: 20 });
  assert.deepEqual(kopRechts, { x: 585, basislijn: 20 });
  assert.deepEqual(voetLinks, { x: 10, basislijn: 775 });
});

test('header, footer and Bates numbers are page content that another reader shows after reopening', async () => {
  const pdf = await pdfMet(3);
  const { geschreven } = await schrijfKopVoeten(pdf, [kopVoet()], { bestandsnaam: 'set.pdf', titel: pdf.getTitle(), paginaBereik });
  assert.deepEqual(geschreven, ['wm-test']);
  const paginas = await tekstVolgensPdfJs(await pdf.save());
  for (let p = 0; p < 3; p++) {
    assert.ok(teksten(paginas[p]).includes('Tekeningenset Noord'), `titel op pagina ${p + 1}`);
    assert.ok(teksten(paginas[p]).includes(`Page ${p + 1} of 3`));
    const bates = paginas[p].find((i) => i.tekst === `ABC00000${p + 1}`);
    assert.ok(bates, `Bates op pagina ${p + 1}`);
    // Voettekst: basislijn 30 pt boven de onderrand, gecentreerd.
    assert.ok(Math.abs(bates.y - (842 - 30)) < 1, `y ${bates.y}`);
  }
  const kop = paginas[0].find((i) => i.tekst === 'Tekeningenset Noord');
  assert.ok(Math.abs(kop.y - 30) < 1 && Math.abs(kop.x - 40) < 1, `${kop.x},${kop.y}`);
});

test('saving again replaces the header/footer instead of stacking a second copy', async () => {
  const eerste = await pdfMet(2);
  await schrijfKopVoeten(eerste, [kopVoet()], { titel: 'Set', paginaBereik });
  const bytes1 = await eerste.save();

  // Tweede save, zoals de saver hem doet: de bekende ids vervangen.
  const tweede = await PDFDocument.load(bytes1);
  const fontsVoor = tweede.getPage(0).node.Resources().lookup(PDFName.of('Font')).keys().length;
  const bekend = vindKopVoetIds(tweede);
  assert.deepEqual([...bekend], ['wm-test']);
  await schrijfKopVoeten(tweede, [kopVoet({ headerRight: 'Sheet {page}', batesPrefix: 'NEW' })], { vervang: bekend, titel: 'Set', paginaBereik });
  const bytes2 = await tweede.save();
  const paginas = await tekstVolgensPdfJs(bytes2);
  assert.deepEqual(teksten(paginas[0]).sort(), ['Inhoud 1', 'NEW000001', 'Set', 'Sheet 1'].sort());
  assert.deepEqual(teksten(paginas[1]).sort(), ['Inhoud 2', 'NEW000002', 'Set', 'Sheet 2'].sort());
  const herladen = await PDFDocument.load(bytes2);
  assert.equal(kopVoetStreamsOp(herladen, 0), 1);
  // Ook het font van de vorige versie gaat uit de resources: geen groei per save.
  assert.equal(herladen.getPage(0).node.Resources().lookup(PDFName.of('Font')).keys().length, fontsVoor);
});

test('removing the header/footer and saving takes it out of the file; definitions round-trip', async () => {
  const pdf = await pdfMet(2);
  await schrijfKopVoeten(pdf, [kopVoet(), kopVoet({ id: 'wm-uit', enabled: false, footerRight: 'X' })], { paginaBereik });
  const terug = await PDFDocument.load(await pdf.save());
  const defs = leesKopVoetDefinities(terug);
  assert.deepEqual(defs.map((d) => [d.id, d.enabled]), [['wm-test', true], ['wm-uit', false]]);
  assert.equal(defs[0].batesPrefix, 'ABC');
  assert.equal(defs[0].type, 'headerFooter');
  // Een uitgeschakelde kop-/voettekst staat in de lijst maar niet op de pagina's.
  assert.deepEqual([...vindKopVoetIds(terug)], ['wm-test']);

  await schrijfKopVoeten(terug, [], { vervang: vindKopVoetIds(terug), paginaBereik });
  const bytes = await terug.save();
  const leeg = await PDFDocument.load(bytes);
  assert.deepEqual(leesKopVoetDefinities(leeg), []);
  assert.equal(leeg.catalog.lookup(PDFName.of('OPS_KopVoet')), undefined);
  assert.deepEqual((await tekstVolgensPdfJs(bytes)).map(teksten), [['Inhoud 1'], ['Inhoud 2']]);
});

test('a header/footer the document does not know about is left alone', async () => {
  const pdf = await pdfMet(1);
  await schrijfKopVoeten(pdf, [kopVoet({ id: 'wm-vreemd', headerRight: 'Vreemd' })], { paginaBereik });
  const terug = await PDFDocument.load(await pdf.save());
  const behouden = leesKopVoetDefinities(terug);
  await schrijfKopVoeten(terug, [kopVoet({ id: 'wm-nieuw', headerRight: 'Nieuw', headerLeft: '' })], { vervang: new Set(), behouden, paginaBereik });
  const bytes = await terug.save();
  const tekst = teksten((await tekstVolgensPdfJs(bytes))[0]);
  assert.ok(tekst.includes('Vreemd') && tekst.includes('Nieuw'));
  assert.deepEqual(leesKopVoetDefinities(await PDFDocument.load(bytes)).map((d) => d.id), ['wm-vreemd', 'wm-nieuw']);
});

test('on a page with /Rotate 90 the header sits at the top of the page as it is shown', async () => {
  const pdf = await pdfMet(1, { rotatie: 90 });
  await schrijfKopVoeten(pdf, [kopVoet({ headerLeft: 'Kop', footerCenter: '' })], { paginaBereik });
  const [pagina] = await tekstVolgensPdfJs(await pdf.save());
  const kop = pagina.find((i) => i.tekst === 'Kop');
  assert.equal(kop.breedte, 842);
  assert.ok(Math.abs(kop.x - 40) < 1 && Math.abs(kop.y - 30) < 1, `${kop.x},${kop.y}`);
});

test('text outside WinAnsi does not break the save', async () => {
  const pdf = await pdfMet(1);
  await schrijfKopVoeten(pdf, [kopVoet({ headerLeft: '图纸 € ok', footerCenter: '' })], { paginaBereik });
  const tekst = teksten((await tekstVolgensPdfJs(await pdf.save()))[0]).join(' ');
  assert.match(tekst, /€ ok/);
});

test('the view bytes lose the header/footer streams but keep the page content', async () => {
  const pdf = await pdfMet(2);
  await schrijfKopVoeten(pdf, [kopVoet()], { paginaBereik });
  const met = await pdf.save();
  const zonder = await zonderKopVoetStromen(met);
  assert.deepEqual((await tekstVolgensPdfJs(zonder)).map(teksten), [['Inhoud 1'], ['Inhoud 2']]);
  const bare = await (await pdfMet(1)).save();
  assert.equal(await zonderKopVoetStromen(bare), bare);
  assert.equal(verwijderKopVoetStromen(await PDFDocument.load(met), new Set()), 0);
});

test('the screen skips a header/footer only while it is in the file being shown', () => {
  const wm = { uitBestand: true };
  assert.equal(kopVoetInWeergave({ _kopVoetBron: 'a.pdf', filePath: 'a.pdf' }, wm), true);
  assert.equal(kopVoetInWeergave({ _kopVoetBron: 'a.pdf', filePath: 'opds-edit-1.pdf' }, wm), false);
  assert.equal(kopVoetInWeergave({ _kopVoetBron: null, filePath: 'a.pdf' }, wm), false);
  assert.equal(kopVoetInWeergave({ _kopVoetBron: 'a.pdf', filePath: 'a.pdf' }, { uitBestand: false }), false);
});

test('every locale has the Bates labels', () => {
  const locales = new URL('../i18n/locales/', import.meta.url);
  for (const locale of readdirSync(locales)) {
    const hf = JSON.parse(readFileSync(new URL(`${locale}/dialogs.json`, locales), 'utf8')).headerFooter;
    for (const key of ['bates', 'batesHint', 'batesPrefix', 'batesStart', 'batesDigits', 'batesSuffix']) {
      assert.ok(hf[key]?.trim(), `${locale}: ${key}`);
    }
    assert.match(hf.batesHint, /\{bates\}/, locale);
  }
});
