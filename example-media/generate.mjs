#!/usr/bin/env node
/**
 * generate.mjs: draws the bundled example's images (#10, item 10). Every
 * image is made here, from code alone: no photograph, font, or file from
 * anywhere else, so each is the project's own work, dedicated to the public
 * domain (CC0 1.0). Nothing is fetched or downloaded.
 *
 *   node example-media/generate.mjs           Write the images and provenance.json.
 *   node example-media/generate.mjs --check   Exit 1 unless every image's pixels
 *                                             match provenance.json.
 *
 * The pixels are deterministic: the same code always draws the same RGB
 * values, which provenance.json records as pixelsSha256. The PNG bytes come
 * from node:zlib at level 9, so another zlib could compress them a little
 * differently; fileSha256 records the committed bytes. Each file stays under
 * 150 KB and all of them under 3 MB. Dependency-free: node:zlib, node:fs,
 * node:path, node:crypto, node:url.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_BYTES = 150 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

// --- Drawing helpers ---------------------------------------------------------

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const mix = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const hex = (value) => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];
/** A vertical gradient through the stops, each [position 0..1, color]. */
function gradient(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    const [at, color] = stops[i];
    if (t <= at) {
      const [from, start] = stops[i - 1];
      return mixColor(start, color, smooth(from, at, t));
    }
  }
  return stops.at(-1)[1];
}
/** Coverage of a disc, antialiased over one pixel. */
const disc = (x, y, cx, cy, r) => clamp(r - Math.hypot(x - cx, y - cy) + 0.5);
/** Coverage of a rounded rectangle, antialiased over one pixel. */
function roundedRect(x, y, left, top, width, height, radius) {
  const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
  const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
  return clamp(radius - Math.hypot(dx, dy) + 0.5);
}
const over = (base, color, alpha) => mixColor(base, color, clamp(alpha));

// --- The images --------------------------------------------------------------

/** Each image: a file under example-media, its size, what it shows, and how to draw a pixel. */
const IMAGES = [
  {
    file: 'anamika/portrait.png',
    width: 480,
    height: 480,
    shows: 'An abstract portrait: a dark head-and-shoulders silhouette on a warm amber gradient.',
    pixel(x, y, w, h) {
      let color = gradient(
        [
          [0, hex('#f6d7a7')],
          [0.6, hex('#e9a66b')],
          [1, hex('#b8653a')],
        ],
        y / h,
      );
      const head = disc(x, y, w * 0.5, h * 0.4, w * 0.16);
      const shoulders = roundedRect(x, y, w * 0.22, h * 0.6, w * 0.56, h * 0.5, w * 0.2);
      color = over(color, hex('#3b2a26'), Math.max(head, shoulders));
      return color;
    },
  },
  {
    file: 'og/anamika.png',
    width: 1200,
    height: 630,
    shows: 'Three overlapping translucent discs, amber, teal, and plum, on a cream ground.',
    pixel(x, y, w, h) {
      let color = gradient(
        [
          [0, hex('#fbf3e6')],
          [1, hex('#efe2cc')],
        ],
        y / h,
      );
      color = over(color, hex('#e3963e'), 0.75 * disc(x, y, w * 0.38, h * 0.5, h * 0.3));
      color = over(color, hex('#2f7f86'), 0.6 * disc(x, y, w * 0.5, h * 0.5, h * 0.3));
      color = over(color, hex('#7b3f6e'), 0.5 * disc(x, y, w * 0.62, h * 0.5, h * 0.3));
      return color;
    },
  },
  {
    file: 'work/postmortem-template-kit.png',
    width: 960,
    height: 600,
    shows: 'Five paper cards fanned in a stack, each ruled with grey lines, on a slate background.',
    pixel(x, y, w, h) {
      let color = gradient(
        [
          [0, hex('#3e4a5c')],
          [1, hex('#26303d')],
        ],
        y / h,
      );
      for (let card = 0; card < 5; card++) {
        const left = w * (0.2 + card * 0.06);
        const top = h * (0.18 + card * 0.05);
        const shade = mixColor(hex('#d9dde3'), hex('#ffffff'), card / 4);
        const inside = roundedRect(x, y, left, top, w * 0.42, h * 0.56, 12);
        if (inside > 0) {
          color = over(color, shade, inside);
          const line = (y - top - 40) % 28;
          if (
            card === 4 &&
            y > top + 40 &&
            x > left + 32 &&
            x < left + w * 0.42 - 32 &&
            line >= 0 &&
            line < 3
          ) {
            color = over(color, hex('#9aa3af'), inside);
          }
        }
      }
      return color;
    },
  },
  {
    file: 'work/small-traces.png',
    width: 960,
    height: 600,
    shows:
      'A flame graph: stacked horizontal bars in warm oranges and reds over a near-black ground.',
    pixel(x, y, w, h) {
      let color = hex('#17141a');
      const rows = [
        [0.08, 0.92],
        [0.08, 0.55],
        [0.6, 0.9],
        [0.12, 0.38],
        [0.42, 0.53],
        [0.62, 0.74],
        [0.16, 0.3],
        [0.64, 0.7],
      ];
      rows.forEach(([from, to], index) => {
        const top = h * (0.82 - index * 0.09);
        const bar = roundedRect(x, y, w * from, top, w * (to - from), h * 0.075, 4);
        const tone = mixColor(hex('#f2a541'), hex('#c8402f'), index / (rows.length - 1));
        color = over(color, tone, bar);
      });
      return color;
    },
  },
  {
    file: 'gallery/looking-1.png',
    width: 960,
    height: 640,
    shows: 'A dusk landscape: a low orange sun over three layered blue hills under a violet sky.',
    pixel: dusk({
      sky: ['#4b3f72', '#c9708f', '#f4b26b'],
      sun: 0.3,
      light: '#ff9f4a',
      hills: ['#41507a', '#2e3a5e', '#1d2440'],
    }),
  },
  {
    file: 'gallery/looking-2.png',
    width: 960,
    height: 640,
    shows:
      'A pale morning landscape: a white sun high over soft green hills under a misty blue sky.',
    pixel: dusk({
      sky: ['#9fc1d8', '#d7e6ea', '#f2efe4'],
      sun: 0.62,
      light: '#fffdf5',
      hills: ['#a9c2a0', '#7fa182', '#557a63'],
    }),
  },
  {
    file: 'gallery/looking-3.png',
    width: 960,
    height: 640,
    shows: 'A night landscape: a pale moon over black hills under a deep blue sky.',
    pixel: dusk({
      sky: ['#0d1430', '#1c2a5a', '#2f4078'],
      sun: 0.75,
      light: '#e9edf5',
      hills: ['#151b33', '#0e1224', '#07090f'],
      moon: true,
    }),
  },
  {
    file: 'music/field-recordings.png',
    width: 600,
    height: 600,
    shows: 'An album cover: concentric rings in teal and sand, like a record seen from above.',
    pixel(x, y, w, h) {
      const r = Math.hypot(x - w / 2, y - h / 2) / (w / 2);
      const ring = 0.5 + 0.5 * Math.cos(r * 34);
      let color = mixColor(
        hex('#1f5c63'),
        hex('#e8d6b0'),
        smooth(0.3, 0.7, ring) * (r < 0.95 ? 1 : 0),
      );
      color = over(color, hex('#d96c3f'), disc(x, y, w / 2, h / 2, w * 0.09));
      return color;
    },
  },
  {
    file: 'people/mira-anand.png',
    width: 160,
    height: 160,
    shows: 'A small abstract avatar: a teal disc on a sand ground.',
    pixel(x, y, w, h) {
      return over(hex('#e8d6b0'), hex('#2f7f86'), disc(x, y, w / 2, h / 2, w * 0.36));
    },
  },
  {
    file: 'logos/solstice.png',
    width: 160,
    height: 160,
    shows: 'A small logo mark: a half sun over a line, in amber on white.',
    pixel(x, y, w, h) {
      let color = hex('#ffffff');
      const sun = y < h * 0.58 ? disc(x, y, w / 2, h * 0.58, w * 0.3) : 0;
      color = over(color, hex('#e3963e'), sun);
      if (Math.abs(y - h * 0.66) < 3 && x > w * 0.15 && x < w * 0.85) color = hex('#e3963e');
      return color;
    },
  },
];

/** A landscape: a sky gradient, a sun or moon, and three hill silhouettes. */
function dusk({ sky, sun, light, hills, moon = false }) {
  return (x, y, w, h) => {
    let color = gradient(
      [
        [0, hex(sky[0])],
        [0.55, hex(sky[1])],
        [1, hex(sky[2])],
      ],
      y / h,
    );
    const glow = disc(x, y, w * 0.62, h * (0.6 - sun * 0.5), h * (moon ? 0.06 : 0.09));
    color = over(color, hex(light), glow);
    hills.forEach((tone, index) => {
      const base = h * (0.62 + index * 0.1);
      const ridge =
        base - h * 0.06 * Math.sin((x / w) * Math.PI * (1.4 + index * 0.7) + index * 1.7);
      color = over(color, hex(tone), smooth(ridge - 1, ridge + 1, y));
    });
    return color;
  };
}

// --- PNG encoding --------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The image's raw RGB rows, top to bottom. */
function render({ width, height, pixel }) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, width, height);
      row[x * 3] = Math.round(clamp(r, 0, 255));
      row[x * 3 + 1] = Math.round(clamp(g, 0, 255));
      row[x * 3 + 2] = Math.round(clamp(b, 0, 255));
    }
    rows.push(row);
  }
  return rows;
}

/** Each row with the PNG filter that leaves the smallest absolute sum, ties to the lowest type. */
function filtered(rows) {
  const out = [];
  let previous = Buffer.alloc(rows[0].length);
  for (const row of rows) {
    let best;
    for (let type = 0; type <= 4; type++) {
      const line = Buffer.alloc(row.length + 1);
      line[0] = type;
      for (let i = 0; i < row.length; i++) {
        const left = i >= 3 ? row[i - 3] : 0;
        const up = previous[i];
        const upLeft = i >= 3 ? previous[i - 3] : 0;
        let predictor = 0;
        if (type === 1) predictor = left;
        else if (type === 2) predictor = up;
        else if (type === 3) predictor = (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - upLeft;
          const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        line[i + 1] = (row[i] - predictor) & 0xff;
      }
      let sum = 0;
      for (let i = 1; i < line.length; i++) sum += line[i] < 128 ? line[i] : 256 - line[i];
      if (!best || sum < best.sum) best = { sum, line };
    }
    out.push(best.line);
    previous = row;
  }
  return Buffer.concat(out);
}

function png(image, rows) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// --- Main ------------------------------------------------------------------------

const check = process.argv.includes('--check');
const recorded = check
  ? JSON.parse(fs.readFileSync(path.join(HERE, 'provenance.json'), 'utf8'))
  : undefined;
const entries = [];
let total = 0;
let failures = 0;
for (const image of IMAGES) {
  const rows = render(image);
  const pixelsSha256 = sha256(Buffer.concat(rows));
  if (check) {
    const entry = recorded.images.find(({ file }) => file === image.file);
    if (!entry || entry.pixelsSha256 !== pixelsSha256) {
      process.stderr.write(`${image.file}: the drawing no longer matches provenance.json.\n`);
      failures++;
    }
    continue;
  }
  const bytes = png(image, rows);
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(`${image.file} is ${bytes.length} bytes, over the ${MAX_FILE_BYTES} limit.`);
  }
  total += bytes.length;
  const file = path.join(HERE, image.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  entries.push({
    file: image.file,
    width: image.width,
    height: image.height,
    bytes: bytes.length,
    shows: image.shows,
    pixelsSha256,
    fileSha256: sha256(bytes),
  });
}
if (check) {
  process.exitCode = failures === 0 ? 0 : 1;
} else {
  if (total > MAX_TOTAL_BYTES) throw new Error(`The images total ${total} bytes, over 3 MB.`);
  const provenance = {
    about:
      'The bundled example images, each drawn by example-media/generate.mjs from code alone: no photograph, font, or third-party file. They are the project own work, dedicated to the public domain under CC0 1.0. Nothing was fetched or downloaded.',
    generator: 'example-media/generate.mjs',
    license: 'CC0-1.0',
    images: entries,
  };
  fs.writeFileSync(path.join(HERE, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  process.stdout.write(`Wrote ${entries.length} images, ${total} bytes in all.\n`);
}
