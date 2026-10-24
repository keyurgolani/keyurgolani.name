/**
 * `pnpm fixture:reference` (#9): writes the CI reference fixture,
 * tests/fixtures/reference-export/, from its portfolio.yml and site.yml, as
 * #3's export-revision lays out a full export in its provisional bundle
 * format 1: the two documents as they are, snapshots/<kind>.json as
 * canonical JSON, media/media.json, media/blobs/<hex>, and bundle.json, with
 * every hash made by this build's own checks. It stands in for
 * export-revision, which is deferred, for this fixture alone: it opens no
 * store, and the demo never runs it. The images are tiny PNGs made here, so
 * nothing is fetched or derived with sharp, and every byte is the same on
 * every run. reference-fixture.test.ts builds it in memory and fails when
 * the committed files differ, naming this command.
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { canonicalize, type MediaRecord } from '@portfolio/schema';
import {
  checkUnit,
  sha256,
  type Sha256,
  type UnitChecks,
} from '../../../packages/core/src/catalog/unit';
import { CONTENT_EXTENSIONS } from '../src/lib/generated/registry.extensions';
import { VARIANTS } from '../src/lib/generated/registry.meta';
import { APPEARANCE_REGISTRY } from '../src/lib/appearance-registry';
import { buildUnitChecks } from '../src/server/unit-checks';
import webPackage from '../package.json' with { type: 'json' };

/** Where the fixture lives. */
export const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/reference-export',
);

/** The pair the rest is made from, which the command never writes. */
export const SOURCE_FILES = ['portfolio.yml', 'site.yml'] as const;

/** The canaries the fixture holds, which no demo response may carry. */
export const REFERENCE_CANARIES = Object.freeze({
  privateRecord: 'CANARY-REF-PRIVATE-RECORD',
  hiddenSection: 'CANARY-REF-HIDDEN-SECTION',
  privateMedia: 'CANARY-REF-PRIVATE-MEDIA',
  /** In bundle.json's events, which the reader never reads. */
  event: 'CANARY-REF-EVENT-REASON',
  privateSlug: 'canary-ref-private',
  privateAsset: 'canary-ref-private-media',
});

const CREATED_AT = '2026-10-24T08:00:00.000Z';

/** A PNG `size` pixels square of one color, with `note` in a tEXt chunk when given. */
export function png(size: number, rgb: readonly [number, number, number], note?: string): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.from(type, 'latin1');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head, data])) >>> 0);
    return Buffer.concat([length, head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill(rgb).flat())]);
  const pixels = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(note ? [chunk('tEXt', Buffer.from(`Comment\0${note}`, 'latin1'))] : []),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hexOf = (hash: Sha256) => hash.slice('sha256:'.length);

/** An image asset of the export: its media record's source, and its one rendition. */
export interface FixtureAsset {
  readonly assetId: string;
  readonly source: string;
  readonly rgb: readonly [number, number, number];
  /** Text in the image's tEXt chunk. */
  readonly note?: string;
  /** The rendition's bytes, in place of an 8-pixel PNG, for a test's own export. */
  readonly rendition?: Buffer;
}

/** Each image asset the committed fixture has. */
export const REFERENCE_ASSETS: readonly FixtureAsset[] = [
  { assetId: 'tide-tables-cover', source: 'wren/tide-tables.png', rgb: [40, 90, 160] },
  {
    assetId: 'canary-ref-private-media',
    source: 'wren/private.png',
    rgb: [160, 40, 40],
    note: REFERENCE_CANARIES.privateMedia,
  },
  { assetId: 'ref-unplaced', source: 'wren/unplaced.png', rgb: [128, 128, 128] },
];

/** This build's checks, with no origin, as the demo checks a reference. */
export function fixtureChecks(): UnitChecks {
  return buildUnitChecks({
    registry: VARIANTS,
    appearance: APPEARANCE_REGISTRY,
    extensions: CONTENT_EXTENSIONS,
    appVersion: webPackage.version,
  });
}

/** Every file the command writes, by path in the fixture, made from `source`'s pair. */
export function buildReferenceFixture(
  source: Readonly<Record<(typeof SOURCE_FILES)[number], string>>,
  checks: UnitChecks = fixtureChecks(),
  assets: readonly FixtureAsset[] = REFERENCE_ASSETS,
): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const records: MediaRecord[] = [];
  const blobs: { file: string; sha256: Sha256; size: number }[] = [];
  for (const asset of assets) {
    const original = png(16, asset.rgb, asset.note);
    const rendition = asset.rendition ?? png(8, asset.rgb, asset.note);
    const hash = sha256(rendition);
    records.push({
      assetId: asset.assetId,
      sha256: hexOf(sha256(original)),
      mime: 'image/png',
      bytes: original.byteLength,
      width: 16,
      height: 16,
      aspectRatio: 1,
      renditions: [
        {
          name: 'w8-a1',
          ext: 'png',
          mime: 'image/png',
          bytes: rendition.byteLength,
          width: 8,
          height: 8,
          sha256: hexOf(hash),
        },
      ],
      derivedAt: CREATED_AT,
      algorithmVersion: 1,
      source: { kind: 'local', path: asset.source },
      availability: { state: 'available' },
    });
    const file = `media/blobs/${hexOf(hash)}`;
    files.set(file, rendition);
    blobs.push({ file, sha256: hash, size: rendition.byteLength });
  }
  blobs.sort((a, b) => a.file.localeCompare(b.file));

  const mediaText = canonicalize({ assets: records });
  const checked = checkUnit(
    {
      portfolio: { format: 'yaml', sourceText: source['portfolio.yml'] },
      site: { format: 'yaml', sourceText: source['site.yml'] },
      media: { format: 'json', sourceText: mediaText },
    },
    checks,
  );
  if (!checked.ok) {
    const codes = checked.diagnostics.map(({ code, pointer }) => `${code} ${pointer}`).join(', ');
    throw new Error(`The reference fixture's pair doesn't check: ${codes}`);
  }
  const { unit } = checked;
  files.set('media/media.json', Buffer.from(mediaText, 'utf8'));
  const snapshots: Record<string, { file: string; contentHash: Sha256 }> = {};
  for (const [kind, value] of Object.entries(unit.snapshots).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bytes = Buffer.from(canonicalize(value), 'utf8');
    const file = `snapshots/${kind}.json`;
    files.set(file, bytes);
    snapshots[kind] = { file, contentHash: sha256(bytes) };
  }
  const document = (name: 'portfolio' | 'site') => ({
    file: `${name}.yml`,
    format: 'yaml',
    schemaVersion: unit[name].schemaVersion,
    sourceHash: unit[name].sourceHash,
    contentHash: unit[name].contentHash,
  });
  const revisionId = `rev_${hexOf(unit.unitHash).slice(0, 32)}`;
  const bundle = {
    bundleFormat: 1,
    revisionId,
    parentRevisionId: null,
    createdAt: CREATED_AT,
    createdBy: 'owner',
    source: { kind: 'publish' },
    appVersion: webPackage.version,
    unitHash: unit.unitHash,
    documents: {
      portfolio: document('portfolio'),
      site: document('site'),
      media: {
        file: 'media/media.json',
        format: 'json',
        schemaVersion: unit.media!.schemaVersion,
        sourceHash: sha256(mediaText),
        contentHash: unit.media!.contentHash,
      },
    },
    snapshots,
    blobs,
    rendering: { variant: null, packs: [], contracts: {} },
    events: [
      {
        seq: 1,
        type: 'publish',
        revisionId,
        previousRevisionId: null,
        actor: 'owner',
        at: CREATED_AT,
        reason: REFERENCE_CANARIES.event,
      },
    ],
  };
  files.set('bundle.json', Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'));
  return files;
}

/** The fixture's pair, as committed. */
export function readSource(dir = FIXTURE_DIR): Record<(typeof SOURCE_FILES)[number], string> {
  return Object.fromEntries(
    SOURCE_FILES.map((name) => [name, readFileSync(path.join(dir, name), 'utf8')]),
  ) as Record<(typeof SOURCE_FILES)[number], string>;
}

/** Every file under `dir` but the pair, relative, with / between names. */
export function generatedFiles(dir = FIXTURE_DIR, prefix = ''): string[] {
  return readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return generatedFiles(dir, relative);
    return (SOURCE_FILES as readonly string[]).includes(relative) ? [] : [relative];
  });
}

function isMain(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const files = buildReferenceFixture(readSource());
  for (const file of generatedFiles()) rmSync(path.join(FIXTURE_DIR, file));
  for (const dir of ['snapshots', 'media']) {
    rmSync(path.join(FIXTURE_DIR, dir), { recursive: true, force: true });
  }
  for (const [file, bytes] of files) {
    mkdirSync(path.dirname(path.join(FIXTURE_DIR, file)), { recursive: true });
    writeFileSync(path.join(FIXTURE_DIR, file), bytes);
  }
  process.stdout.write(`Wrote ${files.size} files to tests/fixtures/reference-export.\n`);
}
