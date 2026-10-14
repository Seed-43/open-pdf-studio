// Het IFC-predefined type van een systeem over opslaan → laden (#567).
//
// De native tool zet op elke getypeerde instance `system.type: 'plafond'`
// (het datamodel met lagen, geen categorie). Een type zonder predefined type
// (bijvoorbeeld een extensietype voor een vloer, IfcSlab) geeft de instance
// er ook geen. De saver schrijft OPS_IfcPredefined alleen als de instance er
// een heeft; de loader mocht daarna geen 'CEILING' verzinnen: met een gevonden
// type is het TYPE leidend (ifcPredefinedNaLaden).
//
// Opslaan zoals saver.js het systeemraster-woordenboek vult (de IFC-sleutels;
// de bron controleert systeemtypen-dialoog-bedrading.test.mjs), via pdf-lib
// naar bytes en terug, en laden met de echte extractAnnotationColors.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import {
  normalizeSysteemType, typeInstanceVelden, ifcPredefinedNaLaden,
} from '../../annotations/systeem-typen.js';
import { systeemToOps, resolveSysteem } from '../../annotations/systeemraster.js';

const VLOER = normalizeSysteemType({
  id: 'ext:test.synthetisch#kanaal', naam: 'Kanaal', categorie: 'vloer', ifcCategory: 'IfcSlab',
  layout: 'strook', strookBreedteMm: 1200, celYMm: 1200,
});
const PLAFOND = normalizeSysteemType({
  id: 'st-plafond-600x600', naam: 'Plafond', categorie: 'plafond', ifcCategory: 'IfcCovering',
  ifcPredefinedType: 'CEILING', layout: 'raster', celXMm: 600, celYMm: 600,
});

/** Een instance zoals de native systeemplafond-tool hem tekent. */
function instance(type) {
  return {
    type: 'systeemraster',
    page: 1,
    points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 110 }, { x: 10, y: 110 }],
    system: { type: 'plafond', layers: [{ panels: {}, edge: { profiel: 'geen' } }] },
    ...typeInstanceVelden(type),
  };
}

/** Opslaan (IFC- en systeemsleutels zoals saver.js) en weer inlezen. */
async function rondgang(ann) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 800]);
  const ctx = doc.context;
  const ops = systeemToOps(ann);
  const woordenboek = {
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: [8, 688, 112, 792],
    Vertices: [10, 790, 110, 790, 110, 690, 10, 690],
    OPS_Subtype: PDFString.of('systeemraster'),
    OPS_SgSysType: PDFString.of(ops.sysType),
    OPS_SgEdge: PDFString.of(ops.edgeProfiel),
    OPS_IfcCategory: PDFString.of(ann.ifcCategory || ''),
    OPS_SgTypeId: PDFString.of(ann.systeemTypeId),
  };
  // saver.js: het predefined type alleen als de instance er een heeft.
  if (ann.ifcPredefinedType) woordenboek.OPS_IfcPredefined = PDFString.of(ann.ifcPredefinedType);
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj(woordenboek))]));
  const bytes = await doc.save();
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes));
  const extra = [...kaart.values()][0];
  assert.ok(extra, 'de annotatie is teruggelezen');
  return extra;
}

/** De loader-regel uit annotation-converter.js (type gevonden in de bibliotheek). */
function geladenPredefined(extra, typeDef) {
  return ifcPredefinedNaLaden({
    typeDef,
    bewaard: extra.opsIfcPredefined,
    sysType: resolveSysteem({ system: { type: extra.sgSysType } }).type,
  });
}

test('een type zonder predefined type krijgt na opslaan en laden geen verzonnen CEILING', async () => {
  const ann = instance(VLOER);
  assert.equal(ann.ifcCategory, 'IfcSlab');
  assert.equal('ifcPredefinedType' in ann, false, 'in het geheugen: geen predefined type');
  const extra = await rondgang(ann);
  assert.equal(extra.sgSysType, 'plafond', 'de tool schrijft het plafond-datamodel');
  assert.equal(extra.opsIfcPredefined, undefined, 'de saver schrijft er geen');
  assert.equal(geladenPredefined(extra, VLOER), undefined, 'en de loader verzint er geen');
});

test('een type met predefined type en een instance met een eigen kopie blijven gelijk', async () => {
  const plafond = instance(PLAFOND);
  assert.equal(geladenPredefined(await rondgang(plafond), PLAFOND), 'CEILING');
  // Een oudere instance draagt zelf een kopie (de oude tool zette altijd
  // CEILING); zonder predefined type op het type blijft die kopie staan.
  const oud = { ...instance(VLOER), ifcPredefinedType: 'FLOOR' };
  assert.equal(geladenPredefined(await rondgang(oud), VLOER), 'FLOOR');
});

test('zonder gevonden type: de bewaarde waarde, anders CEILING voor het plafondmodel (legacy)', () => {
  assert.equal(ifcPredefinedNaLaden({ typeDef: null, bewaard: 'FLOORING', sysType: 'plafond' }), 'FLOORING');
  assert.equal(ifcPredefinedNaLaden({ typeDef: null, bewaard: undefined, sysType: 'plafond' }), 'CEILING');
  assert.equal(ifcPredefinedNaLaden({ typeDef: null, bewaard: undefined, sysType: 'raster' }), undefined);
  assert.equal(ifcPredefinedNaLaden({ typeDef: VLOER, bewaard: undefined, sysType: 'plafond' }), undefined);
  assert.equal(ifcPredefinedNaLaden({ typeDef: PLAFOND, bewaard: 'FLOOR', sysType: 'plafond' }), 'CEILING',
    'het type wint van de bewaarde kopie');
});
