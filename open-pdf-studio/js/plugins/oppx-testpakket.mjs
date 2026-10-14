// Testhulp (#550): schrijft een ongecomprimeerd ZIP-bestand ("stored") voor
// synthetische .oppx-pakketten. Met een eigen CRC32, zodat het ook op Node 20
// werkt (zlib.crc32 bestaat daar niet). Er komen geen binaire bestanden in git:
// tests en scripts/verify-extensies.mjs maken de pakketten bij het draaien.

let tabel = null;

/** CRC-32 (IEEE 802.3), zoals ZIP die gebruikt. */
export function crc32(bytes) {
  if (!tabel) {
    tabel = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabel[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = tabel[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const naarBytes = (inhoud) => (typeof inhoud === 'string' ? new TextEncoder().encode(inhoud) : new Uint8Array(inhoud));

/**
 * Maak een ZIP-archief zonder compressie.
 * @param {{ naam: string, inhoud?: string|Uint8Array }[]} items  een naam op `/` is een map
 * @returns {Uint8Array}
 */
export function maakZip(items) {
  const lokaal = [];
  const centraal = [];
  let positie = 0;
  for (const { naam, inhoud = '' } of items) {
    const naamBytes = new TextEncoder().encode(naam);
    const data = naam.endsWith('/') ? new Uint8Array(0) : naarBytes(inhoud);
    const crc = crc32(data);
    const kop = new DataView(new ArrayBuffer(30));
    kop.setUint32(0, 0x04034b50, true);
    kop.setUint16(4, 20, true);         // versie nodig
    kop.setUint16(6, 0x0800, true);     // UTF-8-namen
    kop.setUint16(8, 0, true);          // stored
    kop.setUint16(10, 0, true);         // tijd
    kop.setUint16(12, 0x21, true);      // datum 1980-01-01
    kop.setUint32(14, crc, true);
    kop.setUint32(18, data.length, true);
    kop.setUint32(22, data.length, true);
    kop.setUint16(26, naamBytes.length, true);
    kop.setUint16(28, 0, true);
    lokaal.push(new Uint8Array(kop.buffer), naamBytes, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, naamBytes.length, true);
    c.setUint32(38, naam.endsWith('/') ? 0x10 : 0, true); // extern: map
    c.setUint32(42, positie, true);
    centraal.push(new Uint8Array(c.buffer), naamBytes);
    positie += 30 + naamBytes.length + data.length;
  }
  const centraalLengte = centraal.reduce((s, b) => s + b.length, 0);
  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true);
  eind.setUint16(8, items.length, true);
  eind.setUint16(10, items.length, true);
  eind.setUint32(12, centraalLengte, true);
  eind.setUint32(16, positie, true);
  const delen = [...lokaal, ...centraal, new Uint8Array(eind.buffer)];
  const uit = new Uint8Array(delen.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const d of delen) { uit.set(d, o); o += d.length; }
  return uit;
}

/**
 * Een .oppx-pakket: plugin.json en index.js in de wortel, plus eventuele
 * extra items.
 */
export function maakOppx({ id, name = id, version, code, extra = [] }) {
  const manifest = { id, name };
  if (version !== undefined) manifest.version = version;
  return maakZip([
    { naam: 'plugin.json', inhoud: JSON.stringify(manifest, null, 2) },
    { naam: 'index.js', inhoud: code },
    ...extra,
  ]);
}

/** Lees de items van een (ongecomprimeerd) ZIP terug; voor tests. */
export function leesZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eind = bytes.length - 22;
  while (eind >= 0 && v.getUint32(eind, true) !== 0x06054b50) eind--;
  if (eind < 0) throw new Error('geen ZIP');
  const aantal = v.getUint16(eind + 10, true);
  let p = v.getUint32(eind + 16, true);
  const items = [];
  for (let i = 0; i < aantal; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('kapotte centrale map');
    const crc = v.getUint32(p + 16, true);
    const grootte = v.getUint32(p + 24, true);
    const naamLengte = v.getUint16(p + 28, true);
    const extraLengte = v.getUint16(p + 30, true);
    const commentaarLengte = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const naam = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + naamLengte));
    const lokaalNaam = v.getUint16(offset + 26, true);
    const lokaalExtra = v.getUint16(offset + 28, true);
    const data = bytes.subarray(offset + 30 + lokaalNaam + lokaalExtra, offset + 30 + lokaalNaam + lokaalExtra + grootte);
    items.push({ naam, crc, data });
    p += 46 + naamLengte + extraLengte + commentaarLengte;
  }
  return items;
}
