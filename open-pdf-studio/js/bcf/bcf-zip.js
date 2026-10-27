// Minimal, dependency-free ZIP reader/writer for BCF (.bcfzip) files.
//
// Writer uses the STORE method (no compression) so it is fully synchronous
// and produces a valid ZIP that every BCF-capable tool accepts — snapshots
// are PNG (already compressed) and the XML payloads are tiny, so compression
// buys little here.
//
// Reader understands both STORE (method 0) and DEFLATE (method 8, used by
// most external tools) via the platform-native DecompressionStream, which is
// available in both the WebView (Chromium) and Node 18+. No third-party zip
// dependency is required.
//
// This module is pure (no app/browser-DOM imports) so it can be unit-tested
// directly under Node.

const textEncoder = new TextEncoder();

// --- CRC32 -----------------------------------------------------------------
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}

function crc32(bytes) {
  const t = crcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// DOS date/time for a fixed, reproducible timestamp (BCF does not rely on it).
function dosDateTime(date) {
  const d = date || new Date();
  const time = (Math.floor(d.getSeconds() / 2)) | (d.getMinutes() << 5) | (d.getHours() << 11);
  const day = d.getDate() | ((d.getMonth() + 1) << 5) | (Math.max(0, d.getFullYear() - 1980) << 9);
  return { time: time & 0xFFFF, date: day & 0xFFFF };
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return textEncoder.encode(String(content));
}

/**
 * Build a ZIP archive (STORE method) from a list of entries.
 * @param {Array<{name: string, data: (Uint8Array|ArrayBuffer|string)}>} entries
 * @param {Date} [modDate]
 * @returns {Uint8Array}
 */
export function zipStore(entries, modDate) {
  return buildZip(entries.map((entry) => {
    const data = toBytes(entry.data);
    return { name: entry.name, method: 0, crc: crc32(data), size: data.length, payload: data };
  }), modDate);
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Build a ZIP archive with DEFLATE entries (STORE where deflating does not
 * make an entry smaller), via the platform-native CompressionStream.
 * @param {Array<{name: string, data: (Uint8Array|ArrayBuffer|string)}>} entries
 * @param {Date} [modDate]
 * @returns {Promise<Uint8Array>}
 */
export async function zipDeflate(entries, modDate) {
  const prepared = [];
  for (const entry of entries) {
    const data = toBytes(entry.data);
    const packed = await deflateRaw(data);
    const deflated = packed.length < data.length;
    prepared.push({ name: entry.name, method: deflated ? 8 : 0, crc: crc32(data), size: data.length, payload: deflated ? packed : data });
  }
  return buildZip(prepared, modDate);
}

function buildZip(prepared, modDate) {
  const { time, date } = dosDateTime(modDate);
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const entry of prepared) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = entry.payload;
    const { crc, size, method } = entry;

    // Local file header (30 bytes + name).
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // version needed
    lv.setUint16(6, 0x0800, true);    // flags: UTF-8 filename
    lv.setUint16(8, method, true);    // method: 0 store, 8 deflate
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, size, true);     // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);        // extra length
    lh.set(nameBytes, 30);

    localParts.push(lh, data);

    // Central directory header (46 bytes + name).
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // version made by
    cv.setUint16(6, 20, true);        // version needed
    cv.setUint16(8, 0x0800, true);    // flags
    cv.setUint16(10, method, true);   // method
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);        // extra length
    cv.setUint16(32, 0, true);        // comment length
    cv.setUint16(34, 0, true);        // disk number start
    cv.setUint16(36, 0, true);        // internal attrs
    cv.setUint32(38, 0, true);        // external attrs
    cv.setUint32(42, offset, true);   // local header offset
    ch.set(nameBytes, 46);
    central.push(ch);

    offset += lh.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, prepared.length, true);
  ev.setUint16(10, prepared.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of localParts) { out.set(part, p); p += part.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

// --- Reader ----------------------------------------------------------------

async function inflateRaw(bytes) {
  // Native raw-deflate decompression, present in Chromium WebView and Node 18+.
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable — cannot read compressed ZIP entry');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

function findEOCD(view, len) {
  // Scan backwards for the End Of Central Directory signature.
  const min = Math.max(0, len - 22 - 65535);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Parse a ZIP archive into a map of filename → Uint8Array.
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = buf.length;
  const decoder = new TextDecoder();

  const eocd = findEOCD(view, len);
  if (eocd < 0) throw new Error('Not a valid ZIP archive (no EOCD record)');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const result = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    // Directory entries end with '/'.
    if (name.endsWith('/')) continue;

    // Local header: recompute data start (local name/extra lengths can differ).
    if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for "${name}"`);
    }
    result.set(name, data);
  }
  return result;
}
