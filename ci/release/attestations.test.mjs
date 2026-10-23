// The provenance and SBOM check, on fixture imagetools output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attestationProblems, sbomFileName } from './attestations.mjs';

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

test('a provenance that carries the GitHub event payload fails, named by its key only', () => {
  const provenance = fixture('provenance-max');
  const payload = 'commit message text that must not be printed';
  provenance['linux/arm64'].SLSA.invocation.environment = { github_event_payload: payload };
  const problems = attestationProblems(provenance, fixture('sbom'));
  assert.deepEqual(problems, [
    "linux/arm64's provenance carries github_event_payload. Set provenance-add-gha=false in the builder's driver-opts",
  ]);
  assert.ok(!problems.join().includes(payload));
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
