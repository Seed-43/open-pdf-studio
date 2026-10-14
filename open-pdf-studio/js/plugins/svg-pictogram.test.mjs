// Strikte SVG-parser voor pictogrammen van extensies (#551): alleen een kleine
// subset gaat erdoor, en de host schrijft de SVG opnieuw uit de geparseerde
// boom. Er wordt niets "schoongemaakt": alles daarbuiten wordt geweigerd.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseerSvgPictogram, valideerPictogram } from './svg-pictogram.js';
import * as ribbonIcons from '../solid/data/ribbonIcons.js';

const geweigerd = (fn, patroon) => assert.throws(fn, (e) =>
  e.code === 'INVALID_CONTRIBUTION' && (!patroon || patroon.test(e.message)));

const GELDIG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
  + '<path d="M4 4h16v16H4z" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<g transform="translate(1 2) rotate(45)"><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></g>'
  + '<rect x="2" y="2" width="4" height="4" rx="1" fill="#ff0000"/>'
  + '<polyline points="1,2 3,4 5,6"/><polygon points="1 2 3 4 5 6" fill-rule="evenodd" opacity="0.5"/>'
  + '<ellipse cx="5" cy="5" rx="2" ry="1" stroke-dasharray="2 1" stroke="#00ff00aa"/>'
  + '</svg>';

test('een geldig 24x24-pictogram wordt identiek herschreven', () => {
  assert.equal(parseerSvgPictogram(GELDIG), GELDIG);
});

test('witruimte tussen elementen, enkele aanhalingstekens en xmlns worden genormaliseerd', () => {
  const invoer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 24 24'>\n  <path d='M1 1L2 2'></path>\n</svg>`;
  assert.equal(parseerSvgPictogram(invoer),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1L2 2"/></svg>');
});

test('verboden elementen en attributen worden geweigerd', () => {
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>'), /script/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><foreignObject/></svg>'), /foreignObject/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" onclick="x()"/></svg>'), /onclick/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" onload="x()"/></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><use href="#a"/></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path href="#a" d="M1 1"/></svg>'), /href/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path xlink:href="#a" d="M1 1"/></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24" style="color:red"><path d="M1 1"/></svg>'), /style/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path id="a" d="M1 1"/></svg>'), /id/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path class="a" d="M1 1"/></svg>'), /class/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24" d="M1 1"></svg>'), /d/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path viewBox="0 0 1 1"/></svg>'), /viewBox/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><svg viewBox="0 0 1 1"/></svg>'), /svg/);
});

test('kleuren: alleen none, currentColor en hex; geen url(...)', () => {
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" fill="url(#g)"/></svg>'), /fill/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" fill="red"/></svg>'), /fill/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" stroke="#12"/></svg>'), /stroke/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" transform="url(x)"/></svg>'), /transform/);
  assert.ok(parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" fill="none" stroke="currentColor"/></svg>'));
});

test('entiteiten, commentaar, tekst, CDATA, doctype en processing instructions worden geweigerd', () => {
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1&#x20;"/></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24">&amp;</svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><!-- x --></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24">tekst</svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><![CDATA[x]]></svg>'));
  geweigerd(() => parseerSvgPictogram('<!DOCTYPE svg><svg viewBox="0 0 24 24"></svg>'));
  geweigerd(() => parseerSvgPictogram('<?xml version="1.0"?><svg viewBox="0 0 24 24"></svg>'));
});

test('structuur: een viewBox met vier getallen, precies één wortel, goed genest', () => {
  geweigerd(() => parseerSvgPictogram('<svg><path d="M1 1"/></svg>'), /viewBox/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24"><path d="M1 1"/></svg>'), /viewBox/);
  geweigerd(() => parseerSvgPictogram('<g><path d="M1 1"/></g>'), /svg/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"></svg><svg viewBox="0 0 24 24"></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><g></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1"><circle r="1"/></path></svg>'));
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d="M1 1" d="M2 2"/></svg>'), /d/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24" xmlns="http://example.com/x"></svg>'), /xmlns/);
  geweigerd(() => parseerSvgPictogram('<svg viewBox="0 0 24 24"><path d=M1/></svg>'));
  geweigerd(() => parseerSvgPictogram(''));
  geweigerd(() => parseerSvgPictogram(42));
});

test('limieten: hooguit 8 KB en 200 elementen', () => {
  const pad = (n) => '<path d="M1 1"/>'.repeat(n);
  assert.ok(parseerSvgPictogram(`<svg viewBox="0 0 24 24">${pad(199)}</svg>`));
  geweigerd(() => parseerSvgPictogram(`<svg viewBox="0 0 24 24">${pad(200)}</svg>`), /200/);
  const lang = `<svg viewBox="0 0 24 24"><path d="M1 1${' 1'.repeat(4200)}"/></svg>`;
  assert.ok(lang.length > 8192);
  geweigerd(() => parseerSvgPictogram(lang), /8 KB/);
});

test('valideerPictogram: builtin, SVG-tekst, ontbrekend', () => {
  const builtin = valideerPictogram({ builtin: 'extensionsIcon' }, ribbonIcons);
  assert.equal(builtin, ribbonIcons.extensionsIcon);
  geweigerd(() => valideerPictogram({ builtin: 'bestaatNiet' }, ribbonIcons), /builtin/);
  geweigerd(() => valideerPictogram({ builtin: 'extensionsIcon', extra: 1 }, ribbonIcons));
  geweigerd(() => valideerPictogram({ builtin: '__proto__' }, ribbonIcons));
  assert.equal(valideerPictogram(GELDIG, ribbonIcons), GELDIG);
  assert.equal(valideerPictogram(undefined, ribbonIcons), null);
  geweigerd(() => valideerPictogram(12, ribbonIcons));
});
