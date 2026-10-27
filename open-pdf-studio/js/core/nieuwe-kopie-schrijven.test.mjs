// Exports that promise a NEW file must write with writeBinaryFileNew (refuses
// an existing file, also one that appears after the check) instead of an
// existence check followed by a replacing write. A PDF with a JSON report is
// written first, so a failed PDF never leaves a report behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bron = (pad) => readFileSync(new URL(`../${pad}`, import.meta.url), 'utf8');
const services = [
  'pdf/hidden-information-service.js',
  'pdf/print-preflight-service.js',
  'pdf/form-recognition-service.js',
  'pdf/portfolio-service.js',
  'sheet-links/service.js',
  'approval-routing/service.js',
];

test('new-copy exports never use a replacing write', () => {
  for (const pad of services) {
    const tekst = bron(pad);
    assert.ok(!/writeBinaryFileAtomic\s*\(/.test(tekst), `${pad} uses writeBinaryFileAtomic`);
    assert.ok(/writeBinaryFileNew\s*\(|writeDownloadedFileNew\s*\(/.test(tekst), `${pad} writes with a no-replace writer`);
  }
});

test('the PDF is written before its report', () => {
  for (const pad of ['pdf/hidden-information-service.js', 'pdf/print-preflight-service.js']) {
    const tekst = bron(pad);
    const pdf = tekst.search(/writeBinaryFileNew\(path\s*,/);
    const report = tekst.search(/writeBinaryFileNew\(reportPath\s*,/);
    assert.ok(pdf >= 0 && report >= 0, `${pad} writes PDF and report`);
    assert.ok(pdf < report, `${pad} writes the report after the PDF`);
  }
});
