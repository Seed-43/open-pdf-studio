import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export function overlap(a, b) {
  const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

/** Finds empty outlines and writing lines in a bounded, unrotated page raster.
 * Heuristic candidates only: approval is always explicit. Works on scans and
 * vector pages through the same pixel path; never creates fields by itself.
 */
export function detectFormShapes({ data, width, height }, scale = 1) {
  if (!Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width * height > 4000000
    || data.length !== width * height * 4
    || !(scale > 0)) throw new Error('INVALID_RASTER');
  const mask = new Uint8Array(width * height),
    seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length),
    out = [];
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 128 && (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 < 170 ? 1 : 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0,
      tail = 1,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const p = queue[head++],
        x = p % width,
        y = Math.floor(p / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const q of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y > 0 ? p - width : -1, y + 1 < height ? p + width : -1, x > 0 && y > 0 ? p - width - 1 : -1, x + 1 < width && y > 0 ? p - width + 1 : -1, x > 0 && y + 1 < height ? p + width - 1 : -1, x + 1 < width && y + 1 < height ? p + width + 1 : -1]) if (q >= 0 && mask[q] && !seen[q]) {
        seen[q] = 1;
        queue[tail++] = q;
      }
    }
    const w = (maxX - minX + 1) / scale,
      h = (maxY - minY + 1) / scale;
    if (w >= 35 && w <= 600 && h <= 3 && h > 0) {
      out.push({
        x: minX / scale,
        y: Math.max(0, minY / scale - 16),
        width: w,
        height: 16,
        type: 'text',
        confidence: 0.55,
        source: 'writing-line'
      });
      continue;
    }
    if (w < 7 || h < 7 || w > 600 || h > 48 || tail / ((maxX - minX + 1) * (maxY - minY + 1)) > 0.5) continue;
    let inside = 0,
      total = 0,
      corners = 0,
      cornerTotal = 0;
    const insetX = Math.max(2, Math.floor((maxX - minX + 1) * .22)),
      insetY = Math.max(2, Math.floor((maxY - minY + 1) * .22));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const edgeX = x < minX + insetX || x > maxX - insetX,
        edgeY = y < minY + insetY || y > maxY - insetY;
      if (!edgeX && !edgeY) {
        total++;
        inside += mask[y * width + x];
      }
      if (edgeX && edgeY) {
        cornerTotal++;
        corners += mask[y * width + x];
      }
    }
    if (!total || inside / total > .06) continue;
    const square = w / h > .75 && w / h < 1.3 && w <= 30 && h <= 30;
    if (!square && w < 35) continue;
    out.push({
      x: minX / scale,
      y: minY / scale,
      width: w,
      height: h,
      type: square ? corners / Math.max(1, cornerTotal) < .15 ? 'radio' : 'checkbox' : 'text',
      confidence: square ? .7 : .65,
      source: 'empty-outline'
    });
  }
  return out.filter((r, i) => !out.slice(0, i).some(a => overlap(a, r) > .6)).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 500);
}

export function labelCandidates(shapes, words = []) {
  return shapes.map((shape, index) => {
    const nearby = words.filter(w => w.text?.trim()
      && (Math.abs(w.y - shape.y) < Math.max(shape.height, 18) && (w.x + w.width <= shape.x + 4 && shape.x - w.x - w.width < 180 || shape.type !== 'text' && w.x >= shape.x + shape.width - 4 && w.x - shape.x - shape.width < 120) || w.y + w.height <= shape.y + 3 && shape.y - w.y - w.height < 24 && w.x < shape.x + shape.width && w.x + w.width > shape.x));
    nearby.sort((a, b) => Math.abs(a.y - shape.y) - Math.abs(b.y - shape.y) || a.x - b.x);
    const first = nearby[0],
      line = first ? nearby.filter(w => Math.abs(w.y - first.y) < Math.max(5, first.height / 2)).sort((a, b) => a.x - b.x) : [];
    const label = line.map(w => w.text).join(' ').replace(/[_:]+$/, '').trim() || `Field ${index + 1}`;
    return {
      ...shape,
      label,
      name: `field_${index + 1}`,
      required: false,
      group: '',
      option: `option_${index + 1}`,
      order: index + 1,
      accepted: false
    };
  });
}

export async function createRecognizedForm(bytes, candidates) {
  if (!Array.isArray(candidates) || candidates.length > 1000) throw new Error('INVALID_CANDIDATES');
  const pdf = await PDFDocument.load(bytes.slice()),
    form = pdf.getForm(),
    existing = new Set(form.getFields().map(f => f.getName())),
    used = new Set(),
    radios = new Map();
  const accepted = candidates.filter(c => c.accepted).sort((a, b) => a.order - b.order);
  if (!accepted.length) throw new Error('NO_ACCEPTED_FIELDS');
  const occupied = new Map();
  for (const [i, page] of pdf.getPages().entries()) {
    const widgets = (page.node.Annots()?.asArray() || []).map(ref => pdf.context.lookup(ref)).filter(d => d?.lookup?.(PDFName.of('Subtype')) === PDFName.of('Widget'));
    occupied.set(i + 1, widgets.map(w => {
      const r = w.lookup(PDFName.of('Rect'))?.asArray().map(x => x.asNumber());
      return r ? { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1] } : null;
    }).filter(Boolean));
  }
  for (const c of accepted) {
    if (!Number.isInteger(c.page) || c.page < 1 || c.page > pdf.getPageCount() || !['text', 'checkbox', 'radio'].includes(c.type)) throw new Error('INVALID_FIELD');
    const page = pdf.getPage(c.page - 1),
      box = page.getCropBox(),
      b = c.bounds;
    if (!b
      || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k]))
      || b.width < 3
      || b.height < 3
      || b.x < box.x - .01
      || b.y < box.y - .01
      || b.x + b.width > box.x + box.width + .01
      || b.y + b.height > box.y + box.height + .01) throw new Error('INVALID_BOUNDS');
    if (occupied.get(c.page).some(r => overlap(r, b) > .35)) throw new Error('OVERLAPPING_FIELDS');
    occupied.get(c.page).push(b);
    const name = c.type === 'radio' ? c.group : c.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[.\x00-\x1f]/.test(name) || existing.has(name)) throw new Error('INVALID_OR_DUPLICATE_NAME');
    if (!Number.isFinite(c.order) || typeof c.label !== 'string' || !c.label.trim()) throw new Error('LABEL_AND_ORDER_REQUIRED');
    let field;
    if (c.type === 'radio') {
      if (typeof c.option !== 'string' || !c.option.trim()) throw new Error('RADIO_OPTION_REQUIRED');
      let group = radios.get(name);
      if (!group) {
        if (used.has(name)) throw new Error('INVALID_OR_DUPLICATE_NAME');
        field = form.createRadioGroup(name);
        group = { field, options: new Set(), required: !!c.required, label: c.groupLabel || c.label };
        radios.set(name, group);
        used.add(name);
      } else field = group.field;
      if (group.options.has(c.option)) throw new Error('DUPLICATE_RADIO_OPTION');
      if (group.required !== !!c.required || c.groupLabel && group.label !== c.groupLabel) throw new Error('INCONSISTENT_RADIO_GROUP');
      group.options.add(c.option);
      field.addOptionToPage(c.option, page, { ...b, borderWidth: 0, backgroundColor: undefined });
      field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(group.label));
    } else {
      if (used.has(name)) throw new Error('INVALID_OR_DUPLICATE_NAME');
      used.add(name);
      field = c.type === 'checkbox' ? form.createCheckBox(name) : form.createTextField(name);
      field.addToPage(page, { ...b, borderWidth: 0, backgroundColor: undefined });
      field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(c.label));
    }
    const widget = field.acroField.getWidgets().at(-1);
    widget?.dict.set(PDFName.of('TU'), PDFHexString.fromText(c.label));
    if (c.required) field.enableRequired();
    // /Tabs absent uses annotation-array order; accepted proposals are appended
    // in reviewed order. Preserve order of already existing widgets.
    page.node.delete(PDFName.of('Tabs'));
  }
  form.updateFieldAppearances();
  const output = await pdf.save();
  const reopened = await PDFDocument.load(output.slice());
  return {
    bytes: output,
    created: accepted.length,
    fields: reopened.getForm().getFields().map(f => f.getName())
  };
}
