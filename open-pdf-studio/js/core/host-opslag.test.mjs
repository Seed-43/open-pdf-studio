// Het opslagcontract van de gastsite in de platformlaag (#546): een document
// van de site opent via open(), Opslaan schrijft via save() terug, en wat geen
// document van de site is (een export ernaast, "Opslaan als") blijft een
// download.

import assert from 'node:assert/strict';
import test from 'node:test';

// Kale browser: geen Tauri, wel een document voor de download-terugval.
const downloads = [];
globalThis.window = {};
globalThis.document = {
  createElement: () => ({ click() {} }),
  body: { appendChild(a) { downloads.push(a.download); }, removeChild() {} },
};

const {
  hostOpslag, hostPad, leesHostPad, openHostBestand, hostDocumenten, hostVersies,
  readBinaryFile, writeBinaryFile, writeBinaryFileAtomic, saveFileDialog, fileExists,
  extractFileName,
} = await import('./platform.js');

/** Een site die documenten in het geheugen bewaart, met versies. */
function nepSite(begin = {}) {
  const docs = new Map(Object.entries(begin));
  const versies = new Map();
  const opgeslagen = [];
  return {
    docs,
    opgeslagen,
    storage: {
      async open(id) {
        if (!docs.has(id)) throw new Error(`onbekend: ${id}`);
        return { name: docs.get(id).name, data: docs.get(id).data.slice().buffer };
      },
      async save(id, bytes, { name }) {
        opgeslagen.push({ id, name, lengte: bytes.length });
        docs.set(id, { name: docs.get(id)?.name ?? name, data: bytes.slice() });
        versies.set(id, [...(versies.get(id) || []), { version: String((versies.get(id) || []).length + 1) }]);
      },
      async list() { return [...docs].map(([id, d]) => ({ id, name: d.name })); },
      async versions(id) { return versies.get(id) || []; },
    },
  };
}

async function alsGast(site, fn) {
  window.__OPDS_HOST__ = { storage: site.storage };
  try {
    await fn();
  } finally {
    delete window.__OPDS_HOST__;
  }
}

test('een pad van de site draagt id en naam, ook met schuine strepen erin', () => {
  const pad = hostPad('Drawing/2026 01', 'map/blad A.pdf');
  assert.equal(pad, 'opds-host://Drawing%2F2026%2001/map_blad A.pdf');
  assert.deepEqual(leesHostPad(pad), { id: 'Drawing/2026 01', naam: 'map_blad A.pdf' });
  assert.equal(extractFileName(pad), 'map_blad A.pdf', 'tabblad en titel lezen de naam gewoon');
  assert.equal(leesHostPad('C:/docs/a.pdf'), null);
  assert.equal(leesHostPad('opds-host://zonder-naam'), null);
});

test('zonder gastsite is er geen opslagcontract', async () => {
  assert.equal(hostOpslag(), null);
  window.__OPDS_HOST__ = { storage: { open() {} } }; // geen save: geen contract
  try { assert.equal(hostOpslag(), null); } finally { delete window.__OPDS_HOST__; }
  assert.equal(await readBinaryFile('opds-host://1/a.pdf'), null, 'valt terug op de webcache');
  assert.deepEqual(await hostDocumenten(), []);
});

test('openen, opslaan en opnieuw openen gaat via de site', () => alsGast(
  nepSite({ 'DOC-1': { name: 'Plattegrond.pdf', data: Uint8Array.from([1, 2, 3]) } }),
  async () => {
    const { pad, naam, data } = await openHostBestand('DOC-1');
    assert.equal(naam, 'Plattegrond.pdf');
    assert.equal(pad, 'opds-host://DOC-1/Plattegrond.pdf');
    assert.deepEqual([...data], [1, 2, 3]);
    assert.equal(await fileExists(pad), true);

    // Opslaan schrijft over het geopende document heen (de saver gebruikt de
    // atomaire variant; buiten Tauri komt die op hetzelfde uit).
    assert.equal(await writeBinaryFileAtomic(pad, Uint8Array.from([9, 9, 9, 9])), true);
    const opnieuw = await openHostBestand('DOC-1');
    assert.deepEqual([...opnieuw.data], [9, 9, 9, 9], 'na herladen staat de nieuwe inhoud er');
    assert.deepEqual((await hostVersies('DOC-1')).map((v) => v.version), ['1']);
    assert.deepEqual((await hostDocumenten()).map((d) => d.id), ['DOC-1']);
  },
));

test('een afgeleid pad of "Opslaan als" schrijft nooit naar de site', () => {
  const site = nepSite({ 'DOC-2': { name: 'Gevel.pdf', data: Uint8Array.from([5]) } });
  return alsGast(site, async () => {
    const { pad } = await openHostBestand('DOC-2');
    downloads.length = 0;
    // Een export naast het document: zelfde id, andere naam.
    await writeBinaryFile('opds-host://DOC-2/Gevel.png', Uint8Array.from([1]));
    assert.equal(site.opgeslagen.length, 0, 'niets naar de site');
    assert.deepEqual(downloads.filter(Boolean), ['Gevel.png'], 'een download');
    // Opslaan als: alleen een bestandsnaam, dus een download.
    assert.equal(await saveFileDialog(pad), 'Gevel.pdf');
  });
});

test('een recent bestand na een herlaadbeurt: lezen opent het, opslaan schrijft terug', () => {
  const site = nepSite({ 'DOC-3': { name: 'Nieuwe naam.pdf', data: Uint8Array.from([7]) } });
  return alsGast(site, async () => {
    // Het pad uit de lijst met recente bestanden heeft nog de oude naam.
    const pad = 'opds-host://DOC-3/Oude naam.pdf';
    assert.deepEqual([...(await readBinaryFile(pad))], [7]);
    await writeBinaryFile(pad, Uint8Array.from([8, 8]));
    assert.deepEqual(site.opgeslagen, [{ id: 'DOC-3', name: 'Oude naam.pdf', lengte: 2 }]);
  });
});

test('de site mag de bytes als Blob of Uint8Array teruggeven', () => {
  const site = {
    storage: {
      open: async (id) => (id === 'blob'
        ? { name: 'b.pdf', data: new Blob([Uint8Array.from([4, 2])]) }
        : { name: 'u.pdf', data: Uint8Array.from([4, 3]) }),
      save: async () => {},
    },
  };
  return alsGast(site, async () => {
    assert.deepEqual([...(await openHostBestand('blob')).data], [4, 2]);
    assert.deepEqual([...(await openHostBestand('u8')).data], [4, 3]);
  });
});
