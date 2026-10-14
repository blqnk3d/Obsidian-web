/* ============================================================
   zip.js — minimal ZIP writer (STORE method, no compression).
   Pure logic: buildZip(entries) -> Uint8Array.  (Obs.zip)
   Entries: [{ path: 'dir/file.md', data: Uint8Array | string | Blob | ArrayBuffer, date?: Date }]
   ============================================================ */
(function (global) {
  'use strict';
  const Obs = global.Obs = global.Obs || {};
  const { strToBytes, safeRelPath } = Obs.util;

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- DOS date/time ---------- */
  function dosDateTime(d) {
    d = d || new Date();
    const year = Math.max(1980, d.getFullYear());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return strToBytes(data);
    throw new Error('zip: unsupported data type');
  }

  /** Build a ZIP archive. Returns Uint8Array. */
  async function buildZip(entries) {
    const enc = strToBytes;
    const prepared = [];
    for (const e of entries) {
      const name = safeRelPath(e.path) || 'unnamed';
      prepared.push({
        nameBytes: enc(name),
        bytes: await toBytes(e.data),
        dt: dosDateTime(e.date)
      });
    }

    // Local file header = 30 bytes + name; central header = 46 bytes + name
    let offset = 0;
    const localParts = [];
    for (const p of prepared) {
      p.offset = offset;
      const crc = crc32(p.bytes);
      p.crc = crc;
      const header = new Uint8Array(30 + p.nameBytes.length);
      const dv = new DataView(header.buffer);
      dv.setUint32(0, 0x04034b50, true);   // local file header signature
      dv.setUint16(4, 20, true);            // version needed
      dv.setUint16(6, 0x0800, true);        // flags: UTF-8 names
      dv.setUint16(8, 0, true);             // method: store
      dv.setUint16(10, p.dt.time, true);
      dv.setUint16(12, p.dt.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, p.bytes.length, true);
      dv.setUint32(22, p.bytes.length, true);
      dv.setUint16(26, p.nameBytes.length, true);
      dv.setUint16(28, 0, true);            // extra length
      header.set(p.nameBytes, 30);
      localParts.push(header, p.bytes);
      offset += header.length + p.bytes.length;
    }

    const cdStart = offset;
    const centralParts = [];
    let cdSize = 0;
    for (const p of prepared) {
      const ch = new Uint8Array(46 + p.nameBytes.length);
      const dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014b50, true);   // central directory signature
      dv.setUint16(4, 20, true);            // version made by
      dv.setUint16(6, 20, true);            // version needed
      dv.setUint16(8, 0x0800, true);        // flags: UTF-8
      dv.setUint16(10, 0, true);            // method
      dv.setUint16(12, p.dt.time, true);
      dv.setUint16(14, p.dt.date, true);
      dv.setUint32(16, p.crc, true);
      dv.setUint32(20, p.bytes.length, true);
      dv.setUint32(24, p.bytes.length, true);
      dv.setUint16(28, p.nameBytes.length, true);
      dv.setUint16(30, 0, true);            // extra len
      dv.setUint16(32, 0, true);            // comment len
      dv.setUint16(34, 0, true);            // disk number
      dv.setUint16(36, 0, true);            // internal attrs
      dv.setUint32(38, 0, true);            // external attrs
      dv.setUint32(42, p.offset, true);     // local header offset
      ch.set(p.nameBytes, 46);
      centralParts.push(ch);
      cdSize += ch.length;
    }

    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, prepared.length, true);
    dv.setUint16(10, prepared.length, true);
    dv.setUint32(12, cdSize, true);
    dv.setUint32(16, cdStart, true);
    dv.setUint16(20, 0, true);

    let total = offset + cdSize + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of localParts.concat(centralParts, [eocd])) {
      out.set(part, pos);
      pos += part.length;
    }
    return out;
  }

  Obs.zip = { buildZip, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
