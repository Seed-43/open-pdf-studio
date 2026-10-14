import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument } from "pdf-lib";
import { schrijfKopVoeten, vindKopVoetIds } from "./saver/kopvoet.js";

// Kop-/voetteksten na een paginabewerking (#375): stonden ze als
// pagina-inhoud in de weergave, dan gaan ze uit de nieuwe werkkopie — het
// scherm tekent ze zelf, met de nieuwe paginanummers.
register("./page-manager-test-hooks.mjs", import.meta.url);
const pm = await import("./page-manager.js");

const SLEUTEL = "geheugen/document.pdf";

async function metKopVoet(aantal) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) pdf.addPage([200, 200]);
  await schrijfKopVoeten(pdf, [{
    id: "wm-1", type: "headerFooter", enabled: true, pageRange: "all", headerCenter: "Page {page} of {pages}",
  }], { paginaBereik: () => [] });
  return new Uint8Array(await pdf.save());
}

function opstelling(bytes, kopVoetBron) {
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: "doc-1", filePath: SLEUTEL, pdfDoc: { numPages: 3, destroy() {} },
    annotations: [], pageRotations: {}, currentPage: 1, _kopVoetBron: kopVoetBron,
  };
  globalThis.window = { __TAURI__: {} };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => true,
      getDocument: ({ data }) => ({ promise: PDFDocument.load(data).then((d) => ({ numPages: d.getPageCount(), destroy() {} })) }),
      setViewMode: async () => {},
      recordPageStructure: () => {},
    },
  };
  return { doc, bytesNu: () => cache.get(SLEUTEL) };
}

test("deleting a page from a view that shows baked header/footers drops them from the working copy", async () => {
  const o = opstelling(await metKopVoet(3), SLEUTEL);
  await pm.deletePages([1]);
  const nieuw = await PDFDocument.load(o.bytesNu());
  assert.equal(nieuw.getPageCount(), 2);
  assert.deepEqual([...vindKopVoetIds(nieuw)], []);
  assert.equal(o.doc._kopVoetBron, null);
});

test("without baked header/footers in the view the page content is left as it is", async () => {
  const o = opstelling(await metKopVoet(3), "een/ander/bestand.pdf");
  await pm.deletePages([1]);
  assert.deepEqual([...vindKopVoetIds(await PDFDocument.load(o.bytesNu()))], ["wm-1"]);
  assert.equal(o.doc._kopVoetBron, "een/ander/bestand.pdf");
});
