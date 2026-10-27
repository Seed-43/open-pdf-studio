// The feature dialogs load on demand, and the compact bars and menus keep
// their released layout (source-level checks; the UI itself runs in the app).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const staticImports = (text) => [...text.matchAll(/^import\s+[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);

test('the feature dialogs and panels are not statically imported', () => {
  const host = staticImports(source('./DialogHost.jsx'));
  for (const name of [
    'OcrReviewDialog', 'DocumentWorkflowsDialog', 'DrawingSetsDialog', 'SheetLinksDialog',
    'ApprovalRoutingDialog', 'PortfolioDialog', 'FormRecognitionDialog', 'SymbolSearchDialog',
    'WorkbookBindingsDialog',
  ]) {
    assert.ok(!host.some((path) => path.endsWith(`/${name}.jsx`)), `${name} is loaded lazily`);
    assert.match(source('./DialogHost.jsx'), new RegExp(`const ${name} = lazy\\(`));
  }
  const properties = staticImports(source('./DocPropertiesDialog.jsx'));
  assert.ok(!properties.some((path) => /HiddenInformation|PrintPreflight/.test(path)));
  assert.ok(!staticImports(source('./FindBar.jsx')).some((path) => path.endsWith('/DocumentSearch.jsx')));
  assert.ok(!staticImports(source('./properties-panel/LocationSection.jsx'))
    .some((path) => path.endsWith('/spatial-zones-service.js')));
});

test('the find bar keeps its compact layout; extra searches sit in an options menu', () => {
  const bar = source('./FindBar.jsx');
  const firstRow = bar.indexOf('<div class="find-rows">');
  const barStart = bar.indexOf('<div class="find-bar"');
  assert.ok(!bar.slice(barStart, firstRow).includes('<button'), 'nothing in front of the rows');
  const menu = bar.slice(bar.indexOf('class="find-options-menu"'));
  assert.ok(menu.indexOf("t('symbolSearch')") > 0 && menu.indexOf("t('documentSearch.title')") > 0);
  assert.match(bar, /<Show when=\{documentSearchOpen\(\)\}>\s*<DocumentSearch \/>/);
  const css = source('../../../styles/find-bar.css');
  const own = css.slice(css.indexOf('.find-options {'));
  assert.ok(!/border-radius:\s*[1-9]/.test(own), 'no rounded corners');
});

test('the new File menu items sit in the document group with their own icons', () => {
  const menu = source('./app-menu/AppMenu.jsx');
  const items = menu.slice(menu.indexOf('<div class="app-menu-items">'));
  const at = (label) => items.indexOf(`label={t('${label}')}`);
  for (const label of ['workflows', 'drawingSets', 'sheetLinks', 'approvalRouting']) {
    assert.ok(at(label) > at('docProperties'), `${label} after Document properties`);
    assert.ok(at(label) < at('preferences'), `${label} before Preferences`);
  }
  assert.ok(at('new') < at('workflows'), 'New/Open/Save stay first');
  assert.equal((items.match(/icon=\{ICONS\.docProperties\}/g) || []).length, 1, 'one docProperties icon');
});

test('the new panel buttons use the panel toolbar button classes', () => {
  const bare = /<button(?![^>]*class=)[^>]*onClick=\{\(\) => openDialog\(/;
  for (const panel of ['AttachmentsPanel', 'FormFieldsPanel', 'SchedulesPanel']) {
    assert.doesNotMatch(source(`./left-panel/panels/${panel}.jsx`), bare, panel);
  }
  assert.match(source('./left-panel/panels/AttachmentsPanel.jsx'), /class="attachments-toolbar-btn"\s+title=\{t\('leftPanel\.portfolio'\)\}/);
  assert.match(source('./left-panel/panels/FormFieldsPanel.jsx'), /class="attachments-toolbar-btn"\s+title=\{t\('leftPanel\.recognizeForm'\)\}/);
  assert.match(source('./left-panel/panels/SchedulesPanel.jsx'), /class="schedules-add-btn" title=\{t\('schedules\.workbookBindings'\)\}/);
});
