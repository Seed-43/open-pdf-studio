// Export the active document as an `.ifcreport` — an IFCX-style JSON
// container that pairs the source PDF (base64) with every annotation,
// where the drafting components are mapped onto IFC classes:
//
//   wall                     → IfcWall        (dikte, materiaal, as start→end)
//   vloer-* parametric       → IfcSlab        (systeem + type, ware maat)
//   staal-* parametric       → IfcMember      (profiel + maat; name = maat,
//                                              e.g. "K100/5")
//   ifc-space parametric     → IfcSpace       (naam/nummer)
//   stramien parametric      → IfcGrid
//   measure* / overige       → IfcAnnotation
//
// The format is deliberately a single self-contained JSON document (ifcx
// "entities + attributes" shape) so downstream tooling can read the report
// without needing the original PDF next to it.

import { getActiveDocument } from '../core/state.js';
import { ifcEntityFor } from './ifc-entity.js';
import i18next from '../i18n/config.js';

function _b64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function exportIfcReport() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) {
    alert(i18next.t('noDocumentOpen'));
    return;
  }

  // Read the CURRENT file bytes from disk (annotations live in the report
  // itself — the embedded PDF is the underlying drawing).
  let pdfB64 = null;
  try {
    if (doc.filePath && window.__TAURI__?.fs) {
      const bytes = await window.__TAURI__.fs.readFile(doc.filePath);
      pdfB64 = _b64(new Uint8Array(bytes));
    }
  } catch (e) {
    console.warn('[ifc-export] PDF embed failed (report continues without):', e);
  }

  const pages = [];
  const pageCount = doc.pdfDoc?.numPages ?? 1;
  for (let p = 1; p <= pageCount; p++) {
    const dims = doc.pageDims?.[p];
    pages.push({ num: p, widthPt: dims?.widthPt ?? null, heightPt: dims?.heightPt ?? null });
  }

  const entities = (doc.annotations || []).map(ifcEntityFor);
  const counts = {};
  for (const e of entities) counts[e.class] = (counts[e.class] || 0) + 1;

  const report = {
    header: {
      format: 'ifcx-report',
      version: '1.0',
      generator: 'open-pdf-studio',
      created: new Date().toISOString(),
      source: doc.fileName || null,
      units: 'pt (1/72 inch); real-world sizes in mm where noted',
    },
    document: { fileName: doc.fileName || null, pageCount, pages },
    summary: counts,
    entities,
    pdf: pdfB64
      ? { mimeType: 'application/pdf', encoding: 'base64', data: pdfB64 }
      : null,
  };

  // Save-as dialog → .ifcreport
  try {
    const dlg = window.__TAURI__?.dialog;
    if (!dlg) throw new Error('dialog API unavailable');
    const suggested = (doc.fileName || 'document').replace(/\.pdf$/i, '') + '.ifcreport';
    const target = await dlg.save({
      title: i18next.t('ifcExport.saveTitle', { ns: 'dialogs' }),
      defaultPath: suggested,
      filters: [{ name: 'IFC report', extensions: ['ifcreport'] }],
    });
    if (!target) return;
    try { await window.__TAURI__.core.invoke('allow_fs_scope', { path: target }); } catch {}
    await window.__TAURI__.fs.writeTextFile(target, JSON.stringify(report));
    console.log('[ifc-export] geschreven:', target, `(${entities.length} entiteiten)`);
  } catch (e) {
    console.error('[ifc-export] save failed:', e);
    alert(i18next.t('ifcExport.failed', { ns: 'dialogs', error: e?.message ?? e }));
  }
}
