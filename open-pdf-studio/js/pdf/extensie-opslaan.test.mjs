// Een annotatie van een extensie overleeft een fout in die extensie (#621).
//
// Gooit serializeToPdf, dan schreef de saver niets: het origineel was al uit
// /Annots gehaald, dus de markering van de gebruiker was weg. Nu gaat ze als
// /Square met de gegevens van de extensie het bestand in, zoals bij een
// extensie die alleen tekent.
//
// plugin-pdf.js wordt hier vóór de testhaken geladen, zodat de saver de echte
// versie gebruikt (de haken vervangen alleen modules die nog niet geladen zijn).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createPluginPdfAnnotation, readPluginPdfAnnotation } from '../plugins/plugin-pdf.js';
import { leegBlad, opslaan } from './rondgang.testhulp.mjs';

const extensieAnnotatie = {
  id: 'ext1', type: 'plafondsysteem', page: 1, x: 100, y: 100, width: 200, height: 80,
  author: 'User', subject: 'plafond', opacity: 1, printable: true,
};

test('een extensie die bij opslaan een fout geeft, kost de markering niet', async () => {
  const handler = {
    getBounds: (a) => ({ x: a.x, y: a.y, width: a.width, height: a.height }),
    serializeToPdf: () => { throw new Error('kapot'); },
  };
  const bytes = await opslaan(await leegBlad(), [extensieAnnotatie], {
    impl: {
      getAnnotationType: (type) => (type === 'plafondsysteem' ? handler : undefined),
      createPluginPdfAnnotation,
      readPluginPdfAnnotation,
    },
  });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.Annots()?.asArray() || [];
  assert.equal(annots.length, 1, 'de markering staat er nog');
  const dict = doc.context.lookup(annots[0]);
  assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Square');
  const terug = readPluginPdfAnnotation(dict, doc.context);
  assert.equal(terug.type, 'plafondsysteem');
  assert.equal(terug.width, 200);
  assert.equal(dict.get(PDFName.of('AP')), undefined, 'zonder render geen afbeelding');
});

test('createPluginPdfAnnotation zonder afbeelding bewaart alleen de gegevens', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 300]);
  const dict = await createPluginPdfAnnotation(pdf, extensieAnnotatie, [20, 210, 120, 270], null);
  assert.equal(readPluginPdfAnnotation(dict, pdf.context).id, 'ext1');
  assert.equal(dict.get(PDFName.of('AP')), undefined);
});
