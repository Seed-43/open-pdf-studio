import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANIFEST_VERSIE, veiligDeel, sleutelVoor, sessieVoorvoegsel, pdfNaam, generatieVan,
  origineelPadVan, maakManifest, leesManifest, origineelGewijzigd,
} from './manifest.js';
import { instantieUitSleutel, sessieUitSleutel, procesUitId } from './beleid.js';

// Zelfde regel als veilig_relatief in src-tauri/src/herstel.rs.
const RUST_DEEL = /^[A-Za-z0-9_.-]+$/;

test('sleutel: alleen veilige tekens, en terug te lezen', () => {
  const s = sleutelVoor('1234-1792499696789', 'a1b2c3d4', '1792499696789x.y/z\\..');
  assert.match(s, RUST_DEEL);
  assert.ok(!s.startsWith('.'));
  assert.equal(instantieUitSleutel(s), '1234-1792499696789');
  assert.equal(sessieUitSleutel(s), 'a1b2c3d4');
  assert.ok(s.startsWith(sessieVoorvoegsel('1234-1792499696789', 'a1b2c3d4')));
  assert.equal(veiligDeel(''), 'x');
  assert.equal(veiligDeel('../..'), '_____');
  assert.ok(veiligDeel('a'.repeat(500)).length <= 60);
});

test('sleutel: verschilt per instantie, sessie en document', () => {
  const a = sleutelVoor('1-1', 'aaaaaaaa', 'd1');
  assert.notEqual(a, sleutelVoor('2-1', 'aaaaaaaa', 'd1'));
  assert.notEqual(a, sleutelVoor('1-1', 'bbbbbbbb', 'd1'));
  assert.notEqual(a, sleutelVoor('1-1', 'aaaaaaaa', 'd2'));
});

test('procesUitId', () => {
  assert.deepEqual(procesUitId('12-345'), { id: '12-345', pid: 12, gestartMs: 345 });
  assert.equal(procesUitId('kapot'), null);
});

test('pdf-namen en generaties', () => {
  assert.equal(pdfNaam(3), 'momentopname-3.pdf');
  assert.equal(generatieVan('momentopname-12.pdf'), 12);
  assert.equal(generatieVan('manifest.json'), null);
  assert.equal(generatieVan('.opds-save-1-2.tmp'), null);
});

test('origineelPadVan: opslagdoel, origineel of niets', () => {
  assert.equal(origineelPadVan({ filePath: 'C:\\a.pdf' }), 'C:\\a.pdf');
  assert.equal(origineelPadVan({ filePath: 'C:\\tmp\\opds-edit-1.pdf', saveTargetPath: 'C:\\a.pdf', _renderTemp: true }), 'C:\\a.pdf');
  assert.equal(origineelPadVan({ filePath: 'C:\\tmp\\naamloos.pdf', isUntitled: true }), null);
  assert.equal(origineelPadVan({ filePath: 'C:\\tmp\\kopie.pdf', originalFilePath: 'C:\\b.pdf' }), 'C:\\b.pdf');
  assert.equal(origineelPadVan(null), null);
});

test('manifest: velden, zonder documentinhoud, en heen en terug', () => {
  const doc = { id: 'd1', fileName: 'Tekening.pdf', pdfDoc: { numPages: 7 }, annotations: [{ contents: 'GEHEIM' }] };
  const m = maakManifest({
    sleutel: 'k', instantie: { id: '1-2', pid: 1, gestartMs: 2 }, sessie: 'abcd1234', doc,
    origineelPad: 'C:\\x\\Tekening.pdf', origineel: { grootte: 1000, gewijzigdMs: 5 }, appVersie: '2026.43.1', nu: 1_792_499_696_789,
  });
  assert.equal(m.versie, MANIFEST_VERSIE);
  assert.equal(m.titel, 'Tekening.pdf');
  assert.equal(m.paginas, 7);
  assert.equal(m.origineelPad, 'C:\\x\\Tekening.pdf');
  assert.deepEqual(m.origineel, { grootte: 1000, gewijzigdMs: 5 });
  assert.equal(m.appVersie, '2026.43.1');
  assert.equal(m.tijd, '2026-10-20T12:34:56.789Z');
  assert.ok(!JSON.stringify(m).includes('GEHEIM'), 'geen inhoud van annotaties');
  // Pas met pdf-verwijzing (opslag.js zet die) is het een geldig manifest.
  assert.equal(leesManifest(JSON.stringify(m)), null);
  const volledig = { ...m, pdf: 'momentopname-1.pdf', generatie: 1 };
  assert.deepEqual(leesManifest(JSON.stringify(volledig)), volledig);
});

test('manifest: kapot of onvolledig wordt null', () => {
  for (const t of [null, '', '{', '[]', '{"versie":99}', JSON.stringify({ versie: 1, sleutel: 'k', instantie: { id: 'x' }, pdf: 'iets.exe', tijdMs: 1 })]) {
    assert.equal(leesManifest(t), null, String(t));
  }
});

test('origineelGewijzigd', () => {
  const m = { origineelPad: 'a.pdf', origineel: { grootte: 10, gewijzigdMs: 1_000 } };
  assert.equal(origineelGewijzigd(m, { grootte: 10, gewijzigdMs: 1_500 }), false);
  assert.equal(origineelGewijzigd(m, { grootte: 11, gewijzigdMs: 1_000 }), true);
  assert.equal(origineelGewijzigd(m, { grootte: 10, gewijzigdMs: 9_000 }), true);
  assert.equal(origineelGewijzigd(m, null), true, 'weg');
  assert.equal(origineelGewijzigd({ origineelPad: null }, null), null);
  assert.equal(origineelGewijzigd({ origineelPad: 'a.pdf', origineel: null }, { grootte: 1 }), null);
});
