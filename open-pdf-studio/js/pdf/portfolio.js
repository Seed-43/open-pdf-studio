/** ISO 32000 Collections; folder keys follow the <ID>filename convention.
 * Existing schema, sort, item dictionaries and streams are retained verbatim.
 * This module never executes a component, navigator, action or script.
 */
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFHexString, PDFString, PDFRawStream, decodePDFRawStream, StandardFonts } from 'pdf-lib';
import { pasBijlagenToe } from './bijlagen.js';
const n = PDFName.of;
const text = x => x instanceof PDFString || x instanceof PDFHexString ? x.decodeText() : '';
const dict = (d, key) => { const v = d?.lookup(n(key)); return v instanceof PDFDict ? v : null; };
const number = x => x instanceof PDFNumber ? x.asNumber() : null;
function entries(pdf) {
  const out = [], seen = new Set();
  function visit(node) {
    if (!(node instanceof PDFDict) || seen.has(node)) return;
    if (seen.size >= 10000) throw new Error('COLLECTION_TOO_LARGE');
    seen.add(node);
    const names = node.lookup(n('Names'));
    if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) {
      const spec = names.lookup(i + 1);
      if (spec instanceof PDFDict) out.push({key: text(names.lookup(i)), spec});
    }
    const kids = node.lookup(n('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) visit(kids.lookup(i));
  }
  visit(dict(dict(pdf.catalog, 'Names'), 'EmbeddedFiles'));
  return out;
}
function folders(collection) {
  const out = [], seen = new Set(), ids = new Set();
  const root = dict(collection, 'Folders');
  function visit(node, parentId, depth) {
    if (!node) return;
    if (seen.has(node) || depth > 64) throw new Error('INVALID_FOLDER_TREE');
    seen.add(node);
    const id = number(node.lookup(n('ID')));
    if (!Number.isSafeInteger(id) || id < 0 || ids.has(id)) throw new Error('INVALID_FOLDER_ID');
    ids.add(id);
    out.push({id, parentId, name: text(node.lookup(n('Name'))), description: text(node.lookup(n('Desc'))), node});
    visit(dict(node, 'Child'), id, depth + 1);
    visit(dict(node, 'Next'), parentId, depth);
  }
  visit(root, null, 0);
  return out;
}
function values(d) {
  if (!d) return {};
  return Object.fromEntries(d.entries().filter(([k]) => k.decodeText() !== 'Type').map(([k,v]) => {
    const value = d.context.lookup(v);
    return [k.decodeText(), value instanceof PDFDict ? {value: text(value.lookup(n('D'))) || value.lookup(n('D'))?.toString(), prefix: text(value.lookup(n('P')))} : text(value) || value?.toString()];
  }));
}
export function inspectPortfolio(pdf) {
  const collection = dict(pdf.catalog, 'Collection'), tree = folders(collection), rootId = tree[0]?.id ?? null;
  const items = entries(pdf).map(({key,spec}) => {
    const match = /^<(\d+)>(.*)$/s.exec(key), id = match ? Number(match[1]) : rootId;
    const stream = dict(spec,'EF')?.lookup(n('UF')) || dict(spec,'EF')?.lookup(n('F'));
    return {key, name: text(spec.lookup(n('UF'))) || text(spec.lookup(n('F'))) || (match ? match[2] : key), folderId: tree.some(f => f.id === id) ? id : rootId,
      description: text(spec.lookup(n('Desc'))), metadata: values(dict(spec,'CI')), size: number(dict(stream?.dict,'Params')?.lookup(n('Size'))), available: stream instanceof PDFRawStream};
  });
  const schema = dict(collection,'Schema');
  return {isCollection: !!collection, folders: tree.map(({node,...f}) => f), items,
    schema: schema ? Object.fromEntries(schema.entries().filter(([key]) => key.decodeText() !== 'Type').map(([key]) => [key.decodeText(), values(dict(schema,key.decodeText()))])) : {},
    sort: values(dict(collection,'Sort')), view: collection?.lookup(n('View'))?.toString() ?? '/D'};
}
export function extractComponent(pdf, key) {
  const entry = entries(pdf).find(e => e.key === key);
  if (!entry) throw new Error('COMPONENT_NOT_FOUND');
  const ef = dict(entry.spec,'EF'), stream = ef?.lookup(n('UF')) || ef?.lookup(n('F'));
  if (!(stream instanceof PDFRawStream)) throw new Error('COMPONENT_UNAVAILABLE');
  return decodePDFRawStream(stream).decode().slice();
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\x00-\x1f/\\]/.test(value)) throw new Error('INVALID_NAME');
  return value.trim();
}
export async function changePortfolio(bytes, changes = {}) {
  const pdf = await PDFDocument.load(bytes.slice());
  // pdf-lib emits a 1.7 file header; retain a 2.0 source's effective version.
  if (pdf.context.header.toString().startsWith('%PDF-2.')) pdf.catalog.set(n('Version'),n('2.0'));
  let collection = dict(pdf.catalog,'Collection');
  const creating = !collection;
  if (!collection) { collection = pdf.context.obj({Type:'Collection',View:'D'}); pdf.catalog.set(n('Collection'),collection); }
  const tree = folders(collection);
  if (!tree.length && changes.folders?.length) {
    const root = pdf.context.obj({Type:'Folder',ID:0,Name:PDFHexString.fromText('Root')});
    collection.set(n('Folders'),pdf.context.register(root)); tree.push({id:0,parentId:null,name:'Root',node:root});
  }
  for (const item of changes.folders || []) {
    const parent = tree.find(f => f.id === item.parentId);
    if (!parent) throw new Error('FOLDER_NOT_FOUND');
    const name = label(item.name);
    if (tree.some(f => f.parentId === parent.id && f.name === name)) throw new Error('DUPLICATE_FOLDER');
    const id = Math.max(...tree.map(f => f.id)) + 1;
    if (!Number.isSafeInteger(id)) throw new Error('INVALID_FOLDER_ID');
    const parentRef = pdf.context.getObjectRef(parent.node) || pdf.context.register(parent.node);
    const child = pdf.context.obj({Type:'Folder',ID:id,Name:PDFHexString.fromText(name),Parent:parentRef});
    const old = parent.node.get(n('Child')); if (old) child.set(n('Next'),old);
    parent.node.set(n('Child'),pdf.context.register(child)); tree.push({id,parentId:parent.id,name,node:child});
  }
  // Folder dictionaries require PDF 1.7 developer extension level 3 or PDF 2.0.
  if (tree.length && String(pdf.catalog.lookup(n('Version')) || '') !== '/2.0') {
    pdf.catalog.set(n('Version'),n('1.7'));
    let ext = dict(pdf.catalog,'Extensions'); if (!ext) { ext=pdf.context.obj({}); pdf.catalog.set(n('Extensions'),ext); }
    const adbe = dict(ext,'ADBE');
    if ((number(adbe?.lookup(n('ExtensionLevel'))) || 0) < 3) ext.set(n('ADBE'),pdf.context.obj({BaseVersion:'1.7',ExtensionLevel:3}));
  } else if (creating && !tree.length && String(pdf.catalog.lookup(n('Version')) || '') !== '/2.0') pdf.catalog.set(n('Version'),n('1.7'));
  const original = entries(pdf), remove = changes.remove || [];
  for (const key of remove) if (!original.some(e => e.key === key)) throw new Error('COMPONENT_NOT_FOUND');
  const used = new Set(original.filter(e => !remove.includes(e.key)).map(e => e.key));
  const added = [];
  for (const item of changes.add || []) {
    const name = label(item.name), folderId = item.folderId ?? tree[0]?.id ?? null;
    if (folderId !== null && !tree.some(f => f.id === folderId)) throw new Error('FOLDER_NOT_FOUND');
    const key = folderId === null ? name : `<${folderId}>${name}`;
    if (used.has(key)) throw new Error('DUPLICATE_COMPONENT');
    if (!(item.bytes instanceof Uint8Array)) throw new Error('COMPONENT_BYTES_REQUIRED');
    used.add(key); added.push({naam:key,bytes:item.bytes,beschrijving:item.description || '',mime:item.mime});
  }
  pasBijlagenToe(pdf,{toegevoegd:added,verwijderd:remove});
  // The name tree key carries the folder tag, the displayed filename does not.
  for (const {key,spec} of entries(pdf)) {
    if (added.some(a => a.naam === key)) {
      const name = key.replace(/^<\d+>/,''); spec.set(n('F'),PDFHexString.fromText(name)); spec.set(n('UF'),PDFHexString.fromText(name));
    }
  }
  for (const update of changes.descriptions || []) {
    const entry = entries(pdf).find(e => e.key === update.key); if (!entry) throw new Error('COMPONENT_NOT_FOUND');
    if (typeof update.description !== 'string' || update.description.length > 10000) throw new Error('INVALID_DESCRIPTION');
    entry.spec.set(n('Desc'),PDFHexString.fromText(update.description));
  }
  if (remove.includes(text(collection.lookup(n('D'))))) collection.delete(n('D'));
  if (creating) {
    const page = pdf.insertPage(0,[595,842]), font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('PDF Collection',{x:48,y:760,size:24,font});
    page.drawText('This document contains embedded component files.',{x:48,y:715,size:12,font});
    page.drawText('Open the attachments panel in a PDF reader to view or export them.',{x:48,y:690,size:11,font});
    page.drawText('The following pages retain the original document.',{x:48,y:665,size:11,font});
  }
  const output = await pdf.save();
  const reopened = await PDFDocument.load(output.slice());
  return {bytes:output,portfolio:inspectPortfolio(reopened)};
}
