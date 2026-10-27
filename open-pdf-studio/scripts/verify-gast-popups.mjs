// Controle van #695 op de gebouwde gastbundel: geen popups en geen navigatie
// weg, wel zichtbare terugkoppeling.
//
//   npm run build:hosted
//   npm run verify:hosted-popups    (of: node scripts/verify-gast-popups.mjs [dist] [poort])
//
// 1. Zoekt in de bundel naar een bereikbare window.open en naar toewijzingen
//    aan (top.)location.
// 2. Zet de bundel in een iframe met
//    sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
//    op een andere oorsprong (zoals een gastsite) en laat in headless Chromium
//    zien dat een bijlage een download wordt en dat elke help-, website- en
//    PDF-link een melding met het adres geeft. Er mag geen popup komen en het
//    iframe en de pagina eromheen mogen niet weg-navigeren.
//
// Twee poorten: de bundel op <poort>, de gastpagina op <poort + 1>.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(hier, '..');
const DIST = path.resolve(process.argv[2] || path.join(app, 'dist'));
const POORT = Number(process.argv[3] || process.env.OPDS_VERIFY_PORT || 3611);
const SANDBOX = 'allow-scripts allow-same-origin allow-downloads allow-modals';

// ── 1. Zoeken in de bundel ──────────────────────────────────────────────────

// Een AANROEP van open op een venster, of een toewijzing aan location. Een
// tekst als "window.open" in een lijst (PDF.js-worker: herkenning van
// JavaScript-acties in een PDF) is geen aanroep.
const VERBODEN = [
  ['window.open(…)', /\b(window|globalThis|self|top|parent)\s*\.\s*open\s*\(/g],
  ['location = …', /\b(top|parent|window|self)\s*\.\s*location\s*(\.\s*href\s*)?=(?!=)/g],
  ['location.assign/replace', /\blocation\s*\.\s*(assign|replace)\s*\(/g],
];

function alleBestanden(map) {
  const uit = [];
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, e.name);
    if (e.isDirectory()) uit.push(...alleBestanden(p));
    else uit.push(p);
  }
  return uit;
}

export function zoekInBundel(dist = DIST) {
  const treffers = [];
  for (const bestand of alleBestanden(dist)) {
    if (!/\.(m?js|html?)$/i.test(bestand)) continue;
    const tekst = fs.readFileSync(bestand, 'utf8');
    for (const [naam, re] of VERBODEN) {
      for (const m of tekst.matchAll(re)) {
        const rel = path.relative(dist, bestand).split(path.sep).join('/');
        treffers.push(`${rel}: ${naam}: …${tekst.slice(Math.max(0, m.index - 60), m.index + 60)}…`);
      }
    }
  }
  return treffers;
}

// ── 2. Testbestand ──────────────────────────────────────────────────────────

const BIJLAGE = 'rapport.html';
const PDF_LINK = 'https://example.org/handleiding';

async function maakPdf() {
  const { PDFDocument, PDFName, PDFString, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pagina.drawText('PDF met bijlage en link (#695)', { x: 50, y: 760, size: 18, font });
  pagina.drawText(PDF_LINK, { x: 50, y: 705, size: 14, font });
  await pdf.attach(new TextEncoder().encode('<h1>bijlage</h1><script>alert(1)</script>'), BIJLAGE, {
    mimeType: 'text/html',
    description: 'HTML-bijlage',
  });
  const link = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [45, 695, 330, 725],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(PDF_LINK) },
  });
  pagina.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(link)]));
  return Buffer.from(await pdf.save());
}

// ── Servers ─────────────────────────────────────────────────────────────────

const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

function bundelServer(dist) {
  return http.createServer((req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let bestand = path.join(dist, pad.endsWith('/') ? `${pad}index.html` : pad);
    if (!bestand.startsWith(dist) || !fs.existsSync(bestand) || fs.statSync(bestand).isDirectory()) {
      bestand = path.join(dist, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(bestand).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(bestand).pipe(res);
  });
}

function gastServer(bundelUrl) {
  const pagina = `<!doctype html><meta charset="utf-8"><title>gastsite</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe id="app" src="${bundelUrl}" sandbox="${SANDBOX}"></iframe>`;
  return http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pagina);
  });
}

const luister = (server, poort) => new Promise((ok, fout) => {
  server.once('error', fout);
  server.listen(poort, '127.0.0.1', ok);
});

// ── Controle in Chromium ────────────────────────────────────────────────────

async function controleerInChromium(pdfBytes) {
  const { chromium } = await import('playwright');
  const bundelUrl = `http://127.0.0.1:${POORT}/`;
  const gastUrl = `http://127.0.0.1:${POORT + 1}/`;
  const servers = [bundelServer(DIST), gastServer(bundelUrl)];
  await luister(servers[0], POORT);
  await luister(servers[1], POORT + 1);

  const browser = await chromium.launch({ headless: true });
  const fouten = [];
  const verslag = [];
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
    const pagina = await context.newPage();
    // Pas ná de eigen pagina luisteren: elke nieuwe pagina daarna is een popup.
    const popups = [];
    context.on('page', (p) => popups.push(p.url() || 'about:blank'));
    pagina.on('popup', (p) => popups.push(p.url()));
    const consolefouten = [];
    pagina.on('pageerror', (e) => consolefouten.push(String(e)));
    const navigaties = [];
    pagina.on('framenavigated', (f) => navigaties.push(f.url()));

    await pagina.goto(gastUrl);
    const iframe = await pagina.waitForSelector('#app');
    const frame = await iframe.contentFrame();
    await frame.waitForSelector('#left-panel', { timeout: 60000 });
    const sandbox = await iframe.getAttribute('sandbox');
    verslag.push(`iframe sandbox="${sandbox}"`);
    // De gastbundel zet geen gastobject neer; de bouw alleen moet volstaan.
    verslag.push(`gastobject aanwezig: ${await frame.evaluate(() => !!window.__OPDS_HOST__)}`);
    const navigatiesNaLaden = navigaties.length;

    // PDF openen zoals een gebruiker hem in het venster sleept (#456).
    await frame.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'bijlage-en-link.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, pdfBytes.toString('base64'));
    await frame.waitForSelector('a.pdf-link', { state: 'attached', timeout: 60000 });

    const melding = async (wat) => {
      const dlg = await frame.waitForSelector('.message-dialog', { timeout: 10000 }).catch(() => null);
      if (!dlg) { fouten.push(`${wat}: geen melding`); return null; }
      const tekst = (await dlg.innerText()).replace(/\s+/g, ' ').trim();
      const adres = await frame.$eval('.message-dialog', (d) => d.querySelector('.message-dialog-address')?.value ?? null);
      await frame.click('.message-dialog .pref-btn-primary');
      await frame.waitForSelector('.message-dialog', { state: 'detached', timeout: 5000 });
      return { tekst, adres };
    };

    // a. De bijlage: openen wordt een download.
    await frame.click('.left-panel-tab[data-panel="attachments"]');
    const item = await frame.waitForSelector('.attachment-list-item', { timeout: 20000 });
    const [download] = await Promise.all([
      pagina.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      item.dblclick(),
    ]);
    if (!download) fouten.push('bijlage: geen download');
    else {
      const naam = download.suggestedFilename();
      const inhoud = fs.readFileSync(await download.path(), 'utf8');
      verslag.push(`bijlage: download "${naam}" (${inhoud.length} bytes)`);
      if (naam !== BIJLAGE) fouten.push(`bijlage: download heet "${naam}"`);
      if (!inhoud.includes('<h1>bijlage</h1>')) fouten.push('bijlage: inhoud klopt niet');
    }
    const mBijlage = await melding('bijlage');
    if (mBijlage) verslag.push(`bijlage: melding "${mBijlage.tekst}"`);
    if (mBijlage && !mBijlage.tekst.includes(BIJLAGE)) fouten.push('bijlage: melding noemt het bestand niet');

    // b. Ook de knop "Openen" in de werkbalk van het paneel.
    await item.click();
    const [download2] = await Promise.all([
      pagina.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      frame.click('.attachments-toolbar-btn:nth-child(2)'),
    ]);
    if (!download2) fouten.push('bijlage (werkbalk): geen download');
    await melding('bijlage (werkbalk)');

    // c. Een link in de PDF.
    await frame.$eval('a.pdf-link', (a) => a.click());
    if (process.env.OPDS_VERIFY_SCREENSHOT) {
      await frame.waitForSelector('.message-dialog');
      await pagina.screenshot({ path: process.env.OPDS_VERIFY_SCREENSHOT });
    }
    const mPdf = await melding('PDF-link');
    verslag.push(`PDF-link: adres in melding = ${mPdf?.adres}`);
    if (mPdf && mPdf.adres !== PDF_LINK) fouten.push(`PDF-link: adres "${mPdf.adres}"`);

    // d. Dezelfde link vanuit het paneel Koppelingen (dubbelklik).
    await frame.click('.left-panel-tab[data-panel="links"]');
    const linkItem = await frame.waitForSelector('#links-panel .link-list-item', { timeout: 20000 }).catch(() => null);
    if (!linkItem) fouten.push('paneel Koppelingen: geen link');
    else {
      await linkItem.dblclick();
      const mPaneel = await melding('paneel Koppelingen');
      verslag.push(`paneel Koppelingen: adres in melding = ${mPaneel?.adres}`);
      if (mPaneel && mPaneel.adres !== PDF_LINK) fouten.push(`paneel Koppelingen: adres "${mPaneel.adres}"`);
    }

    // e. Help: Over → website, GitHub, e-mail.
    await frame.click('.ribbon-tab[data-tab="help"], [data-tab="help"]');
    await frame.click('#ribbon-about');
    await frame.waitForSelector('.bs-about-link');
    const aantalLinks = await frame.$$eval('.bs-about-link', (l) => l.length);
    for (let i = 0; i < aantalLinks; i++) {
      if (!(await frame.$('.bs-about-link'))) {
        await frame.click('#ribbon-about');
        await frame.waitForSelector('.bs-about-link');
      }
      const label = (await frame.$$eval('.bs-about-link', (l, n) => l[n].textContent.trim(), i));
      await frame.$$eval('.bs-about-link', (l, n) => l[n].click(), i);
      const m = await melding(`Over: ${label}`);
      verslag.push(`Over: "${label}" → melding met adres ${m?.adres}`);
      if (m && !m.adres) fouten.push(`Over: "${label}" toont geen adres`);
    }

    // f. Help-knoppen die een andere host nodig hebben staan uit, met uitleg.
    for (const id of ['ribbon-whats-new', 'ribbon-check-updates']) {
      const knop = await frame.$(`#${id}`);
      if (!knop) continue;
      const uit = await knop.isDisabled();
      const titel = await knop.getAttribute('title');
      verslag.push(`${id}: ${uit ? 'uit' : 'AAN'}, tooltip "${titel}"`);
      if (!uit || !titel) fouten.push(`${id}: staat aan of geeft geen uitleg`);
    }

    // Geen popups, en niets navigeerde weg.
    if (popups.length) fouten.push(`popups: ${popups.join(', ')}`);
    const laterNavigaties = navigaties.slice(navigatiesNaLaden);
    if (laterNavigaties.length) fouten.push(`navigatie na het laden: ${laterNavigaties.join(', ')}`);
    if (pagina.url() !== gastUrl) fouten.push(`gastpagina navigeerde naar ${pagina.url()}`);
    if (!frame.url().startsWith(bundelUrl)) fouten.push(`iframe navigeerde naar ${frame.url()}`);
    verslag.push(`popups: ${popups.length}, navigaties na laden: ${laterNavigaties.length}`);
    if (consolefouten.length) verslag.push(`paginafouten: ${consolefouten.slice(0, 5).join(' | ')}`);
  } finally {
    await browser.close();
    for (const s of servers) s.close();
  }
  return { fouten, verslag };
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`Geen bundel in ${DIST}. Eerst: npm run build:hosted`);
    process.exit(2);
  }
  let mislukt = false;
  const treffers = zoekInBundel();
  if (treffers.length) {
    mislukt = true;
    console.error('Bereikbare popup of navigatie in de bundel:');
    for (const t of treffers) console.error(`  ${t}`);
  } else {
    console.log('bundel: geen window.open-aanroep en geen location-toewijzing');
  }
  const { fouten, verslag } = await controleerInChromium(await maakPdf());
  for (const r of verslag) console.log(`  ${r}`);
  if (fouten.length) {
    mislukt = true;
    console.error('Mislukt:');
    for (const f of fouten) console.error(`  ${f}`);
  }
  console.log(mislukt ? 'RESULTAAT: MISLUKT' : 'RESULTAAT: OK');
  process.exit(mislukt ? 1 : 0);
}
