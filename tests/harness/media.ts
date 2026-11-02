// What the media specs share (#10): images made here, from nothing, a hash
// as a media document names one, the rendition paths a page names, and the
// one 404 /media answers for anything it doesn't serve.
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { expect, type APIResponse } from '@playwright/test';

/** A solid `width` by `height` PNG of `rgb`, encoded by hand. */
export function solidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bytes' SHA-256, in hex, as a media document names a blob. */
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The renditions a page's HTML names for `assetId`, as /media paths. */
export const renditionsOf = (html: string, assetId: string) => [
  ...new Set(html.match(new RegExp(`/media/${assetId}/[0-9a-f]{64}/[a-z0-9-]+\\.[a-z0-9]+`, 'g'))),
];

/**
 * A draft of the harness fixture whose work cover is a local file, with the
 * one rendition its media document names, as ingestion would have put it in
 * the store: the documents, the blob, and the rendition's path below a
 * media base.
 */
export function draftWithCover(portfolioText: string, siteText: string) {
  const rendition = solidPng(480, 300, [60, 120, 60]);
  const original = sha256(solidPng(960, 600, [60, 120, 60]));
  const documents = {
    portfolio: {
      format: 'yaml' as const,
      sourceText: portfolioText.replace(
        'https://media.rowan.test/fixture-garden.png',
        'fixture-garden.png',
      ),
    },
    site: { format: 'yaml' as const, sourceText: siteText },
    media: {
      format: 'json' as const,
      sourceText: JSON.stringify({
        assets: [
          {
            assetId: 'fixture-garden-cover',
            sha256: original,
            mime: 'image/png',
            bytes: 4096,
            width: 960,
            height: 600,
            renditions: [
              {
                name: 'w480-a1',
                ext: 'png',
                mime: 'image/png',
                bytes: rendition.length,
                width: 480,
                sha256: sha256(rendition),
              },
            ],
            derivedAt: '2026-10-23T08:00:00Z',
            algorithmVersion: 1,
            source: { kind: 'local', path: 'fixture-garden.png' },
            availability: { state: 'available' },
          },
        ],
      }),
    },
  };
  return {
    documents,
    rendition,
    original,
    blobs: [{ bytes: rendition, mediaType: 'image/png' }],
    file: `fixture-garden-cover/${original}/w480-a1.png`,
  };
}

/** /media's answer for anything it doesn't serve: one 404, never cached. */
export async function expectNotFound(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), label).toBe(404);
  expect(response.headers()['cache-control'], label).toBe('no-store');
  expect(await response.text(), label).toBe('Not found.');
}
