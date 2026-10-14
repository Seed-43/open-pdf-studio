// Register van linttabbladen van extensies (#551): validatie, namespacing,
// limieten, opdrachten per actie/keuze, het weergavemodel voor de host en het
// opruimen bij dispose of deactiveren.

import assert from 'node:assert/strict';
import test from 'node:test';

import { maakLintRegister } from './ribbon-tab-registry.js';
import { maakOpdrachtRegister } from './extension-commands.js';
import { maakBijdrageScope, _wisEigenaars, isStriktExtensieId } from './extension-contributions.js';
import * as ribbonIcons from '../solid/data/ribbonIcons.js';

const SVG = '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="M4 4h16v16H4z"/></svg>';

function opzet() {
  _wisEigenaars();
  const opdrachten = maakOpdrachtRegister();
  let actief = 'home';
  const reg = maakLintRegister({ opdrachten, iconen: ribbonIcons });
  reg.koppelLint({ lees: () => actief, zet: (id) => { actief = id; } });
  return { reg, opdrachten, actief: () => actief, zetActief: (id) => { actief = id; } };
}

const descriptor = (extra = {}) => ({
  id: 'main',
  label: { en: 'Frames', nl: 'Kozijnen' },
  icon: SVG,
  groups: [{
    id: 'place', label: { en: 'Place', nl: 'Plaatsen' },
    items: [
      { type: 'action', id: 'frame', label: 'Kozijn', title: 'Plaats een kozijn', icon: SVG, onRun: async () => 'ok' },
      { type: 'dropdown', id: 'profile', label: 'Profiel',
        options: [{ id: 'wood', label: 'Hout' }, { id: 'alu', label: 'Aluminium' }], value: 'wood',
        onChange: async () => {} },
      { type: 'status', id: 'count', label: 'Geplaatst', text: '0' },
    ],
  }],
  ...extra,
});

const fout = (code) => (e) => e.code === code;

test('strikte extensie-id\'s', () => {
  for (const id of ['a', 'nl.voorbeeld.kozijnen', 'a-b.c1', 'x9']) assert.equal(isStriktExtensieId(id), true, id);
  for (const id of ['', '.', '..', 'C:', 'a/b', 'A', 'con', 'con.x', 'lpt1', '-a', 'a-', 'a..b', 'a.', 'x'.repeat(65)]) {
    assert.equal(isStriktExtensieId(id), false, id);
  }
});

test('lokaal en volledig id; een vreemd voorvoegsel wordt geweigerd', () => {
  const { reg } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  const h = reg.registreer(scope, descriptor());
  assert.equal(h.id, 'nl.voorbeeld.kozijnen.main');
  assert.equal(reg.heeft('nl.voorbeeld.kozijnen.main'), true);
  const h2 = reg.registreer(scope, descriptor({ id: 'nl.voorbeeld.kozijnen.tweede', groups: [{ id: 'g', label: 'G',
    items: [{ type: 'status', id: 'other', label: 'S', text: '' }] }] }));
  assert.equal(h2.id, 'nl.voorbeeld.kozijnen.tweede');
  assert.throws(() => reg.registreer(scope, descriptor({ id: 'nl.ander.main' })), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope, descriptor({ id: 'Main' })), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope, descriptor({ id: 'a.b' })), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(maakBijdrageScope('Oud_Id'), descriptor()), fout('INVALID_CONTRIBUTION'),
    'een oud id dat niet aan de strikte regel voldoet, krijgt geen lint');
});

test('dubbele tab- en item-id\'s geven CONTRIBUTION_CONFLICT; er wordt dan niets geregistreerd', () => {
  const { reg, opdrachten } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  reg.registreer(scope, descriptor());
  assert.throws(() => reg.registreer(scope, descriptor()), fout('CONTRIBUTION_CONFLICT'));
  // Een tweede tabblad dat een item-id hergebruikt (het id komt terug in het opdracht-id).
  assert.throws(() => reg.registreer(scope, descriptor({ id: 'tweede' })), fout('CONTRIBUTION_CONFLICT'));
  assert.equal(reg.heeft('nl.voorbeeld.kozijnen.tweede'), false);
  // Dubbel binnen één descriptor.
  const dubbel = descriptor({ id: 'derde', groups: [{ id: 'g', label: 'G', items: [
    { type: 'status', id: 'x', label: 'A', text: '' }, { type: 'status', id: 'x', label: 'B', text: '' }] }] });
  assert.throws(() => reg.registreer(scope, dubbel), fout('CONTRIBUTION_CONFLICT'));
  assert.equal(opdrachten.lijst('en').length, 3, 'alleen de opdrachten van het eerste tabblad');
});

test('limieten: 3 tabbladen, 8 groepen, 12 items, 50 opties en labellengtes', () => {
  const { reg } = opzet();
  const scope = maakBijdrageScope('nl.a');
  const leeg = (id) => ({ id, label: id, groups: [{ id: 'g', label: 'G', items: [{ type: 'status', id: `s-${id}`, label: 'S', text: '' }] }] });
  reg.registreer(scope, leeg('a1'));
  reg.registreer(scope, leeg('a2'));
  reg.registreer(scope, leeg('a3'));
  assert.throws(() => reg.registreer(scope, leeg('a4')), fout('LIMIT_EXCEEDED'));
  const scope2 = maakBijdrageScope('nl.b');
  const groepen = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, label: 'G', items: [{ type: 'status', id: `s${i}`, label: 'S', text: '' }] }));
  assert.throws(() => reg.registreer(scope2, { id: 't', label: 'T', groups: groepen(9) }), fout('LIMIT_EXCEEDED'));
  reg.registreer(scope2, { id: 't', label: 'T', groups: groepen(8) });
  const items = (n) => Array.from({ length: n }, (_, i) => ({ type: 'status', id: `i${i}`, label: 'S', text: '' }));
  assert.throws(() => reg.registreer(scope2, { id: 'u', label: 'U', groups: [{ id: 'g', label: 'G', items: items(13) }] }), fout('LIMIT_EXCEEDED'));
  const opties = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
  assert.throws(() => reg.registreer(scope2, { id: 'v', label: 'V', groups: [{ id: 'g', label: 'G', items: [
    { type: 'dropdown', id: 'dd', label: 'D', options: opties(51), onChange: () => {} }] }] }), fout('LIMIT_EXCEEDED'));
  assert.throws(() => reg.registreer(scope2, { id: 'w', label: 'x'.repeat(25), groups: groepen(1) }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope2, { id: 'w', label: 'W', groups: [{ id: 'g', label: 'x'.repeat(41), items: items(1) }] }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope2, { id: 'w', label: 'W', groups: [{ id: 'g', label: 'G', items: [
    { type: 'status', id: 'st', label: 'S', text: 'x'.repeat(41) }] }] }), fout('INVALID_CONTRIBUTION'));
});

test('ongeldige descriptors: onbekende velden, soorten, pictogrammen en waarden', () => {
  const { reg } = opzet();
  const scope = maakBijdrageScope('nl.a');
  const met = (item) => ({ id: 't', label: 'T', groups: [{ id: 'g', label: 'G', items: [item] }] });
  for (const item of [
    { type: 'knop', id: 'a', label: 'A' },
    { type: 'action', id: 'a', label: 'A' }, // geen onRun
    { type: 'action', id: 'a', label: 'A', onRun() {}, style: 'color:red' },
    { type: 'action', id: 'a', label: 'A', onRun() {}, icon: '<svg viewBox="0 0 1 1"><script/></svg>' },
    { type: 'action', id: 'a', label: 'A', onRun() {}, icon: { builtin: 'bestaatNiet' } },
    { type: 'action', id: 'a', label: 'A', onRun() {}, size: 'huge' },
    { type: 'action', id: 'a', label: '', onRun() {} },
    { type: 'action', id: 'a', label: { xx_YY: 'A' }, onRun() {} },
    { type: 'action', id: 'a:b', label: 'A', onRun() {} },
    { type: 'dropdown', id: 'd', label: 'D', options: [], onChange() {} },
    { type: 'dropdown', id: 'd', label: 'D', options: [{ id: 'x', label: 'X' }], value: 'y', onChange() {} },
    { type: 'dropdown', id: 'd', label: 'D', options: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }], onChange() {} },
    { type: 'dropdown', id: 'd', label: 'D', options: [{ id: 'x=y', label: 'X' }], onChange() {} },
    { type: 'status', id: 's', label: 'S', text: 'ok', tone: 'paars' },
  ]) {
    assert.throws(() => reg.registreer(scope, met(item)), fout('INVALID_CONTRIBUTION'), JSON.stringify(item));
  }
  assert.throws(() => reg.registreer(scope, { id: 't', label: 'T', groups: [], extra: 1 }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope, { id: 't', label: 'T', groups: [] }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => reg.registreer(scope, null), fout('INVALID_CONTRIBUTION'));
  assert.deepEqual(reg.tabbladen('en'), []);
});

test('taalkeuze van label en het weergavemodel (stapelen, keuzelijst, status)', () => {
  const { reg } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  reg.registreer(scope, {
    id: 'main', label: { en: 'Frames', nl: 'Kozijnen' }, icon: { builtin: 'extensionsIcon' },
    groups: [{ id: 'g', label: { en: 'Place', nl: 'Plaatsen' }, items: [
      { type: 'action', id: 'groot', label: 'Groot', onRun() {} },
      { type: 'action', id: 'm1', label: 'M1', size: 'medium', onRun() {} },
      { type: 'action', id: 'm2', label: 'M2', size: 'medium', onRun() {} },
      { type: 'action', id: 'm3', label: 'M3', size: 'medium', onRun() {} },
      { type: 'action', id: 's1', label: 'S1', size: 'small', onRun() {} },
      { type: 'dropdown', id: 'profile', label: 'Profiel', title: 'Kies', options: [{ id: 'wood', label: { en: 'Wood', nl: 'Hout' } }, { id: 'alu', label: 'Alu' }], onChange() {} },
      { type: 'status', id: 'count', label: 'Geplaatst', text: '0' },
    ] }],
  });
  assert.deepEqual(reg.tabbladen('nl').map((t) => [t.id, t.label]), [['nl.voorbeeld.kozijnen.main', 'Kozijnen']]);
  assert.equal(reg.tabbladen('fr')[0].label, 'Frames', 'terugval op en');
  assert.equal(reg.tabbladen('nl')[0].icon, ribbonIcons.extensionsIcon);
  const m = reg.model('nl.voorbeeld.kozijnen.main', 'nl');
  assert.equal(m.label, 'Kozijnen');
  const [g] = m.groepen;
  assert.equal(g.label, 'Plaatsen');
  assert.deepEqual(g.elementen.map((e) => e.soort === 'stapel' ? `${e.soort}:${e.size}:${e.items.map((i) => i.id).join(',')}` : `${e.soort}:${e.id ?? e.items.map((i) => i.id).join(',')}`), [
    'action:groot',
    'stapel:medium:m1,m2',
    'stapel:medium:m3',
    'stapel:small:s1',
    'kolom:profile,count',
  ]);
  const groot = g.elementen[0];
  assert.deepEqual(groot, { soort: 'action', id: 'groot', commandId: 'ext:nl.voorbeeld.kozijnen:groot', label: 'Groot',
    title: 'Groot', icon: null, size: 'large', disabled: false, active: false, loopt: false });
  const [dropdown, status] = g.elementen[4].items;
  assert.deepEqual(dropdown, { soort: 'dropdown', id: 'profile', label: 'Profiel', title: 'Kies', value: 'wood', disabled: false,
    options: [{ id: 'wood', label: 'Hout', commandId: 'ext:nl.voorbeeld.kozijnen:profile=wood' },
      { id: 'alu', label: 'Alu', commandId: 'ext:nl.voorbeeld.kozijnen:profile=alu' }] });
  assert.deepEqual(status, { soort: 'status', id: 'count', label: 'Geplaatst', text: '0', tone: 'neutral' });
});

test('opdrachten per actie en per keuze; een keuze zet de waarde pas na geslaagde onChange', async () => {
  const { reg, opdrachten } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  let mislukt = false;
  const gezien = [];
  reg.registreer(scope, descriptor({ groups: [{ id: 'place', label: 'P', items: [
    { type: 'action', id: 'frame', label: 'Kozijn', onRun: async (ctx) => { gezien.push(ctx); return 42; } },
    { type: 'dropdown', id: 'profile', label: 'Profiel', options: [{ id: 'wood', label: 'Hout' }, { id: 'alu', label: 'Alu' }],
      onChange: async (optie, ctx) => { gezien.push([optie, ctx.source]); if (mislukt) throw new Error('nee'); } },
  ] }] }));
  assert.deepEqual(opdrachten.lijst('en').map((c) => [c.command, c.kind, c.active]), [
    ['ext:nl.voorbeeld.kozijnen:frame', 'action', false],
    ['ext:nl.voorbeeld.kozijnen:profile=wood', 'option', true],
    ['ext:nl.voorbeeld.kozijnen:profile=alu', 'option', false],
  ]);
  const r = await opdrachten.voerUit('ext:nl.voorbeeld.kozijnen:frame', { source: 'mcp' });
  assert.equal(r.result, 42);
  assert.deepEqual(gezien[0], { source: 'mcp', commandId: 'ext:nl.voorbeeld.kozijnen:frame' });
  assert.equal((await opdrachten.voerUit('ext:nl.voorbeeld.kozijnen:profile=alu', { source: 'mcp' })).ok, true);
  assert.equal(reg.model('nl.voorbeeld.kozijnen.main', 'en').groepen[0].elementen[1].items[0].value, 'alu');
  mislukt = true;
  const f = await opdrachten.voerUit('ext:nl.voorbeeld.kozijnen:profile=wood', { source: 'ui' });
  assert.equal(f.code, 'COMMAND_FAILED');
  assert.equal(reg.model('nl.voorbeeld.kozijnen.main', 'en').groepen[0].elementen[1].items[0].value, 'alu', 'oude waarde blijft');
});

test('update() met validatie: alleen toegestane velden, opties met nieuwe opdrachten', () => {
  const { reg, opdrachten } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  const tab = reg.registreer(scope, descriptor());
  let meldingen = 0;
  reg.abonneer(() => meldingen++);
  tab.update('count', { text: '3', tone: 'success' });
  tab.update('frame', { disabled: true, active: true, icon: { builtin: 'extensionsIcon' } });
  const m = reg.model('nl.voorbeeld.kozijnen.main', 'en');
  const [actie, kolom] = m.groepen[0].elementen;
  assert.equal(actie.disabled, true);
  assert.equal(actie.active, true);
  assert.equal(actie.icon, ribbonIcons.extensionsIcon);
  assert.deepEqual(kolom.items[1], { soort: 'status', id: 'count', label: 'Geplaatst', text: '3', tone: 'success' });
  assert.ok(meldingen >= 2);
  assert.throws(() => tab.update('count', { tone: 'paars' }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => tab.update('count', { onRun() {} }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => tab.update('frame', { text: 'x' }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => tab.update('bestaatNiet', { text: 'x' }), fout('INVALID_CONTRIBUTION'));
  assert.throws(() => tab.update('frame', { icon: '<svg viewBox="0 0 1 1" onload="x"/>' }), fout('INVALID_CONTRIBUTION'));
  tab.update('profile', { options: [{ id: 'alu', label: 'Alu' }, { id: 'pvc', label: 'PVC' }] });
  assert.deepEqual(opdrachten.lijst('en').map((c) => c.command), [
    'ext:nl.voorbeeld.kozijnen:frame',
    'ext:nl.voorbeeld.kozijnen:profile=alu',
    'ext:nl.voorbeeld.kozijnen:profile=pvc',
  ]);
  assert.equal(reg.model('nl.voorbeeld.kozijnen.main', 'en').groepen[0].elementen[1].items[0].value, 'alu',
    'de oude waarde bestaat niet meer: de eerste keuze');
  assert.throws(() => tab.update('profile', { value: 'wood' }), fout('INVALID_CONTRIBUTION'));
});

test('dispose haalt tabblad en opdrachten weg, zet een actief tabblad op home; daarna doet de handle niets', () => {
  const { reg, opdrachten, actief, zetActief } = opzet();
  const scope = maakBijdrageScope('nl.voorbeeld.kozijnen');
  const tab = reg.registreer(scope, descriptor());
  zetActief('nl.voorbeeld.kozijnen.main');
  tab.dispose();
  assert.equal(reg.heeft('nl.voorbeeld.kozijnen.main'), false);
  assert.deepEqual(opdrachten.lijst('en'), []);
  assert.equal(actief(), 'home');
  assert.deepEqual(scope.lijst(), []);
  tab.dispose();
  tab.update('count', { text: '9' });
  // Opnieuw registreren na dispose geeft precies één tabblad.
  reg.registreer(scope, descriptor());
  assert.equal(reg.tabbladen('en').length, 1);
  assert.equal(opdrachten.lijst('en').length, 3);
});

test('unregisterRibbonTab en opruimen via de scope (deactiveren)', () => {
  const { reg, opdrachten, actief, zetActief } = opzet();
  const a = maakBijdrageScope('nl.a');
  const b = maakBijdrageScope('nl.b');
  reg.registreer(a, descriptor());
  const tabB = reg.registreer(b, descriptor());
  assert.equal(reg.afmelden(b, 'nl.a.main'), false, 'B kan het tabblad van A niet weghalen');
  assert.equal(reg.afmelden(a, 'main'), true);
  assert.equal(reg.heeft('nl.a.main'), false);
  zetActief('nl.b.main');
  const waarschuwingen = b.ruimOp();
  assert.deepEqual(waarschuwingen, []);
  assert.equal(reg.heeft('nl.b.main'), false);
  assert.deepEqual(opdrachten.lijst('en'), []);
  assert.equal(actief(), 'home');
  tabB.update('count', { text: '1' });
  assert.throws(() => reg.registreer(b, descriptor()), fout('EXTENSION_INACTIVE'));
});

test('sortering op extensie-id en daarna order', () => {
  const { reg } = opzet();
  const leeg = (id, order, item) => ({ id, label: id, order, groups: [{ id: 'g', label: 'G', items: [{ type: 'status', id: item, label: 'S', text: '' }] }] });
  const z = maakBijdrageScope('zz.ext');
  const a = maakBijdrageScope('aa.ext');
  reg.registreer(z, leeg('een', 0, 'i1'));
  reg.registreer(a, leeg('twee', 5, 'i2'));
  reg.registreer(a, leeg('drie', -1, 'i3'));
  assert.deepEqual(reg.tabbladen('en').map((t) => t.id), ['aa.ext.drie', 'aa.ext.twee', 'zz.ext.een']);
  assert.throws(() => reg.registreer(a, leeg('vier', 1.5, 'i4')), fout('INVALID_CONTRIBUTION'));
});
