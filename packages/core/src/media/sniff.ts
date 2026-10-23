import { recordOwnerModule } from '../load-trace';
import type { ImageType } from './limits';

// A source's type, from its first bytes alone (#10, slice 2 item 3): never
// its file name, its URL, or a Content-Type header. Anything else, such as
// GIF, SVG, TIFF, HEIC, or HTML, is no image here.

recordOwnerModule('core/media/sniff');

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** The image type `bytes` start as, or null. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= PNG.length && PNG.every((byte, index) => bytes[index] === byte)) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // ISO BMFF: a leading ftyp box whose major or a compatible brand is AVIF.
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > bytes.length || size % 4 !== 0) return null;
    if (AVIF_BRANDS.has(ascii(bytes, 8, 12))) return 'image/avif';
    for (let at = 16; at + 4 <= size; at += 4) {
      if (AVIF_BRANDS.has(ascii(bytes, at, at + 4))) return 'image/avif';
    }
  }
  return null;
}
