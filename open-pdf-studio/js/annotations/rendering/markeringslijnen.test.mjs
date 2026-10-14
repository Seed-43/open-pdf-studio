// Lijnen van tekstmarkeringen op het scherm (#564).
//
// Sinds #533 loopt de opgeslagen appearance van onderstreping en kronkellijn
// langs de tekst, op elke paginarotatie en bij verticale tekst. Het scherm
// tekende de onderstreping altijd horizontaal onderaan het vak en de
// kronkellijn helemaal niet. Nu tekent het scherm dezelfde lijnen als de
// appearance: hier per leesrichting en per /Rotate tegen de saver gecontroleerd.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { underlineLine, squiggleLine, strikeLine, drawMarkupLines } from './caret.js';
import { quadCorners, quadUnderline, quadSquiggle } from '../corrections/geometry.js';
import { makePointMapper } from '../../pdf/saver/correction-dicts.js';
import { buildTextMarkupDict } from '../../pdf/saver/text-markup-dict.js';

const dichtbij = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Een liggend tekstvak (gewone tekst) en een staand (verticale tekst).
const LIGGEND = { x: 72, y: 90, width: 48, height: 12 };
const STAAND = { x: 90, y: 72, width: 12, height: 48 };
const vakVoor = (textDir) => (textDir === 90 || textDir === 270 ? STAAND : LIGGEND);

test('onderstreping van gewone tekst: horizontaal, 1 pt boven de onderrand, zoals altijd', () => {
  const zoalsVoorheen = [{ x: 72, y: 101 }, { x: 120, y: 101 }];
  assert.deepEqual(underlineLine(LIGGEND, undefined), zoalsVoorheen);
  assert.deepEqual(underlineLine(LIGGEND, 0), zoalsVoorheen);
});

test('onderstreping van verticale tekst loopt langs de kolom, aan de onderkant van de tekst', () => {
  // textDir 90: leesrichting omlaag, de bovenkant van de tekst ligt rechts.
  const neer = underlineLine(STAAND, 90);
  assert.deepEqual(neer, [{ x: 91, y: 72 }, { x: 91, y: 120 }]);
  // textDir 270: leesrichting omhoog, de bovenkant van de tekst ligt links.
  const op = underlineLine(STAAND, 270);
  assert.deepEqual(op, [{ x: 101, y: 120 }, { x: 101, y: 72 }]);
  // Tekst op zijn kop: de onderkant van de tekst is de bovenrand van het vak.
  assert.deepEqual(underlineLine(LIGGEND, 180), [{ x: 120, y: 91 }, { x: 72, y: 91 }]);
  for (const textDir of [0, 90, 180, 270]) {
    const vak = vakVoor(textDir);
    assert.deepEqual(underlineLine(vak, textDir), quadUnderline(quadCorners(vak, textDir)), `textDir ${textDir}`);
  }
});

test('kronkellijn: een zigzag langs de onderkant van de tekst, binnen het vak, over de hele lengte', () => {
  for (const textDir of [0, 90, 180, 270]) {
    const vak = vakVoor(textDir);
    const punten = squiggleLine(vak, textDir);
    assert.deepEqual(punten, quadSquiggle(quadCorners(vak, textDir)), `textDir ${textDir}`);
    assert.ok(punten.length > 4, `textDir ${textDir}: ${punten.length} punten`);
    for (const p of punten) {
      assert.ok(p.x >= vak.x - 1e-9 && p.x <= vak.x + vak.width + 1e-9
        && p.y >= vak.y - 1e-9 && p.y <= vak.y + vak.height + 1e-9, `textDir ${textDir}: punt ${p.x},${p.y} in het vak`);
    }
    // Van begin-onder naar eind-onder van de tekst.
    const q = quadCorners(vak, textDir);
    assert.deepEqual(punten[0], { x: q[2].x, y: q[2].y });
    dichtbij(punten.at(-1).x, q[3].x, 1e-9, `textDir ${textDir}: eind x`);
    dichtbij(punten.at(-1).y, q[3].y, 1e-9, `textDir ${textDir}: eind y`);
  }
  // Bij verticale tekst loopt hij langs y, niet langs x.
  const staand = squiggleLine(STAAND, 90);
  assert.ok(Math.max(...staand.map((p) => p.x)) - Math.min(...staand.map((p) => p.x)) <= 4);
  assert.equal(Math.max(...staand.map((p) => p.y)) - Math.min(...staand.map((p) => p.y)), STAAND.height);
});

/** Canvas-stub die het pad vastlegt. */
function stubCtx() {
  const ops = [];
  return {
    ops,
    beginPath() { ops.push(['begin']); },
    moveTo(x, y) { ops.push(['move', x, y]); },
    lineTo(x, y) { ops.push(['line', x, y]); },
    stroke() { ops.push(['stroke']); },
  };
}

const alsOps = (punten) => [
  ['begin'], ['move', punten[0].x, punten[0].y],
  ...punten.slice(1).map((p) => ['line', p.x, p.y]), ['stroke'],
];

test('drawMarkupLines tekent per tekstvak de lijn van zijn soort, in de leesrichting', () => {
  const rects = [STAAND, { x: 110, y: 72, width: 12, height: 30 }];
  const lijnen = { textStrikethrough: strikeLine, textUnderline: underlineLine, textSquiggly: squiggleLine };
  for (const [type, lijn] of Object.entries(lijnen)) {
    const ctx = stubCtx();
    drawMarkupLines(ctx, { type, rects, textDir: 90, x: 90, y: 72, width: 32, height: 48 });
    assert.deepEqual(ctx.ops, rects.flatMap((r) => alsOps(lijn(r, 90))), type);
    // Zonder rects: het vak van de annotatie.
    const los = stubCtx();
    drawMarkupLines(los, { type, ...LIGGEND });
    assert.deepEqual(los.ops, alsOps(lijn(LIGGEND, 0)), `${type} zonder rects`);
  }
  for (const type of ['textHighlight', 'caret', 'box']) {
    const ctx = stubCtx();
    drawMarkupLines(ctx, { type, rects: [LIGGEND] });
    assert.deepEqual(ctx.ops, [], `${type} heeft geen markeringslijn`);
  }
  const ctx = stubCtx();
  drawMarkupLines(ctx, null);
  assert.deepEqual(ctx.ops, []);
});

// ── scherm gelijk aan de opgeslagen appearance ────────────────────────────

const PAGINAS = [
  { rotate: 0, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 90, cropBox: { x: 36, y: 48, width: 540, height: 720 } },
  { rotate: 180, cropBox: { x: 20, y: 30, width: 560, height: 700 } },
  { rotate: 270, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
];
const SOORTEN = { textStrikethrough: strikeLine, textUnderline: underlineLine, textSquiggly: squiggleLine };

/** Punten van elk deelpad van de appearance, in gebruikersruimte. */
function apPaden(ctx, dict) {
  const n = ctx.lookup(ctx.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  const tekst = Buffer.from(n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : n.getContents()).toString('latin1');
  const [llx, lly] = ctx.lookup(dict.get(PDFName.of('Rect'))).asArray().map((v) => v.asNumber());
  const paden = [];
  for (const m of tekst.matchAll(/(-?[\d.]+) (-?[\d.]+) ([ml])\b/g)) {
    if (m[3] === 'm') paden.push([]);
    paden.at(-1).push({ x: Number(m[1]) + llx, y: Number(m[2]) + lly });
  }
  return paden;
}

for (const instelling of PAGINAS) {
  test(`scherm en appearance volgen dezelfde lijn op /Rotate ${instelling.rotate} (#564)`, async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const map = makePointMapper(instelling.rotate, instelling.cropBox);
    for (const [type, lijn] of Object.entries(SOORTEN)) {
      for (const textDir of [0, 90, 180, 270]) {
        const rects = textDir === 90 || textDir === 270
          ? [STAAND, { x: 110, y: 80, width: 12, height: 30 }]
          : [LIGGEND, { x: 72, y: 104, width: 30, height: 12 }];
        const ann = { type, rects, textDir, color: '#0066FF', lineWidth: 1.5, ...LIGGEND };
        const dict = buildTextMarkupDict(ctx, ann, map, { opacity: 1, pageRot: instelling.rotate });
        const paden = apPaden(ctx, dict);
        assert.equal(paden.length, rects.length, `${type} textDir ${textDir}: een lijn per regel`);
        rects.forEach((r, i) => {
          // De schermlijn, met de omrekening van de saver naar de pagina.
          let scherm = lijn(r, textDir).map((p) => map(p.x, p.y));
          // De doorhaling van tekst op zijn kop tekent het scherm al van links
          // naar rechts (strikeLine): hetzelfde lijnstuk, andere kant op.
          const omgekeerd = scherm.length === 2 && Math.hypot(paden[i][0].x - scherm[0].x, paden[i][0].y - scherm[0].y) > 1e-3;
          if (type === 'textStrikethrough' && omgekeerd) scherm = [...scherm].reverse();
          assert.equal(paden[i].length, scherm.length, `${type} textDir ${textDir} regel ${i + 1}: aantal punten`);
          scherm.forEach((p, k) => {
            const label = `${type} /Rotate ${instelling.rotate} textDir ${textDir} regel ${i + 1} punt ${k}`;
            dichtbij(paden[i][k].x, p.x, 1e-3, `${label} x`);
            dichtbij(paden[i][k].y, p.y, 1e-3, `${label} y`);
          });
        });
      }
    }
  });
}

// ── koppeling in rendering.js ───────────────────────────────────────────────

test('rendering.js tekent doorhaling, onderstreping en kronkellijn met drawMarkupLines', () => {
  const bron = readFileSync(new URL('../rendering.js', import.meta.url), 'utf8');
  const tak = (naam) => {
    const begin = bron.indexOf(`case '${naam}'`);
    assert.ok(begin >= 0, `case '${naam}' ontbreekt`);
    return bron.slice(begin, bron.indexOf('break;', begin));
  };
  for (const naam of ['textStrikethrough', 'textUnderline', 'textSquiggly']) {
    assert.match(tak(naam), /drawMarkupLines\(ctx, annotation\)/, naam);
  }
  // Niet meer altijd horizontaal onderaan het vak.
  assert.doesNotMatch(tak('textUnderline'), /rect\.y \+ rect\.height - 1/);
});
