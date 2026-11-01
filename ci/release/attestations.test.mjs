// The provenance and SBOM check, on fixture imagetools output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attestationProblems, main, sbomFileName } from './attestations.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('mode=max provenance and an SBOM on both platforms pass, in SLSA v0.2 or v1', () => {
  assert.deepEqual(attestationProblems(fixture('provenance-max'), fixture('sbom')), []);
  assert.deepEqual(attestationProblems(fixture('provenance-v1-max'), fixture('sbom')), []);
});

test('mode=min provenance fails: it records no build configuration', () => {
  assert.deepEqual(attestationProblems(fixture('provenance-min'), fixture('sbom')), [
    "linux/amd64's provenance has no buildConfig, so it wasn't built with mode=max",
    "linux/arm64's provenance has no buildConfig, so it wasn't built with mode=max",
  ]);
});

const MARKER = 'commit message text that must not be printed';
const payloadMessage = (platform) =>
  `${platform}'s provenance carries github_event_payload. Set provenance-add-gha=false in the builder's driver-opts. On a release candidate the digest is already on GHCR, untagged: delete that package version (docs/releasing.md)`;

test('a provenance that carries the GitHub event payload anywhere fails, named by its key only', () => {
  // [placement, fixture, platform, put the key in the SLSA object]
  const placements = [
    [
      'SLSA v0.2 invocation.environment',
      'provenance-max',
      'linux/arm64',
      (slsa) => (slsa.invocation.environment = { github_event_payload: MARKER }),
    ],
    [
      'SLSA v1 buildDefinition.internalParameters',
      'provenance-v1-max',
      'linux/amd64',
      (slsa) => (slsa.buildDefinition.internalParameters.github_event_payload = MARKER),
    ],
    [
      'inside an array, resolvedDependencies[0]',
      'provenance-v1-max',
      'linux/arm64',
      (slsa) => (slsa.resolvedDependencies = [{ github_event_payload: MARKER }]),
    ],
    [
      'deep nesting',
      'provenance-max',
      'linux/amd64',
      (slsa) =>
        (slsa.metadata.a = {
          b: { c: [{ d: { e: { github_event_payload: { text: MARKER } } } }] },
        }),
    ],
    [
      'a null value',
      'provenance-max',
      'linux/amd64',
      (slsa) => (slsa.invocation.environment = { github_event_payload: null }),
    ],
    [
      'an empty-string value',
      'provenance-v1-max',
      'linux/amd64',
      (slsa) => (slsa.buildDefinition.internalParameters.github_event_payload = ''),
    ],
  ];
  for (const [label, name, platform, place] of placements) {
    const provenance = fixture(name);
    place(provenance[platform].SLSA);
    const problems = attestationProblems(provenance, fixture('sbom'));
    assert.deepEqual(problems, [payloadMessage(platform)], label);
    assert.ok(!problems.join().includes(MARKER), label);
  }
});

test('an attestation file that is not JSON fails with its name only, never its text', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'attestations-'));
  try {
    const bare = path.join(dir, 'bare.json');
    writeFileSync(bare, MARKER);
    const sbom = fileURLToPath(new URL('./fixtures/sbom.json', import.meta.url));
    for (const [argv, expected] of [
      [[bare, sbom], "::error title=attestations::bare.json isn't JSON"],
      [[path.join(dir, 'gone.json'), sbom], "::error title=attestations::gone.json can't be read"],
    ]) {
      const lines = [];
      const code = main(argv, { log: (line) => lines.push(String(line)), env: {} });
      assert.equal(code, 1);
      assert.deepEqual(lines, [expected]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a platform with no provenance or no SBOM fails', () => {
  assert.deepEqual(attestationProblems(fixture('provenance-max'), fixture('sbom-amd64-only')), [
    'linux/arm64 has no SBOM attestation',
  ]);
  assert.deepEqual(attestationProblems({}, fixture('sbom')), [
    'linux/amd64 has no provenance attestation',
    'linux/arm64 has no provenance attestation',
  ]);
  const empty = { 'linux/amd64': { SPDX: { packages: [] } }, 'linux/arm64': { SPDX: {} } };
  assert.deepEqual(attestationProblems(fixture('provenance-max'), empty), [
    "linux/amd64's SBOM lists no packages",
    "linux/arm64's SBOM lists no packages",
  ]);
  assert.equal(attestationProblems(null, null).length, 4);
});

test('a platform SBOM file is named for its platform', () => {
  assert.equal(sbomFileName('linux/arm64'), 'sbom-linux-arm64.spdx.json');
});
