import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { indexProblems, loadIndex, mergeIndex } from './merge-index.mjs';

const IMAGE = 'ghcr.io/owner/repo.name';
const AMD64 = `sha256:${'a'.repeat(64)}`;
const ARM64 = `sha256:${'b'.repeat(64)}`;
const digestOf = (n) => `sha256:${String(n).repeat(64)}`;

/** One platform's image manifest and the attestation manifest that names it. */
const leg = (architecture, image, attestation) => [
  { mediaType: 'oci.manifest', digest: image, platform: { os: 'linux', architecture } },
  {
    mediaType: 'oci.manifest',
    digest: attestation,
    platform: { os: 'unknown', architecture: 'unknown' },
    annotations: {
      'vnd.docker.reference.type': 'attestation-manifest',
      'vnd.docker.reference.digest': image,
    },
  },
];

/** What `imagetools create --dry-run` prints for the two legs: indented JSON. */
const MERGED = JSON.stringify(
  {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      ...leg('amd64', digestOf(1), digestOf(2)),
      ...leg('arm64', digestOf(3), digestOf(4)),
    ],
  },
  null,
  2,
);
const MERGED_DIGEST = `sha256:${createHash('sha256').update(MERGED).digest('hex')}`;

/** A docker CLI stand-in: records calls, prints `index` for a dry run. */
function fakeDocker({ index = MERGED, resolves } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args.includes('--dry-run')) return `${index}\n`;
    if (args[2] === 'inspect') {
      const ref = args[3];
      return JSON.stringify({ digest: resolves ?? ref.slice(ref.indexOf('@') + 1) });
    }
    return '';
  };
  return { calls, run };
}

test('the legs merge into one index, pushed by its own digest with no tag', () => {
  const docker = fakeDocker();
  assert.equal(mergeIndex(IMAGE, [AMD64, ARM64], docker.run), MERGED_DIGEST);
  const sources = [`${IMAGE}@${AMD64}`, `${IMAGE}@${ARM64}`];
  assert.deepEqual(docker.calls, [
    ['buildx', 'imagetools', 'create', '--dry-run', ...sources],
    ['buildx', 'imagetools', 'create', '--tag', `${IMAGE}@${MERGED_DIGEST}`, ...sources],
    [
      'buildx',
      'imagetools',
      'inspect',
      `${IMAGE}@${MERGED_DIGEST}`,
      '--format',
      '{{json .Manifest}}',
    ],
  ]);
  // Every reference is by digest: none names a tag.
  for (const arg of docker.calls.flat().filter((a) => a.startsWith(IMAGE))) {
    assert.match(arg, /^ghcr\.io\/owner\/repo\.name@sha256:[0-9a-f]{64}$/);
  }
});

test('a merged index that resolves to another digest fails', () => {
  const docker = fakeDocker({ resolves: digestOf(9) });
  assert.throws(() => mergeIndex(IMAGE, [AMD64, ARM64], docker.run), /resolves to sha256:9/);
});

test('a merge without exactly one attested image per platform fails before anything is pushed', () => {
  const [amd64Image, amd64Attestation, arm64Image, arm64Attestation] = JSON.parse(MERGED).manifests;
  const arm64 = [arm64Image, arm64Attestation];
  const cases = [
    [[amd64Image, amd64Attestation], /0 linux\/arm64 images, not 1/],
    [[amd64Image, amd64Attestation, arm64Image], /no attestation manifest for linux\/arm64/],
    [[amd64Image, arm64Image], /no attestation manifest for linux\/amd64/],
    // A second amd64 image, attested too.
    [
      [amd64Image, amd64Attestation, ...leg('amd64', digestOf(5), digestOf(6)), ...arm64],
      /2 linux\/amd64 images, not 1/,
    ],
    // Two attestation manifests for one image.
    [
      [amd64Image, amd64Attestation, { ...amd64Attestation, digest: digestOf(7) }, ...arm64],
      /2 attestation manifests for linux\/amd64, not 1/,
    ],
    // A platform no leg builds.
    [
      [amd64Image, amd64Attestation, ...arm64, ...leg('386', digestOf(8), digestOf(9))],
      /a linux\/386 image, which no leg builds/,
    ],
  ];
  for (const [manifests, reason] of cases) {
    const docker = fakeDocker({ index: JSON.stringify({ manifests }) });
    assert.throws(() => mergeIndex(IMAGE, [AMD64, ARM64], docker.run), reason);
    assert.equal(docker.calls.length, 1, 'only the dry run ran');
  }
  assert.deepEqual(indexProblems(JSON.parse(MERGED)), []);
});

test('an empty or malformed leg digest, or one leg, refuses to merge', () => {
  for (const digests of [[AMD64, ''], [AMD64], [AMD64, 'sha256:short'], [AMD64, ARM64, AMD64]]) {
    const docker = fakeDocker();
    assert.throws(() => mergeIndex(IMAGE, digests, docker.run), String(digests));
    assert.equal(docker.calls.length, 0);
  }
});

test("the dry run loads a leg's OCI layout into the registry by digest", () => {
  const docker = fakeDocker();
  const source = `oci-layout:///tmp/oci/oci-dry-run-amd64@${AMD64}`;
  assert.equal(loadIndex('localhost:5000/portfolio', AMD64, source, docker.run), AMD64);
  assert.deepEqual(docker.calls[0], [
    'buildx',
    'imagetools',
    'create',
    '--tag',
    `localhost:5000/portfolio@${AMD64}`,
    source,
  ]);
  for (const bad of ['/tmp/oci', `oci-layout:///tmp/oci`, `localhost:5000/portfolio@${AMD64}`]) {
    assert.throws(
      () => loadIndex('localhost:5000/portfolio', AMD64, bad, docker.run),
      /oci-layout/,
    );
  }
  assert.throws(
    () => loadIndex('localhost:5000/portfolio', AMD64, source, fakeDocker({ resolves: ARM64 }).run),
    /resolves to/,
  );
});
