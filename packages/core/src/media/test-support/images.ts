import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { recordOwnerModule } from '../../load-trace';

// Test images, made here from nothing (MIT, like the repository): solid or
// two-tone pictures from sharp, and the metadata a camera writes spliced in
// by hand, so a test knows exactly what a source carries. Nothing is
// downloaded.

recordOwnerModule('core/media/test-support/images');

export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly alpha?: boolean;
  /** #rrggbb; the right half is white, so dominant colour and orientation show. */
  readonly color?: string;
}

const rgb = (color: string) => ({
  r: Number.parseInt(color.slice(1, 3), 16),
  g: Number.parseInt(color.slice(3, 5), 16),
  b: Number.parseInt(color.slice(5, 7), 16),
});

/** The picture as a sharp pipeline: `color` on the left two thirds, white on the right. */
function picture({ width, height, alpha = false, color = '#336699' }: Picture) {
  const left = Math.max(1, Math.round((width * 2) / 3));
  const channels = alpha ? 4 : 3;
  const background = alpha ? { ...rgb(color), alpha: 0.5 } : rgb(color);
  const white = alpha ? { r: 255, g: 255, b: 255, alpha: 0.5 } : { r: 255, g: 255, b: 255 };
  const pipeline = sharp({ create: { width, height, channels, background } });
  return width - left > 0
    ? pipeline.composite([
        {
          input: { create: { width: width - left, height, channels, background: white } },
          left,
          top: 0,
        },
      ])
    : pipeline;
}

/** Composite first, then encode: sharp encodes a composite in one pass. */
async function encode(
  input: Picture,
  format: 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff',
): Promise<Uint8Array> {
  const flat = await picture(input).png().toBuffer();
  const image = sharp(flat);
  const out =
    format === 'jpeg'
      ? await image.jpeg({ quality: 90 }).toBuffer()
      : format === 'png'
        ? await image.png().toBuffer()
        : format === 'webp'
          ? await image.webp().toBuffer()
          : format === 'avif'
            ? await image.avif({ effort: 0 }).toBuffer()
            : format === 'gif'
              ? await image.gif().toBuffer()
              : await image.tiff().toBuffer();
  return new Uint8Array(out);
}

export const jpeg = (input: Picture) => encode(input, 'jpeg');
export const png = (input: Picture) => encode(input, 'png');
export const webp = (input: Picture) => encode(input, 'webp');
export const avif = (input: Picture) => encode(input, 'avif');
export const gif = (input: Picture) => encode(input, 'gif');
export const tiff = (input: Picture) => encode(input, 'tiff');

/** A little-endian TIFF block for an APP1 Exif segment: IFD0 and a GPS IFD. */
function exifTiff({ orientation, description }: { orientation: number; description: string }) {
  const text = Buffer.from(`${description}\0`, 'latin1');
  // IFD0: ImageDescription, Orientation, GPS IFD pointer.
  const ifd0At = 8;
  const ifd0Size = 2 + 3 * 12 + 4;
  const textAt = ifd0At + ifd0Size;
  const gpsAt = textAt + text.length + (text.length % 2);
  const gpsSize = 2 + 4 * 12 + 4;
  const latAt = gpsAt + gpsSize;
  const lonAt = latAt + 24;
  const total = lonAt + 24;
  const tiff = Buffer.alloc(total);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0At, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (type === 3 && count === 1) tiff.writeUInt16LE(value, at + 8);
    else tiff.writeUInt32LE(value, at + 8);
  };
  tiff.writeUInt16LE(3, ifd0At);
  entry(ifd0At + 2, 0x010e, 2, text.length, textAt);
  entry(ifd0At + 14, 0x0112, 3, 1, orientation);
  entry(ifd0At + 26, 0x8825, 4, 1, gpsAt);
  tiff.writeUInt32LE(0, ifd0At + 38);
  text.copy(tiff, textAt);
  // GPS IFD: 37° 46' 30" N, 122° 25' 10" W.
  tiff.writeUInt16LE(4, gpsAt);
  entry(gpsAt + 2, 0x0001, 2, 2, 0);
  tiff.write('N\0', gpsAt + 2 + 8, 'latin1');
  entry(gpsAt + 14, 0x0002, 5, 3, latAt);
  entry(gpsAt + 26, 0x0003, 2, 2, 0);
  tiff.write('W\0', gpsAt + 26 + 8, 'latin1');
  entry(gpsAt + 38, 0x0004, 5, 3, lonAt);
  tiff.writeUInt32LE(0, gpsAt + 50);
  for (const [at, values] of [
    [latAt, [37, 46, 30]],
    [lonAt, [122, 25, 10]],
  ] as const) {
    values.forEach((value, index) => {
      tiff.writeUInt32LE(value, at + index * 8);
      tiff.writeUInt32LE(1, at + index * 8 + 4);
    });
  }
  return tiff;
}

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt8(0xff, 0);
  head.writeUInt8(marker, 1);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** An IPTC caption in a Photoshop APP13 segment. */
function iptcPayload(caption: string): Buffer {
  const text = Buffer.from(caption, 'latin1');
  const record = Buffer.concat([Buffer.from([0x1c, 0x02, 0x78]), Buffer.alloc(2), text]);
  record.writeUInt16BE(text.length, 3);
  const padded = record.length % 2 ? Buffer.concat([record, Buffer.alloc(1)]) : record;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(record.length);
  return Buffer.concat([
    Buffer.from('Photoshop 3.0\0', 'latin1'),
    Buffer.from('8BIM', 'latin1'),
    Buffer.from([0x04, 0x04, 0x00, 0x00]),
    size,
    padded,
  ]);
}

export interface CameraMetadata {
  /** The EXIF orientation, 1 to 8. */
  readonly orientation?: number;
  /** A marker written into the EXIF description, the XMP packet, and the IPTC caption. */
  readonly canary: string;
}

/**
 * A JPEG as a camera might write it: EXIF with an orientation, a
 * description, and GPS coordinates; an XMP packet; and an IPTC caption,
 * each holding `canary`.
 */
export async function cameraJpeg(input: Picture, metadata: CameraMetadata): Promise<Uint8Array> {
  const plain = Buffer.from(await jpeg(input));
  const exif = segment(
    0xe1,
    Buffer.concat([
      Buffer.from('Exif\0\0', 'latin1'),
      exifTiff({ orientation: metadata.orientation ?? 1, description: metadata.canary }),
    ]),
  );
  const xmp = segment(
    0xe1,
    Buffer.from(
      'http://ns.adobe.com/xap/1.0/\0' +
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        `<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="${metadata.canary}"/>` +
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
      'latin1',
    ),
  );
  const iptc = segment(0xed, iptcPayload(metadata.canary));
  // After SOI and the JFIF APP0 segment, when there is one.
  let at = 2;
  if (plain[2] === 0xff && plain[3] === 0xe0) at = 4 + plain.readUInt16BE(4);
  return new Uint8Array(
    Buffer.concat([plain.subarray(0, at), exif, xmp, iptc, plain.subarray(at)]),
  );
}

/** A PNG whose header claims `width` × `height`, with a valid CRC, over a tiny picture's data. */
export async function pngClaiming(width: number, height: number): Promise<Uint8Array> {
  const bytes = Buffer.from(await png({ width: 4, height: 4 }));
  // Signature (8), IHDR length (4), "IHDR" (4), then width and height.
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)) >>> 0, 29);
  return new Uint8Array(bytes);
}

/** Whether `needle` appears anywhere in `bytes`, as Latin-1 or UTF-16. */
export function carries(bytes: Uint8Array, needle: string): boolean {
  const haystack = Buffer.from(bytes);
  return (
    haystack.includes(Buffer.from(needle, 'latin1')) ||
    haystack.includes(Buffer.from(needle, 'utf16le'))
  );
}
