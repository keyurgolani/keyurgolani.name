// One file out of a zip archive, as GitHub serves an Actions artifact, read with Node alone so
// rc-verify needs no install. The archive is untrusted: every offset and size is bounds-checked,
// only stored and deflated entries are read, a ZIP64, encrypted, or multi-disk archive is refused,
// the entry's CRC-32 and size must match, and nothing is ever written to disk.
//
// Pure Node with no dependencies.
import * as zlib from 'node:zlib';

/** CRC-32 (zlib's, where this Node has it: 20.15 and 22.2 on; else the same table, by hand). */
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(bytes) >>> 0;
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The bytes of `name` in `zip` (a Buffer), or null when the archive has no such entry. Throws,
 * naming why, on anything malformed or larger than `maxBytes` uncompressed.
 */
export function zipEntry(zip, name, { maxBytes = 64 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(zip)) throw new Error('the archive is not bytes');
  const fail = (why) => {
    throw new Error(`the archive is malformed: ${why}`);
  };
  const u16 = (at) =>
    at + 2 <= zip.length ? zip.readUInt16LE(at) : fail(`a read at ${at} runs past the end`);
  const u32 = (at) =>
    at + 4 <= zip.length ? zip.readUInt32LE(at) : fail(`a read at ${at} runs past the end`);
  // The end-of-central-directory record: 22 bytes, then a comment of at most 65535.
  let eocd = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) fail('no end-of-central-directory record');
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0) fail('a multi-disk archive');
  const count = u16(eocd + 10);
  const size = u32(eocd + 12);
  const start = u32(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) fail('a ZIP64 archive');
  if (start + size > eocd) fail('the central directory runs past its end record');
  let at = start;
  for (let entry = 0; entry < count; entry += 1) {
    if (u32(at) !== CENTRAL) fail(`central entry ${entry + 1} has no signature`);
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const packed = u32(at + 20);
    const unpacked = u32(at + 24);
    const nameLength = u16(at + 28);
    const extra = u16(at + 30);
    const comment = u16(at + 32);
    const local = u32(at + 42);
    if (at + 46 + nameLength > zip.length)
      fail(`central entry ${entry + 1}'s name runs past the end`);
    const entryName = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (entryName !== name) continue;
    if (flags & 0x1) fail(`${name} is encrypted`);
    if (packed === 0xffffffff || unpacked === 0xffffffff) fail(`${name} is a ZIP64 entry`);
    if (unpacked > maxBytes) fail(`${name} is ${unpacked} bytes, over ${maxBytes}`);
    if (u32(local) !== LOCAL) fail(`${name}'s local header has no signature`);
    const data = local + 30 + u16(local + 26) + u16(local + 28);
    if (data + packed > zip.length) fail(`${name}'s data runs past the end`);
    const raw = zip.subarray(data, data + packed);
    let bytes;
    if (method === 0) bytes = Buffer.from(raw);
    else if (method === 8) {
      try {
        bytes = zlib.inflateRawSync(raw, { maxOutputLength: maxBytes });
      } catch (error) {
        fail(`${name} doesn't inflate: ${error.message}`);
      }
    } else fail(`${name} uses compression method ${method}`);
    if (bytes.length !== unpacked)
      fail(`${name} inflates to ${bytes.length} bytes, not ${unpacked}`);
    if (crc32(bytes) !== crc) fail(`${name}'s CRC-32 doesn't match`);
    return bytes;
  }
  return null;
}
