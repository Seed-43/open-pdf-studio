// Module Web Worker van de rasterexport (#701): codeert een paginabeeld naar
// JPEG buiten de hoofdthread. Bericht in: { id, bitmap (ImageBitmap,
// overgedragen), quality }; uit: { id, buf (ArrayBuffer, overgedragen) } of
// { id, fout }. Aangemaakt vanuit raster-export.js.

self.onmessage = async (e) => {
  const { id, bitmap, quality } = e.data || {};
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await blob.arrayBuffer();
    self.postMessage({ id, buf }, [buf]);
  } catch (err) {
    try { bitmap?.close?.(); } catch { /* al gesloten */ }
    self.postMessage({ id, fout: String(err?.message || err) });
  }
};
