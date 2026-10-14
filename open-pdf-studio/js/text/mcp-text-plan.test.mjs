// De regels achter app_replace_text en app_translate_page (#507): toetsen,
// passend maken en de proef op een kopie, met synthetische PDF's.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageTextSpans } from './mcp-page-text.js';
import {
  parseSpanId, vervangingVormFout, planVervanging, pasGrootte, proefOpKopie, MAX_VERVANGINGEN,
} from './mcp-text-plan.js';

const span = (extra = {}) => ({
  id: 'doc-1:p2:i0-6', text: 'Welcome', fontName: 'g_d0_f1', fontFamily: 'sans-serif', fontSize: 24,
  rotation: 0, color: '#991a33', pdfAnchor: { x: 50, y: 160 }, pdfWidth: 96,
  bbox: { x: 50, y: 60, width: 96, height: 24 }, ...extra,
});
const gelezen = (spans = [span()]) => ({ ok: true, documentId: 'doc-1', page: 2, spans });
const item = (extra = {}) => ({ spanId: 'doc-1:p2:i0-6', expectedText: 'Welcome', newText: 'Welkom', ...extra });

test('de span-id draagt document en pagina; de vorm van een vervanging wordt getoetst', () => {
  assert.deepEqual(parseSpanId('a:b:p3:i4-9'), { documentId: 'a:b', page: 3 });
  assert.equal(parseSpanId('kapot'), null);
  assert.equal(vervangingVormFout(item()), null);
  assert.match(vervangingVormFout({ spanId: 'x' }), /required strings/);
  assert.match(vervangingVormFout(item({ newText: 'twee\nregels' })), /one line at a time/);
  assert.match(vervangingVormFout(item({ spanId: 'kapot' })), /invalid spanId/);
  assert.equal(MAX_VERVANGINGEN, 500);
});

test('een vervanging wordt getoetst tegen de gelezen pagina en open bewerkingen', () => {
  const ok = planVervanging(gelezen(), item(), []);
  assert.equal(ok.error, undefined);
  assert.equal(ok.textColor, '#991a33');
  assert.equal(ok.record.newText, 'Welkom');
  assert.equal(ok.record.mcpSpanId, 'doc-1:p2:i0-6');
  assert.equal(ok.record.page, 2);
  assert.equal(ok.record.fontFamily, 'Helvetica', 'sans-serif is geen schreefletter');
  assert.equal(planVervanging(gelezen([span({ fontFamily: 'serif' })]), item(), []).record.fontFamily, 'TimesRoman');
  assert.deepEqual(planVervanging(gelezen(), item({ newText: 'Welcome' }), []), { unchanged: true });
  assert.match(planVervanging(gelezen(), item({ spanId: 'doc-9:p2:i0-6' }), []).error, /different document/);
  assert.match(planVervanging(gelezen(), item({ spanId: 'doc-1:p3:i0-6' }), []).error, /different page/);
  assert.match(planVervanging(gelezen(), item({ expectedText: 'Welkom!' }), []).error, /span changed/);
  assert.match(planVervanging(gelezen([span({ color: null })]), item(), []).error, /provide color/);
  assert.equal(planVervanging(gelezen([span({ color: null })]), item({ color: '#000000' }), []).textColor, '#000000');
  assert.match(planVervanging(gelezen(), item({ color: 'rood' }), []).error, /#RRGGBB/);
  assert.match(planVervanging(gelezen(), item(), [{ page: 2, mcpSpanId: 'doc-1:p2:i0-6' }]).error, /unsaved text edit/);
  assert.equal(planVervanging(gelezen(), item(), [{ page: 2, mcpSpanId: 'x', baked: true }]).error, undefined);
});

test('de vervanging krimpt tot ze in de oude breedte past, maar blijft leesbaar', () => {
  assert.deepEqual(pasGrootte(12, 50, 100), { fontSize: 12 });
  assert.ok(Math.abs(pasGrootte(12, 200, 100).fontSize - 12 * 0.49) < 1e-9);
  assert.match(pasGrootte(12, 1000, 100).error, /does not fit/);
  assert.match(pasGrootte(12, 0, 100).error, /cannot be measured/);
});

async function synthetischePagina() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([420, 250]);
  page.drawRectangle({ x: 20, y: 20, width: 380, height: 210, borderWidth: 2, borderColor: rgb(0, 0, 1) });
  page.drawText('Welcome', { x: 50, y: 160, size: 24, font, color: rgb(0.6, 0.1, 0.2) });
  page.drawText('Opening hours', { x: 50, y: 110, size: 14, font });
  page.drawText('Keep this line', { x: 50, y: 60, size: 12, font });
  const bytes = await pdf.save();
  const gerenderd = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  const pagina = await gerenderd.getPage(1);
  const inhoud = await pagina.getTextContent();
  const spans = pageTextSpans(inhoud.items, inhoud.styles, pagina.getViewport({ scale: 1 }), 'doc-7', 1);
  await gerenderd.loadingTask.destroy();
  return { bytes, read: { ok: true, documentId: 'doc-7', page: 1, spans } };
}

test('meerdere regels van één pagina worden samen op één kopie beproefd', async () => {
  const { bytes, read } = await synthetischePagina();
  const regel = (tekst) => read.spans.find((s) => s.text === tekst);
  const plannen = [
    planVervanging(read, { spanId: regel('Welcome').id, expectedText: 'Welcome', newText: 'Welkom', color: '#000000' }, []),
    planVervanging(read, { spanId: regel('Opening hours').id, expectedText: 'Opening hours',
      newText: 'Openingstijden van de winkel', color: '#000000' }, []),
  ];
  assert.ok(plannen.every((p) => p.record), JSON.stringify(plannen));
  // Een niet-ingebed standaardlettertype kan niet ter plekke coderen: dan
  // meet de proef met het volledige terugvallettertype.
  const embedFont = async (doc) => ({ name: 'LiberationSans-Regular', font: await doc.embedFont(StandardFonts.Helvetica) });
  await proefOpKopie(Uint8Array.from(bytes), plannen, { embedFont });
  assert.deepEqual(plannen.map((p) => p.error), [undefined, undefined]);
  assert.equal(plannen[0].record.fontSize, 24, 'een kortere vertaling houdt haar grootte');
  assert.ok(plannen[1].record.fontSize < 14, 'een langere vertaling krimpt in de oude breedte');
  assert.ok(plannen[1].record.fontSize > 3);
  assert.ok(plannen.every((p) => typeof p.fontUsed === 'string' && typeof p.fontFallback === 'boolean'));
});

test('ontbrekende tekens in het lettertype gaan via een volledig lettertype, en een te lange regel faalt', async () => {
  const { bytes, read } = await synthetischePagina();
  const welkom = read.spans.find((s) => s.text === 'Welcome');
  const vreemd = planVervanging(read, { spanId: welkom.id, expectedText: 'Welcome', newText: '歡迎', color: '#000000' }, []);
  const lang = planVervanging(read, { spanId: read.spans.find((s) => s.text === 'Keep this line').id,
    expectedText: 'Keep this line', newText: 'x'.repeat(400), color: '#000000' }, []);
  const plannen = [vreemd, lang];
  await proefOpKopie(Uint8Array.from(bytes), plannen, {
    embedFont: async () => ({ name: 'NotoSansTC-Regular', font: { widthOfTextAtSize: (t, size) => t.length * size } }),
  });
  assert.equal(vreemd.error, undefined);
  assert.equal(vreemd.fontFallback, true);
  assert.equal(vreemd.fontUsed, 'NotoSansTC-Regular');
  assert.match(lang.error, /does not fit/);
});

test('app_translate_page staat in de brug, de Rust-server, de metatabel, tools.json en de manifest', () => {
  const REPO = new URL('../../../', import.meta.url);
  const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8');
  assert.ok(lees('open-pdf-studio/js/mcp-bridge.js').includes("'mcp:translate-page'"));
  assert.ok(lees('open-pdf-studio/src-tauri/src/mcp_server.rs').includes('"app_translate_page"'));
  assert.ok(lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs').includes('wijzigt("app_translate_page"'));
  const tools = JSON.parse(lees('mcp-stdio/tools.json'));
  const tool = tools.find((t) => t.name === 'app_translate_page');
  assert.ok(tool, 'in tools.json');
  assert.deepEqual(tool.inputSchema.required, ['replacements']);
  assert.deepEqual(tool.inputSchema.properties.replacements.items.required, ['spanId', 'expectedText', 'newText']);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.ok(JSON.parse(lees('mcpb/manifest.json')).tools.some((t) => t.name === 'app_translate_page'));
});
