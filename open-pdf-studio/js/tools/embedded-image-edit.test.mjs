import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import { parsePageImages, bboxFromCtm } from './embedded-image-parser.js';
import {
  verplaatsMatrix, isRechtOpScherm, passendKader, bewerkteInhoud,
  verplaatsAfbeelding, vervangAfbeelding, mul, inverse,
} from './embedded-image-edit.js';

// Een PNG van 2 x 1 pixel.
const PNG_2X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR4nGP4z8Dwn4EBDAAZ/wL+QDEPzAAAAABJRU5ErkJggg==', 'base64'));
// Een PNG van 1 x 2 pixel.
const PNG_1X2 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVR4nGP4z8Dwn+E/AwMDABz/Av4gB8bNAAAAAElFTkSuQmCC', 'base64'));

const YFLIP = [1, 0, 0, -1, 0, 600]; // paginahoogte 600, zonder draaiing
const ROT90 = [0, 1, 1, 0, 0, 0];    // pagina 400 x 600, 90 graden gedraaid

async function pdfMetFoto(opties = { x: 100, y: 200, width: 100, height: 50 }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.drawImage(await doc.embedPng(PNG_2X1), opties);
  return PDFDocument.load(await doc.save());
}

const dicht = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const kaderGelijk = (a, b) => ['x', 'y', 'width', 'height'].every((k) => dicht(a[k], b[k]));

test('mul en inverse zijn elkaars tegendeel', () => {
  const m = [2, 0.5, -0.3, 1.5, 10, -4];
  const id = mul(m, inverse(m));
  [1, 0, 0, 1, 0, 0].forEach((v, i) => assert.ok(dicht(id[i], v, 1e-9), String(i)));
  assert.equal(inverse([0, 0, 0, 0, 1, 1]), null);
});

test('verplaatsMatrix: het nieuwe kader komt precies uit, ook na een y-spiegeling', async () => {
  const doc = await pdfMetFoto();
  const { images } = parsePageImages(doc, 1);
  const oud = bboxFromCtm(images[0].ctm, YFLIP);
  const nieuw = { x: 50, y: 60, width: 200, height: 150 };
  const M = verplaatsMatrix(images[0].ctm, YFLIP, oud, nieuw);
  const ctmNieuw = mul(images[0].ctm, M);
  assert.ok(kaderGelijk(bboxFromCtm(ctmNieuw, YFLIP), nieuw));
});

test('verplaatsAfbeelding: pagina met y-spiegeling, door opslaan en herladen heen', async () => {
  const doc = await pdfMetFoto();
  const oud = bboxFromCtm(parsePageImages(doc, 1).images[0].ctm, YFLIP);
  assert.ok(kaderGelijk(oud, { x: 100, y: 350, width: 100, height: 50 }));
  const nieuw = { x: 40, y: 120, width: 160, height: 80 };
  assert.equal(verplaatsAfbeelding(doc, 1, 0, YFLIP, nieuw), true);
  const heropend = await PDFDocument.load(await doc.save());
  const { images } = parsePageImages(heropend, 1);
  assert.equal(images.length, 1);
  assert.ok(kaderGelijk(bboxFromCtm(images[0].ctm, YFLIP), nieuw));
});

test('verplaatsAfbeelding werkt ook op een 90 graden gedraaide pagina', async () => {
  const doc = await pdfMetFoto();
  const oud = bboxFromCtm(parsePageImages(doc, 1).images[0].ctm, ROT90);
  const nieuw = { x: oud.x + 30, y: oud.y + 12, width: oud.width * 1.5, height: oud.height * 2 };
  assert.equal(verplaatsAfbeelding(doc, 1, 0, ROT90, nieuw), true);
  const heropend = await PDFDocument.load(await doc.save());
  assert.ok(kaderGelijk(bboxFromCtm(parsePageImages(heropend, 1).images[0].ctm, ROT90), nieuw));
});

test('alleen de gekozen foto verandert; de andere blijft staan', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const a = await doc.embedPng(PNG_2X1);
  page.drawImage(a, { x: 10, y: 10, width: 60, height: 30 });
  page.drawImage(a, { x: 200, y: 300, width: 80, height: 40 });
  const los = await PDFDocument.load(await doc.save());
  const voor = parsePageImages(los, 1).images.map((i) => bboxFromCtm(i.ctm, YFLIP));
  verplaatsAfbeelding(los, 1, 0, YFLIP, { x: 100, y: 100, width: 60, height: 30 });
  const na = parsePageImages(await PDFDocument.load(await los.save()), 1).images
    .map((i) => bboxFromCtm(i.ctm, YFLIP));
  assert.equal(na.length, 2);
  assert.ok(kaderGelijk(na[0], { x: 100, y: 100, width: 60, height: 30 }));
  assert.ok(kaderGelijk(na[1], voor[1]));
});

test('vervangAfbeelding: nieuwe foto staat passend en gecentreerd in het oude kader', async () => {
  const doc = await pdfMetFoto({ x: 100, y: 200, width: 100, height: 100 });
  const oud = bboxFromCtm(parsePageImages(doc, 1).images[0].ctm, YFLIP);
  assert.equal(await vervangAfbeelding(doc, 1, 0, YFLIP, PNG_1X2, 'png'), true);
  const heropend = await PDFDocument.load(await doc.save());
  const { images, imageNames } = parsePageImages(heropend, 1);
  assert.equal(images.length, 1);
  assert.ok(imageNames.has('/OpsImg1'));
  // 1 x 2 pixel: halve breedte, gecentreerd in het vierkante kader.
  const verwacht = passendKader(oud, 0.5);
  assert.ok(kaderGelijk(bboxFromCtm(images[0].ctm, YFLIP), verwacht));
  assert.ok(dicht(verwacht.width, 50) && dicht(verwacht.height, 100));
});

test('isRechtOpScherm: rechte en kwartslag ja, schuin nee', () => {
  assert.equal(isRechtOpScherm([100, 0, 0, 50, 10, 10], YFLIP), true);
  assert.equal(isRechtOpScherm([100, 0, 0, 50, 10, 10], ROT90), true);
  assert.equal(isRechtOpScherm([70, 70, -35, 35, 10, 10], YFLIP), false);
});

test('bewerkteInhoud wikkelt de aanroep in q ... Q en laat de rest staan', () => {
  const tekst = 'q 100 0 0 50 10 10 cm /Im0 Do Q BT /F1 12 Tf ET';
  const start = tekst.indexOf('/Im0');
  const image = { start, end: start + '/Im0 Do'.length };
  const uit = bewerkteInhoud(tekst, image, [1, 0, 0, 1, 5, 6]);
  assert.equal(uit, 'q 100 0 0 50 10 10 cm q 1 0 0 1 5 6 cm /Im0 Do Q Q BT /F1 12 Tf ET');
  assert.ok(bewerkteInhoud(tekst, image, null, '/Nieuw').includes('q /Nieuw Do Q'));
  assert.throws(() => bewerkteInhoud('xx', { start: 0, end: 2 }, [1, 0, 0, 1, 0, 0]));
});
