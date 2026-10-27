import test from 'node:test';
import assert from 'node:assert/strict';
import { schrijfMomentopname, schrijfManifest, leesAlle, leesMarkers } from './opslag.js';
import { leesManifest } from './manifest.js';

// Nep-schijf met dezelfde handelingen als de Tauri-commando's. `schrijf` is
// atomisch zoals atomic_file.rs: een bestand is óf oud óf nieuw, nooit half.
// `crashNa` laat de N-de schrijfhandeling mislukken (het proces "valt weg").
function nepSchijf({ crashNa = Infinity } = {}) {
  const bestanden = new Map(); // pad -> { bytes, ms }
  let schrijfacties = 0;
  let klok = 1_000;
  const log = [];
  const kinderen = (rel) => {
    const voor = rel ? `${rel}/` : '';
    const namen = new Map();
    for (const [pad, b] of bestanden) {
      if (!pad.startsWith(voor)) continue;
      const rest = pad.slice(voor.length);
      const [naam, ...diep] = rest.split('/');
      const bestaand = namen.get(naam);
      namen.set(naam, { naam, map: diep.length > 0 || bestaand?.map === true, grootte: diep.length ? 0 : b.bytes.length, gewijzigdMs: b.ms });
    }
    return [...namen.values()];
  };
  return {
    bestanden,
    log,
    async schrijf(rel, bytes) {
      schrijfacties++;
      if (schrijfacties > crashNa) throw new Error('process gone');
      log.push(`schrijf ${rel}`);
      bestanden.set(rel, { bytes: Uint8Array.from(bytes), ms: klok++ });
    },
    async leesTekst(rel) {
      const b = bestanden.get(rel);
      return b ? new TextDecoder().decode(b.bytes) : null;
    },
    async lijst(rel) { return kinderen(rel); },
    async verwijder(rel) {
      log.push(`verwijder ${rel}`);
      let weg = false;
      for (const pad of [...bestanden.keys()]) {
        if (pad === rel || pad.startsWith(`${rel}/`)) { bestanden.delete(pad); weg = true; }
      }
      return weg;
    },
  };
}

const basis = (n) => ({ versie: 1, instantie: { id: '1-2', pid: 1, gestartMs: 2 }, sessie: 's', titel: `v${n}`, tijdMs: n, origineelPad: null });
const bytes = (tekst) => new TextEncoder().encode(tekst);

async function bruikbaar(schijf, sleutel) {
  const m = leesManifest(await schijf.leesTekst(`${sleutel}/manifest.json`));
  if (!m) return null;
  const pdf = schijf.bestanden.get(`${sleutel}/${m.pdf}`);
  return pdf ? { manifest: m, inhoud: new TextDecoder().decode(pdf.bytes) } : null;
}

test('schrijven: eerst de PDF, dan het manifest, dan de oude weg', async () => {
  const schijf = nepSchijf();
  await schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('een'), manifest: basis(1) });
  await schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('twee'), manifest: basis(2) });
  assert.deepEqual(schijf.log, [
    'schrijf k/momentopname-1.pdf',
    'schrijf k/manifest.json',
    'schrijf k/momentopname-2.pdf',
    'schrijf k/manifest.json',
    'verwijder k/momentopname-1.pdf',
  ]);
  const b = await bruikbaar(schijf, 'k');
  assert.equal(b.inhoud, 'twee');
  assert.equal(b.manifest.generatie, 2);
  assert.equal(b.manifest.pdfGrootte, 4);
  assert.deepEqual([...schijf.bestanden.keys()].sort(), ['k/manifest.json', 'k/momentopname-2.pdf'], 'alleen de nieuwste blijft');
});

test('atomisch: een crash op elk moment laat een complete momentopname achter', async () => {
  for (let crashNa = 0; crashNa <= 4; crashNa++) {
    const schijf = nepSchijf({ crashNa: 2 + crashNa });
    await schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('oud'), manifest: basis(1) });
    try {
      await schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('nieuw'), manifest: basis(2) });
    } catch { /* weggevallen */ }
    const b = await bruikbaar(schijf, 'k');
    assert.ok(b, `crash na ${crashNa}: geen bruikbare momentopname`);
    assert.ok(['oud', 'nieuw'].includes(b.inhoud), b.inhoud);
    assert.equal(b.manifest.titel, b.inhoud === 'oud' ? 'v1' : 'v2', 'manifest en PDF horen bij elkaar');
  }
});

test('atomisch: een losgebleven nieuwere PDF wordt bij de volgende opname opgeruimd', async () => {
  const schijf = nepSchijf({ crashNa: 3 });
  await schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('oud'), manifest: basis(1) });
  await assert.rejects(schrijfMomentopname(schijf, { sleutel: 'k', bytes: bytes('half'), manifest: basis(2) }));
  // momentopname-2.pdf staat er, het manifest wijst nog naar 1.
  assert.ok(schijf.bestanden.has('k/momentopname-2.pdf'));
  const herstart = nepSchijf();
  for (const [p, b] of schijf.bestanden) herstart.bestanden.set(p, b);
  await schrijfMomentopname(herstart, { sleutel: 'k', bytes: bytes('derde'), manifest: basis(3) });
  assert.deepEqual([...herstart.bestanden.keys()].sort(), ['k/manifest.json', 'k/momentopname-3.pdf']);
  assert.equal((await bruikbaar(herstart, 'k')).inhoud, 'derde');
});

test('leesAlle: manifest, onvolledig, grootte; markers apart', async () => {
  const schijf = nepSchijf();
  await schrijfMomentopname(schijf, { sleutel: 'heel', bytes: bytes('12345'), manifest: basis(1) });
  await schijf.schrijf('half/momentopname-1.pdf', bytes('x'));
  await schijf.schrijf('markers/1-2.json', bytes(JSON.stringify({ id: '1-2', pid: 1, gestartMs: 2 })));
  await schijf.schrijf('markers/kapot.json', bytes('{'));
  const alle = await leesAlle(schijf);
  assert.deepEqual(alle.map((i) => i.sleutel).sort(), ['half', 'heel']);
  const heel = alle.find((i) => i.sleutel === 'heel');
  assert.equal(heel.onvolledig, false);
  assert.ok(heel.grootte >= 5);
  assert.equal(alle.find((i) => i.sleutel === 'half').onvolledig, true);
  const markers = await leesMarkers(schijf);
  assert.deepEqual(markers.map((m) => m.id), ['1-2']);
  assert.equal(markers[0].bestand, '1-2.json');
});

test('schrijfManifest: overnemen herschrijft alleen het manifest', async () => {
  const schijf = nepSchijf();
  const m = await schrijfMomentopname(schijf, { sleutel: 'oud', bytes: bytes('pdf'), manifest: basis(1) });
  await schijf.schrijf('nieuw/momentopname-1.pdf', bytes('pdf'));
  await schrijfManifest(schijf, 'nieuw', { ...m, sessie: 'anders' });
  const b = await bruikbaar(schijf, 'nieuw');
  assert.equal(b.manifest.sleutel, 'nieuw');
  assert.equal(b.manifest.sessie, 'anders');
});
