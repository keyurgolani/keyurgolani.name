import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  buildReferenceFixture,
  FIXTURE_DIR,
  fixtureChecks,
  readSource,
  REFERENCE_ASSETS,
  REFERENCE_CANARIES,
} from '../../../scripts/reference-fixture';
import { compose } from '../composition';
import { readDeploymentConfig } from '../config';
import { setDeploymentState, type DeploymentState, type ServedReference } from '../config-store';
import { loadedOwnerModules } from '../load-trace';
import { referenceRendition } from '../reference-media';
import { openReference, REFERENCE_HELD_BYTES, servedRenditions } from './reference';

// The demo's read-only reference (#9): the CI fixture opens, with nothing
// its public view drops anywhere in what it serves; every way a mount can be
// wrong refuses the whole reference, with a warning that names no path; the
// mount is read once, at startup, so a change on disk after it serves
// nothing new; and /reference/media serves only the renditions the view
// keeps, from memory.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
const CHECKS = fixtureChecks();
const sha256 = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const CANARIES = Object.values(REFERENCE_CANARIES);

/** A copy of the committed fixture in a temp directory of its own. */
function copy(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'reference-'));
  t.after(() => {
    chmodTree(dir, 0o755, 0o644);
    rmSync(dir, { recursive: true, force: true });
  });
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

/** The export of `source`'s pair, written with the pair into a temp directory of its own. */
function written(
  t: TestContext,
  source: Readonly<Record<string, string>>,
  files: Map<string, Buffer>,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'reference-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(source)) writeFileSync(path.join(dir, file), text);
  for (const [file, bytes] of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), bytes);
  }
  return dir;
}

function chmodTree(dir: string, dirs: number, files: number) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) chmodTree(at, dirs, files);
    else if (entry.isFile()) chmodSync(at, files);
  }
  chmodSync(dir, dirs);
}

async function opened(dir: string): Promise<ServedReference> {
  const result = await openReference({ dir, checks: CHECKS });
  assert.ok(result.ok, JSON.stringify(result.issues));
  return result.reference;
}

async function refusal(dir: string, heldBytes?: number) {
  const result = await openReference({
    dir,
    checks: CHECKS,
    ...(heldBytes === undefined ? {} : { heldBytes }),
  });
  assert.equal(result.ok, false, 'the reference is refused');
  for (const issue of result.issues) {
    assert.equal(issue.severity, 'warning');
    assert.equal(issue.key, 'PORTFOLIO_REFERENCE_DIR');
    assert.ok(!JSON.stringify(issue).includes(dir), 'no finding names the mount');
  }
  assert.equal(result.issues.at(-1)?.code, 'reference_unavailable');
  return result.issues;
}

const blobPath = (dir: string, hex: string) => path.join(dir, 'media', 'blobs', hex);
const hexes = (dir: string) => readdirSync(path.join(dir, 'media', 'blobs'));

/** The rendition URL segments the view gives each image it keeps. */
function renditionSegments(reference: ServedReference): string[][] {
  const urls = JSON.stringify(reference.view).match(/\/reference\/media\/[^"\s,)]+/g) ?? [];
  return [...new Set(urls)].map((url) => url.slice('/reference/media/'.length).split('/'));
}

/** The media document's record for `assetId`, as committed. */
function record(dir: string, assetId: string) {
  const media = JSON.parse(readFileSync(path.join(dir, 'media', 'media.json'), 'utf8')) as {
    assets: {
      assetId: string;
      sha256: string;
      renditions: { name: string; ext: string; sha256: string }[];
    }[];
  };
  return media.assets.find((entry) => entry.assetId === assetId)!;
}

function serving(t: TestContext, reference: ServedReference | undefined) {
  setDeploymentState({ reference } as unknown as DeploymentState);
  t.after(() => setDeploymentState(undefined));
}

const get = (segments: readonly string[], method = 'GET') =>
  referenceRendition(
    new Request(`https://demo.test/reference/media/${segments.join('/')}`, { method }),
    {
      params: Promise.resolve({ path: segments }),
    },
  );

test('the fixture opens, and nothing its public view drops is anywhere in what the demo holds to serve', async () => {
  const reference = await opened(FIXTURE_DIR);
  const served = JSON.stringify({
    view: reference.view,
    slugs: [...reference.caseStudies],
    composition: reference.composition,
  });
  for (const canary of CANARIES) assert.ok(!served.includes(canary), canary);
  assert.ok(served.includes('Wren Halloway'));
  assert.deepEqual([...reference.caseStudies], ['tide-tables']);
  assert.equal(reference.composition, 'spatial-bento');
  assert.match(reference.revisionId, /^rev_[0-9a-f]{32}$/);
  // One rendition is kept, the visible cover's; the private and the unplaced
  // images' blobs are verified and never held.
  const kept = [...servedRenditions(reference.view, reference.media).keys()];
  const cover = record(FIXTURE_DIR, 'tide-tables-cover').renditions[0]!.sha256;
  assert.deepEqual(kept, [`sha256:${cover}`]);
  for (const assetId of [REFERENCE_CANARIES.privateAsset, 'ref-unplaced']) {
    const hex = record(FIXTURE_DIR, assetId).renditions[0]!.sha256;
    assert.equal(reference.blob(`sha256:${hex}`), undefined, assetId);
  }
  assert.deepEqual(loadedOwnerModules(), [], 'no store and no owner module');
});

test('a read-only mount opens: nothing is written', async (t) => {
  const dir = copy(t);
  chmodTree(dir, 0o555, 0o444);
  await opened(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o555);
});

const TAMPERED: readonly [string, (dir: string) => void, string][] = [
  [
    'a flipped byte in a blob nothing serves',
    (dir) => {
      const hex = record(dir, 'ref-unplaced').renditions[0]!.sha256;
      const bytes = readFileSync(blobPath(dir, hex));
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(blobPath(dir, hex), bytes);
    },
    'reference_hash_mismatch',
  ],
  [
    'a flipped byte in the served rendition',
    (dir) => {
      const hex = record(dir, 'tide-tables-cover').renditions[0]!.sha256;
      const bytes = readFileSync(blobPath(dir, hex));
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(blobPath(dir, hex), bytes);
    },
    'reference_hash_mismatch',
  ],
  [
    'an edited document',
    (dir) =>
      writeFileSync(path.join(dir, 'site.yml'), `${readFileSync(path.join(dir, 'site.yml'))}\n`),
    'reference_hash_mismatch',
  ],
  [
    'an edited snapshot',
    (dir) => writeFileSync(path.join(dir, 'snapshots', 'controls.json'), '{}'),
    'reference_hash_mismatch',
  ],
  [
    'an extra file',
    (dir) => writeFileSync(path.join(dir, 'notes.txt'), 'x'),
    'reference_unexpected_file',
  ],
  [
    'a stray .DS_Store',
    (dir) => writeFileSync(path.join(dir, '.DS_Store'), 'x'),
    'reference_unexpected_file',
  ],
  [
    'a link in place of a listed file',
    (dir) => {
      const target = path.join(dir, '..', `${path.basename(dir)}-site.yml`);
      cpSync(path.join(dir, 'site.yml'), target);
      rmSync(path.join(dir, 'site.yml'));
      symlinkSync(target, path.join(dir, 'site.yml'));
    },
    'reference_unexpected_file',
  ],
  ['a missing blob', (dir) => rmSync(blobPath(dir, hexes(dir)[0]!)), 'reference_file_missing'],
  [
    'an oversize document',
    (dir) => writeFileSync(path.join(dir, 'portfolio.yml'), Buffer.alloc(1024 * 1024 + 1, 0x20)),
    'reference_too_large',
  ],
  [
    'a unitHash that is not the files’',
    (dir) => {
      const bundle = JSON.parse(readFileSync(path.join(dir, 'bundle.json'), 'utf8'));
      bundle.unitHash = sha256('other');
      writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundle));
    },
    'reference_unit_hash_mismatch',
  ],
  [
    'another bundle format',
    (dir) => {
      const bundle = JSON.parse(readFileSync(path.join(dir, 'bundle.json'), 'utf8'));
      bundle.bundleFormat = 2;
      writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundle));
    },
    'reference_bundle_unreadable',
  ],
  [
    'an unlisted rendition blob',
    (dir) => {
      const bundle = JSON.parse(readFileSync(path.join(dir, 'bundle.json'), 'utf8'));
      const hex = record(dir, 'tide-tables-cover').renditions[0]!.sha256;
      bundle.blobs = bundle.blobs.filter(
        (blob: { sha256: string }) => blob.sha256 !== `sha256:${hex}`,
      );
      writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundle));
      rmSync(blobPath(dir, hex));
    },
    'reference_blob_unlisted',
  ],
  ['no bundle.json', (dir) => rmSync(path.join(dir, 'bundle.json')), 'reference_bundle_unreadable'],
];

for (const [name, change, code] of TAMPERED) {
  test(`${name} refuses the whole reference (${code})`, async (t) => {
    const dir = copy(t);
    change(dir);
    const issues = await refusal(dir);
    assert.ok(
      issues.some((issue) => issue.code === code),
      `${issues.map((issue) => issue.code).join(', ')} includes ${code}`,
    );
  });
}

test('a mount that is missing, or a file, is reference_unreadable', async (t) => {
  const dir = copy(t);
  for (const at of [path.join(dir, 'nothing-here'), path.join(dir, 'site.yml')]) {
    assert.deepEqual(
      (await refusal(at)).map((issue) => issue.code),
      ['reference_unreadable', 'reference_unavailable'],
    );
  }
});

test('a case study whose slug is media, which names the renditions route, refuses the reference', async (t) => {
  const source = readSource();
  const changed = {
    ...source,
    'portfolio.yml': source['portfolio.yml'].replace('slug: tide-tables', 'slug: media'),
  };
  const dir = written(t, changed, buildReferenceFixture(changed, CHECKS));
  const issues = await refusal(dir);
  assert.equal(issues[0]?.code, 'reference_route_reserved');
});

test('renditions over the held limit refuse the reference whole, naming the limit', async (t) => {
  const reference = await opened(FIXTURE_DIR);
  const kept = [...servedRenditions(reference.view, reference.media).values()].reduce(
    (a, b) => a + b,
    0,
  );
  const issues = await refusal(copy(t), kept - 1);
  assert.equal(issues[0]?.code, 'reference_too_large');
  assert.match(issues[0]!.message, new RegExp(`${kept - 1} bytes`));
  assert.ok((await openReference({ dir: FIXTURE_DIR, checks: CHECKS, heldBytes: kept })).ok);
});

test(`a reference just over REFERENCE_HELD_BYTES (${REFERENCE_HELD_BYTES / 1024 / 1024} MiB) is refused, and the demo still serves its sample`, async (t) => {
  // Four public images on the visible work, whose renditions together with
  // the cover's come to one byte over the limit.
  const source = readSource();
  const cover = REFERENCE_ASSETS[0]!;
  const coverBytes = buildReferenceFixture(source, CHECKS).get(
    `media/blobs/${record(FIXTURE_DIR, cover.assetId).renditions[0]!.sha256}`,
  )!.byteLength;
  const rest = REFERENCE_HELD_BYTES + 1 - coverBytes;
  const each = Math.ceil(rest / 4);
  const big = [0, 1, 2, 3].map((n) => ({
    assetId: `big-${n}`,
    source: `wren/big-${n}.png`,
    rgb: [n, n, n] as const,
    rendition: Buffer.alloc(n === 3 ? rest - 3 * each : each, n + 1),
  }));
  const portfolio = source['portfolio.yml']
    .replace(
      '      - asset: canary-ref-private-media\n        caption: CANARY-REF-PRIVATE-MEDIA\n',
      big.map(({ assetId }) => `      - asset: ${assetId}\n`).join(''),
    )
    .replace(
      '\nmedia:\n',
      `\nmedia:\n${big.map(({ assetId, source: file }) => `  - id: ${assetId}\n    kind: image\n    source: ${file}\n    alt: A plain square.\n`).join('')}`,
    );
  const changed = { ...source, 'portfolio.yml': portfolio };
  const dir = written(
    t,
    changed,
    buildReferenceFixture(changed, CHECKS, [...REFERENCE_ASSETS, ...big]),
  );
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.wren.test',
      PORTFOLIO_REFERENCE_DIR: dir,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const composed = await compose({ config: read.config, examples: EXAMPLES, report: () => {} });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.equal(composed.state.reference, undefined, 'no part of it serves');
  const issue = composed.issues.find((found) => found.code === 'reference_too_large');
  assert.ok(issue, JSON.stringify(composed.issues));
  assert.match(issue.message, /64 MiB/);
  const live = await composed.state.catalog.getLive();
  assert.notEqual(live.unit?.portfolio.identity.name, 'Wren Halloway');
  assert.match(live.revisionId ?? '', /^sample-/);
});

test('demo with the fixture mounted serves it, with no warning, and loads no owner module', async () => {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'demo',
      PORTFOLIO_ORIGIN: 'https://demo.wren.test',
      PORTFOLIO_REFERENCE_DIR: FIXTURE_DIR,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  assert.equal(read.config.referenceDir, FIXTURE_DIR);
  const composed = await compose({ config: read.config, examples: EXAMPLES, report: () => {} });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  assert.ok(composed.state.reference);
  assert.deepEqual(
    composed.issues.filter((issue) => issue.key === 'PORTFOLIO_REFERENCE_DIR'),
    [],
  );
  assert.deepEqual(loadedOwnerModules(), []);
});

test('PORTFOLIO_REFERENCE_DIR is demo’s alone: owner and read-only refuse it in production', () => {
  for (const profile of ['owner', 'read-only']) {
    const read = readDeploymentConfig(
      {
        NODE_ENV: 'production',
        PORTFOLIO_PROFILE: profile,
        PORTFOLIO_ORIGIN: 'https://wren.test',
        PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
        PORTFOLIO_REFERENCE_DIR: FIXTURE_DIR,
      },
      { cwd: '/' },
    );
    assert.ok(
      read.issues.some(
        (issue) => issue.key === 'PORTFOLIO_REFERENCE_DIR' && issue.code === 'not_in_profile',
      ),
      profile,
    );
  }
});

test('/reference/media serves the kept rendition from memory, with its type, nosniff, and a year', async (t) => {
  const reference = await opened(FIXTURE_DIR);
  serving(t, reference);
  const [segments] = renditionSegments(reference);
  assert.ok(segments, 'the view names the cover rendition');
  const response = await get(segments);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const hex = record(FIXTURE_DIR, 'tide-tables-cover').renditions[0]!.sha256;
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.equals(readFileSync(blobPath(FIXTURE_DIR, hex))));
  assert.equal(response.headers.get('content-length'), String(body.byteLength));
  const head = await get(segments, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('a blob swapped on disk after startup changes nothing served: the mount is read once', async (t) => {
  const dir = copy(t);
  const reference = await opened(dir);
  serving(t, reference);
  const [segments] = renditionSegments(reference);
  const hex = record(dir, 'tide-tables-cover').renditions[0]!.sha256;
  const before = readFileSync(blobPath(dir, hex));
  writeFileSync(blobPath(dir, hex), Buffer.alloc(before.byteLength, 0x41));
  rmSync(path.join(dir, 'bundle.json'));
  const response = await get(segments!);
  assert.equal(response.status, 200);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(before));
});

test('/reference/media is a no-store 404 for anything the view does not keep', async (t) => {
  const reference = await opened(FIXTURE_DIR);
  serving(t, reference);
  const rendition = (assetId: string) => {
    const found = record(FIXTURE_DIR, assetId);
    const [first] = found.renditions;
    return [assetId, found.sha256, `${first!.name}.${first!.ext}`];
  };
  const [cover] = renditionSegments(reference);
  for (const segments of [
    rendition(REFERENCE_CANARIES.privateAsset),
    rendition('ref-unplaced'),
    [cover![0]!, '0'.repeat(64), cover![2]!],
    [cover![0]!, cover![1]!, 'w8-a1.webp'],
    [cover![0]!, cover![1]!],
    [...cover!, 'extra'],
    ['..', cover![1]!, cover![2]!],
    [cover![0]!, cover![1]!, '../bundle.json'],
    ['bundle.json'],
    [],
  ]) {
    const response = await get(segments);
    assert.equal(response.status, 404, segments.join('/'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    for (const canary of CANARIES) assert.ok(!body.includes(canary));
  }
});

test('/reference/media is a no-store 404 for everything with no reference', async (t) => {
  const reference = await opened(FIXTURE_DIR);
  const [segments] = renditionSegments(reference);
  serving(t, undefined);
  const response = await get(segments!);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
