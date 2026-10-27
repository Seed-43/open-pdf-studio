import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleResultToCsv } from './schedule-csv.js';

const result = (rows) => ({
  itemize: true,
  columns: [{ key: 'name', label: 'Name' }, { key: 'length', label: 'Length', unit: 'm', decimals: 2 }],
  groups: [{ key: null, rows: rows.map((vals) => ({ vals })), subtotals: { length: -1.5 } }],
  grandTotals: { length: -1.5 },
});

test('cells that a spreadsheet would run as a formula are escaped', () => {
  const csv = scheduleResultToCsv(result([
    { name: '=HYPERLINK("http://example.invalid","x")', length: 1 },
    { name: '+1+1', length: 2 },
    { name: '-2+3', length: 3 },
    { name: '@SUM(A1)', length: 4 },
    { name: '\t=1', length: 5 },
    { name: '\r=1', length: 6 },
  ]));
  const lines = csv.split('\n');
  assert.equal(lines[1], `"'=HYPERLINK(""http://example.invalid"",""x"")",1.00`);
  assert.equal(lines[2].split(',')[0], `"'+1+1"`);
  assert.equal(lines[3].split(',')[0], `"'-2+3"`);
  assert.equal(lines[4].split(',')[0], `"'@SUM(A1)"`);
  assert.equal(lines[5].split(',')[0], `"'\t=1"`);
  assert.ok(lines.slice(1).every((l) => !/^[=+@-]/.test(l)), csv);
  assert.equal(lines[6].split(',')[0], `"'\r=1"`);
});

test('plain text and numbers, also negative totals, stay as they are', () => {
  const csv = scheduleResultToCsv(result([{ name: 'Wall A', length: -2 }]));
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Name,Length (m)');
  assert.equal(lines[1], 'Wall A,-2.00');
  assert.equal(lines[2], 'Subtotal,-1.50 m');
  assert.equal(lines[3], 'Grand total,-1.50 m');
});
