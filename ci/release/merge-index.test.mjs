import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  indexProblems,
  loadIndex,
  mergeIndex,
  parseMergeArgs,
  plainIndexProblems,
} from './merge-index.mjs';

const IMAGE = 'ghcr.io/owner/repo.name';
const AMD64 = `sha256:${'a'.repeat(64)}`;
const ARM64 = `sha256:${'b'.repeat(64)}`;
const digestOf = (n) => `sha256:${String(n).repeat(64)}`;
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';

/** One platform's image manifest and the attestation manifest that names it. */
const leg = (architecture, image, attestation) => [
  { mediaType: OCI_MANIFEST, digest: image, platform: { os: 'linux', architecture } },
  {
    mediaType: OCI_MANIFEST,
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
    // An attestation for no image of the index, beside every one that's right.
    [
      [
        amd64Image,
        amd64Attestation,
        ...arm64,
        {
          ...amd64Attestation,
          digest: digestOf(5),
          annotations: {
            ...amd64Attestation.annotations,
            'vnd.docker.reference.digest': digestOf(6),
          },
        },
      ],
      /1 attestation manifests for no image of its own/,
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

/** The two legs ci.yml's publish pushes: plain images, no attestations. */
const PLAIN = (() => {
  const [amd64Image, , arm64Image] = JSON.parse(MERGED).manifests;
  return JSON.stringify({ manifests: [amd64Image, arm64Image] }, null, 2);
})();
const PLAIN_DIGEST = `sha256:${createHash('sha256').update(PLAIN).digest('hex')}`;

test("an unattested merge (ci.yml's sha-publish) takes plain images, and says it ran unattested", () => {
  const docker = fakeDocker({ index: PLAIN });
  const logged = [];
  const digest = mergeIndex(IMAGE, [AMD64, ARM64], docker.run, {
    unattested: 'sha-publish',
    log: (line) => logged.push(line),
  });
  assert.equal(digest, PLAIN_DIGEST);
  assert.equal(docker.calls.length, 3);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^::warning title=merge::merged .* unattested \(--purpose sha-publish\)/);
  assert.deepEqual(plainIndexProblems(JSON.parse(PLAIN)), []);
  // Docker's v2 image manifest is an image too.
  const docker2 = JSON.parse(PLAIN);
  for (const m of docker2.manifests)
    m.mediaType = 'application/vnd.docker.distribution.manifest.v2+json';
  assert.deepEqual(plainIndexProblems(docker2), []);
});

test('without --unattested the merge is the release merge: plain images fail, and nothing is logged', () => {
  const logged = [];
  const log = (line) => logged.push(line);
  assert.throws(
    () => mergeIndex(IMAGE, [AMD64, ARM64], fakeDocker({ index: PLAIN }).run, { log }),
    /no attestation manifest for linux\/amd64/,
  );
  assert.equal(mergeIndex(IMAGE, [AMD64, ARM64], fakeDocker().run, { log }), MERGED_DIGEST);
  assert.deepEqual(logged, [], 'an attested merge logs no unattested warning');
});

test('an unattested merge refuses another purpose, a missing platform, or attestations it was not meant to have', () => {
  const [amd64Image] = JSON.parse(PLAIN).manifests;
  for (const purpose of ['', 'release', 'rc', 'SHA-PUBLISH']) {
    const docker = fakeDocker({ index: PLAIN });
    assert.throws(
      () => mergeIndex(IMAGE, [AMD64, ARM64], docker.run, { unattested: purpose }),
      /not a reason to merge without attestations/,
    );
    assert.equal(docker.calls.length, 0);
  }
  const [, arm64Image] = JSON.parse(PLAIN).manifests;
  const cases = [
    [JSON.stringify({ manifests: [amd64Image] }), /0 linux\/arm64 images, not 1/],
    [MERGED, /2 attestation manifests/],
    // An attestation dressed as an image of a platform the legs build.
    [
      JSON.stringify({
        manifests: [
          amd64Image,
          {
            ...arm64Image,
            annotations: {
              'vnd.docker.reference.type': 'attestation-manifest',
              'vnd.docker.reference.digest': amd64Image.digest,
            },
          },
        ],
      }),
      /1 attestation manifests/,
    ],
    // A nested index, or an entry of no type, where an image belongs.
    [
      JSON.stringify({
        manifests: [
          amd64Image,
          { ...arm64Image, mediaType: 'application/vnd.oci.image.index.v1+json' },
        ],
      }),
      /a application\/vnd\.oci\.image\.index\.v1\+json entry, not an image/,
    ],
    [
      JSON.stringify({ manifests: [amd64Image, { ...arm64Image, mediaType: undefined }] }),
      /a typeless entry, not an image/,
    ],
  ];
  for (const [index, reason] of cases) {
    const docker = fakeDocker({ index });
    assert.throws(
      () => mergeIndex(IMAGE, [AMD64, ARM64], docker.run, { unattested: 'sha-publish' }),
      reason,
    );
    assert.equal(docker.calls.length, 1, 'only the dry run ran');
  }
});

test('--unattested needs --purpose sha-publish first, and runs only in ci.yml for a push to main', () => {
  const ACTIONS = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_NAME: 'push',
  };
  const CI_REF = {
    ...ACTIONS,
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/ci.yml@refs/heads/main',
  };
  const RELEASE_REF = {
    ...ACTIONS,
    GITHUB_WORKFLOW_REF: 'owner/repo/.github/workflows/release.yml@refs/tags/v1.0.0-rc.1',
  };
  const ref = (value) => ({ ...ACTIONS, GITHUB_WORKFLOW_REF: value });
  const FLAGS = ['--unattested', '--purpose', 'sha-publish'];
  assert.deepEqual(parseMergeArgs([IMAGE, AMD64, ARM64], RELEASE_REF), {
    image: IMAGE,
    digests: [AMD64, ARM64],
  });
  assert.deepEqual(parseMergeArgs([...FLAGS, IMAGE, AMD64, ARM64], CI_REF), {
    image: IMAGE,
    digests: [AMD64, ARM64],
    unattested: 'sha-publish',
  });
  const refused = [
    [['--unattested', IMAGE, AMD64, ARM64], {}, /needs --purpose sha-publish/],
    [['--unattested', '--purpose', 'release', IMAGE, AMD64, ARM64], {}, /needs --purpose/],
    [['--purpose', 'sha-publish', IMAGE, AMD64, ARM64], {}, /must come first/],
    [[IMAGE, AMD64, ARM64, '--unattested'], {}, /must come first/],
    [[...FLAGS, '--unattested', IMAGE, AMD64, ARM64], {}, /given once/],
    [[...FLAGS, IMAGE, AMD64, ARM64], RELEASE_REF, /runs only in ci\.yml on main/],
    // ci.yml itself, anywhere but a push to main in this repository.
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('owner/repo/.github/workflows/ci.yml@refs/pull/7/merge'),
      /on main/,
    ],
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('owner/repo/.github/workflows/ci.yml@refs/heads/next'),
      /on main/,
    ],
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('owner/repo/.github/workflows/ci.yml@refs/tags/v1.0.0'),
      /on main/,
    ],
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('fork/repo/.github/workflows/ci.yml@refs/heads/main'),
      /on main/,
    ],
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('owner/repo/.github/workflows/ci.yml@refs/heads/main-x'),
      /on main/,
    ],
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      ref('owner/repo/x/.github/workflows/ci.yml@refs/heads/main'),
      /on main/,
    ],
    [[...FLAGS, IMAGE, AMD64, ARM64], { ...CI_REF, GITHUB_REPOSITORY: undefined }, /on main/],
    // The right ref, for an event that isn't a push.
    [
      [...FLAGS, IMAGE, AMD64, ARM64],
      { ...CI_REF, GITHUB_EVENT_NAME: 'pull_request' },
      /for a push/,
    ],
    [[...FLAGS, IMAGE, AMD64, ARM64], { ...CI_REF, GITHUB_EVENT_NAME: undefined }, /for a push/],
    // In Actions with no ref at all, it fails closed.
    [[...FLAGS, IMAGE, AMD64, ARM64], { ...ACTIONS }, /GITHUB_WORKFLOW_REF, and it is unset/],
  ];
  for (const [argv, env, reason] of refused) {
    assert.throws(
      () => parseMergeArgs(argv, env),
      reason,
      `${argv.join(' ')} ${JSON.stringify(env)}`,
    );
  }
  // Outside Actions, as a person or a test runs it, there's no ref to check.
  assert.equal(parseMergeArgs([...FLAGS, IMAGE, AMD64, ARM64], {}).unattested, 'sha-publish');
});
