// Snellere pdf-lib-standaarden (#581): elke PDFDocument.load krijgt een grote
// parseSpeed en elke save een grote objectsPerTick, tenzij de aanroeper zelf
// een waarde meegeeft. De uitvoer blijft byte voor byte gelijk.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

// Spionnen op de echte methodes, vóór het snelheidsmodule ze inwikkelt: zo
// zien we precies welke opties pdf-lib zelf ontvangt.
const echtLaden = PDFDocument.load;
const echtBewaren = PDFDocument.prototype.save;
const ontvangen = { load: [], save: [] };
PDFDocument.load = function (bytes, opties) { ontvangen.load.push(opties); return echtLaden.call(this, bytes, opties); };
PDFDocument.prototype.save = function (opties) { ontvangen.save.push(opties); return echtBewaren.call(this, opties); };

const { OBJECTEN_PER_TIK, versnelPdfLib } = await import('./pdf-lib-snelheid.js');

async function voorbeeld(paginas = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]).drawText(`Pagina ${i + 1}`, { x: 20, y: 100 });
  return doc;
}

const laatste = (lijst) => lijst[lijst.length - 1];

test('partijen van duizenden objecten, niet de trage pdf-lib-standaard', () => {
  assert.ok(OBJECTEN_PER_TIK >= 1000, `${OBJECTEN_PER_TIK}`);
  // Eindig, zodat de event-loop op enorme bestanden nog af en toe ruimte krijgt.
  assert.ok(Number.isFinite(OBJECTEN_PER_TIK));
});

test('save geeft objectsPerTick mee en houdt de andere opties van de aanroeper', async () => {
  const doc = await voorbeeld();
  await doc.save();
  assert.deepEqual(laatste(ontvangen.save), { objectsPerTick: OBJECTEN_PER_TIK });
  await doc.save({ useObjectStreams: false });
  assert.deepEqual(laatste(ontvangen.save), { objectsPerTick: OBJECTEN_PER_TIK, useObjectStreams: false });
});

test('een eigen objectsPerTick van de aanroeper wint', async () => {
  const doc = await voorbeeld();
  await doc.save({ objectsPerTick: 10 });
  assert.equal(laatste(ontvangen.save).objectsPerTick, 10);
});

test('saveAsBase64 loopt via save en krijgt de snelle waarde ook', async () => {
  const doc = await voorbeeld();
  const voor = ontvangen.save.length;
  await doc.saveAsBase64({ dataUri: true });
  assert.ok(ontvangen.save.length > voor);
  assert.equal(laatste(ontvangen.save).objectsPerTick, OBJECTEN_PER_TIK);
});

test('load geeft parseSpeed mee en houdt de opties van de aanroeper', async () => {
  const bytes = await (await voorbeeld()).save();
  await PDFDocument.load(bytes);
  assert.deepEqual(laatste(ontvangen.load), { parseSpeed: OBJECTEN_PER_TIK });
  await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  assert.deepEqual(laatste(ontvangen.load), { parseSpeed: OBJECTEN_PER_TIK, ignoreEncryption: true, updateMetadata: false });
  await PDFDocument.load(bytes, { parseSpeed: 7 });
  assert.equal(laatste(ontvangen.load).parseSpeed, 7);
});

test('de uitvoer is gelijk aan die met de pdf-lib-standaard en laadt met alle pagina\'s', async () => {
  const doc = await voorbeeld(40);
  const snel = await doc.save();
  const standaard = await echtBewaren.call(doc);
  assert.deepEqual(Buffer.from(snel), Buffer.from(standaard));
  const terug = await PDFDocument.load(snel);
  assert.equal(terug.getPageCount(), 40);
});

test('nog een keer versnellen wikkelt niet dubbel in', async () => {
  const load = PDFDocument.load;
  const save = PDFDocument.prototype.save;
  versnelPdfLib();
  assert.equal(PDFDocument.load, load);
  assert.equal(PDFDocument.prototype.save, save);
});

test('main.js importeert het snelheidsmodule als eerste module', () => {
  const hier = dirname(fileURLToPath(import.meta.url));
  const main = readFileSync(join(hier, '..', 'main.js'), 'utf8');
  // Ook imports over meerdere regels tellen mee.
  const imports = [...main.matchAll(/^import\s[\s\S]*?['"]([^'"]+)['"];/gm)].map((m) => m[1]);
  assert.equal(imports[0], './pdf/pdf-lib-snelheid.js');
});
