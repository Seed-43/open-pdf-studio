import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { detectFormShapes, labelCandidates, createRecognizedForm } from './form-recognition.js';

function raster() {
  const width = 400,
    height = 240,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  const black = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  };
  const rect = (x, y, w, h) => {
    for (let i = x; i < x + w; i++) {
      black(i, y);
      black(i, y + h - 1);
    }
    for (let j = y; j < y + h; j++) {
      black(x, j);
      black(x + w - 1, j);
    }
  };
  return { width, height, data, black, rect };
}
test('scan-like empty boxes, writing line and checkbox become unaccepted candidates', () => {
  const r = raster();
  r.rect(20, 30, 140, 20);
  r.rect(20, 80, 16, 16);
  r.rect(80, 150, 180, 1);
  const shapes = detectFormShapes(r);
  assert.equal(shapes.length, 3);
  assert.equal(shapes[1].type, 'checkbox');
  assert.equal(shapes[2].source, 'writing-line');
  const c = labelCandidates(shapes, [{ text: 'Full name:', x: 20, y: 12, width: 80, height: 10 }, { text: 'Agree', x: 42, y: 82, width: 40, height: 10 }]);
  assert.equal(c[0].label, 'Full name');
  assert.equal(c[1].label, 'Agree');
  assert.ok(c.every(c => !c.accepted));
});
test('filled content is rejected, output is bounded, malformed raster rejected', () => {
  const r = raster();
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) r.black(x, y);
  assert.equal(detectFormShapes(r).length, 0);
  assert.throws(() => detectFormShapes({ ...r, width: 10000 }), /INVALID_RASTER/);
});
const candidate = (overrides = {}) => ({
  page: 1,
  type: 'text',
  name: 'name',
  label: 'Naam / 姓名',
  required: true,
  accepted: true,
  order: 1,
  bounds: { x: 20, y: 200, width: 120, height: 20 },
  ...overrides
});

async function base() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  page.drawText('Original artwork', { x: 20, y: 270 });
  page.setRotation(degrees(90));
  return pdf.save();
}
test('real AcroForm copy preserves rotation/artwork and fills/saves/reopens text, checkbox, radio', async () => {
  const bytes = await base();
  const output = await createRecognizedForm(bytes, [candidate(), candidate({
    type: 'checkbox',
    name: 'agree',
    label: 'Accept',
    order: 2,
    bounds: { x: 20, y: 160, width: 16, height: 16 }
  }), candidate({
    type: 'radio',
    group: 'choice',
    groupLabel: 'Choose one',
    label: 'First',
    option: 'one',
    order: 3,
    bounds: { x: 20, y: 120, width: 16, height: 16 }
  }), candidate({
    type: 'radio',
    group: 'choice',
    groupLabel: 'Choose one',
    label: 'Second',
    option: 'two',
    order: 4,
    bounds: { x: 80, y: 120, width: 16, height: 16 }
  })]);
  const pdf = await PDFDocument.load(output.bytes),
    form = pdf.getForm();
  assert.equal(pdf.getPage(0).getRotation().angle, 90);
  assert.equal(output.created, 4);
  assert.equal(form.getFields().length, 3);
  assert.equal(form.getTextField('name').acroField.dict.lookup(PDFName.of('TU')).decodeText(), 'Naam / 姓名');
  assert.equal(form.getTextField('name').isRequired(), true);
  form.getTextField('name').setText('Ada');
  form.getCheckBox('agree').check();
  form.getRadioGroup('choice').select('two');
  const reopened = await PDFDocument.load(await pdf.save());
  assert.equal(reopened.getForm().getTextField('name').getText(), 'Ada');
  assert.equal(reopened.getForm().getCheckBox('agree').isChecked(), true);
  assert.equal(reopened.getForm().getRadioGroup('choice').getSelected(), 'two');
  assert.equal((await PDFDocument.load(bytes)).getForm().getFields().length, 0);
});
test('unaccepted proposals are omitted; duplicates and overlapping existing fields are refused', async () => {
  const one = await createRecognizedForm(await base(), [candidate(), candidate({ accepted: false, name: 'ignored' })]);
  assert.equal(one.fields.length, 1);
  await assert.rejects(createRecognizedForm(one.bytes, [candidate({ name: 'other' })]), /OVERLAPPING_FIELDS/);
  await assert.rejects(createRecognizedForm(one.bytes, [candidate({ bounds: { x: 20, y: 100, width: 120, height: 20 } })]), /INVALID_OR_DUPLICATE_NAME/);
  await assert.rejects(createRecognizedForm(await base(), [candidate({ bounds: { x: 290, y: 100, width: 20, height: 20 } })]), /INVALID_BOUNDS/);
  await assert.rejects(createRecognizedForm(await base(), [candidate({ accepted: false })]), /NO_ACCEPTED_FIELDS/);
});
