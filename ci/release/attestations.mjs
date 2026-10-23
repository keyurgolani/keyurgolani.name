#!/usr/bin/env node
// Checks a built image index carries BuildKit's provenance, at mode=max, and
// an SBOM for every platform (docs/releasing.md).
//
//   docker buildx imagetools inspect <image>@<digest> --format '{{json .Provenance}}' > provenance.json
//   docker buildx imagetools inspect <image>@<digest> --format '{{json .SBOM}}' > sbom.json
//   node ci/release/attestations.mjs provenance.json sbom.json [--platforms=linux/amd64,linux/arm64] [--write-sboms=<dir>]
//
// --write-sboms writes each platform's SPDX document to
// <dir>/sbom-<os>-<arch>.spdx.json, for the release's assets.
//
// Pure Node with no dependencies.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORMS = ['linux/amd64', 'linux/arm64'];

/** The file name a platform's SPDX document gets: sbom-linux-amd64.spdx.json. */
export const sbomFileName = (platform) => `sbom-${platform.replaceAll('/', '-')}.spdx.json`;

/** The GitHub event payload's key, which a provenance must never carry. */
export const EVENT_PAYLOAD_KEY = 'github_event_payload';

/** Whether `value` holds a `key` anywhere inside it. */
function holdsKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => holdsKey(item, key));
  return Object.hasOwn(value, key) || Object.values(value).some((item) => holdsKey(item, key));
}

/**
 * Why the attestations fall short, one line each, or none.
 *
 * imagetools keys both by platform. A provenance entry is { SLSA: {...} },
 * and only mode=max records the build's configuration (`buildConfig`, in
 * SLSA v0.2's predicate or v1's internalParameters). An SBOM entry is
 * { SPDX: {...} } with at least one package.
 */
export function attestationProblems(provenance, sbom, platforms = PLATFORMS) {
  const problems = [];
  for (const platform of platforms) {
    const slsa = provenance?.[platform]?.SLSA;
    if (!slsa || typeof slsa !== 'object') {
      problems.push(`${platform} has no provenance attestation`);
    } else {
      if (!holdsKey(slsa, 'buildConfig')) {
        problems.push(
          `${platform}'s provenance has no buildConfig, so it wasn't built with mode=max`,
        );
      }
      // Named by key only: its value is the event's text.
      if (holdsKey(slsa, EVENT_PAYLOAD_KEY)) {
        problems.push(
          `${platform}'s provenance carries ${EVENT_PAYLOAD_KEY}. Set provenance-add-gha=false in the builder's driver-opts`,
        );
      }
    }
    const spdx = sbom?.[platform]?.SPDX;
    if (!spdx || typeof spdx !== 'object') {
      problems.push(`${platform} has no SBOM attestation`);
    } else if (!Array.isArray(spdx.packages) || spdx.packages.length === 0) {
      problems.push(`${platform}'s SBOM lists no packages`);
    }
  }
  return problems;
}

function main(argv) {
  const option = argv.find((arg) => arg.startsWith('--platforms='));
  const platforms = option ? option.slice('--platforms='.length).split(',') : PLATFORMS;
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (positional.length !== 2) {
    console.error(
      'usage: node ci/release/attestations.mjs <provenance.json> <sbom.json> [--platforms=a,b]',
    );
    return 2;
  }
  const [provenance, sbom] = positional.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const problems = attestationProblems(provenance, sbom, platforms);
  const sbomDir = argv
    .find((arg) => arg.startsWith('--write-sboms='))
    ?.slice('--write-sboms='.length);
  if (sbomDir && problems.length === 0) {
    mkdirSync(sbomDir, { recursive: true });
    for (const platform of platforms) {
      const file = path.join(sbomDir, sbomFileName(platform));
      writeFileSync(file, `${JSON.stringify(sbom[platform].SPDX, null, 2)}\n`);
      console.log(`[attestations] ${platform} SBOM -> ${file}`);
    }
  }
  const summary = problems.length
    ? `### attestations: failed\n\n${problems.map((p) => `- ${p}.`).join('\n')}\n`
    : `### attestations: passed\n\nProvenance (mode=max) and an SBOM for ${platforms.join(' and ')}.\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  for (const problem of problems) console.log(`::error title=attestations::${problem}`);
  return problems.length ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
