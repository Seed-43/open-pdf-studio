// pdf-lib yields to the event loop every 100 objects when parsing and every
// 50 when saving (setTimeout per batch, >= 4 ms each in a WebView). A large
// CAD set has 100k+ objects, so most of a save was spent in those pauses:
// a 156-page, 140k-object drawing set took 19 s to load and 28 s to save,
// against 3 s and 1.6 s with large batches (same output bytes).
//
// This raises the defaults once for every PDFDocument.load / save in the app.
// Batches of 5000 still yield a few dozen times on huge files, so the saving
// overlay keeps animating. Callers that pass their own value keep it.
import { PDFDocument } from 'pdf-lib';

const OBJECTS_PER_TICK = 5000;

if (!PDFDocument.__opsSpeedPatched) {
  const origLoad = PDFDocument.load.bind(PDFDocument);
  PDFDocument.load = (bytes, options = {}) =>
    origLoad(bytes, { parseSpeed: OBJECTS_PER_TICK, ...options });

  const origSave = PDFDocument.prototype.save;
  PDFDocument.prototype.save = function save(options = {}) {
    return origSave.call(this, { objectsPerTick: OBJECTS_PER_TICK, ...options });
  };

  PDFDocument.__opsSpeedPatched = true;
}
