#!/usr/bin/env node
// CI only: node ci/release/install-grype.mjs <dest-dir>
//
// Downloads the pinned linux x64 Grype release, refuses an archive whose
// SHA-256 differs from GRYPE below, and puts the binary in <dest-dir>.
// Dependabot doesn't track it. To update it, take the version and the
// asset's digest from `gh api repos/anchore/grype/releases/tags/<tag>`.
//
// Grype fetches its vulnerability database when it first runs, in CI only.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRYPE = {
  version: '0.120.1',
  url: 'https://github.com/anchore/grype/releases/download/v0.120.1/grype_0.120.1_linux_amd64.tar.gz',
  sha256: '0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d',
};

/** Why `archive` isn't the pinned release, or null when it is. */
export function digestProblem(archive, expected = GRYPE.sha256) {
  const actual = createHash('sha256').update(archive).digest('hex');
  return actual === expected ? null : `SHA-256 ${actual} does not match the pinned ${expected}`;
}

async function main(argv) {
  const dest = argv[0];
  if (!dest) {
    console.error('usage: node ci/release/install-grype.mjs <dest-dir>');
    return 2;
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.error('This installer only fetches the linux x64 build, for CI.');
    return 2;
  }
  const response = await fetch(GRYPE.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`grype: download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const problem = digestProblem(archive);
  if (problem) throw new Error(`grype: ${problem}`);
  const work = mkdtempSync(path.join(tmpdir(), 'grype-'));
  try {
    writeFileSync(path.join(work, 'grype.tar.gz'), archive);
    const tar = spawnSync('tar', ['-xzf', path.join(work, 'grype.tar.gz'), '-C', work, 'grype'], {
      stdio: 'inherit',
    });
    if (tar.status !== 0) throw new Error('grype: could not unpack the archive');
    mkdirSync(dest, { recursive: true });
    copyFileSync(path.join(work, 'grype'), path.join(dest, 'grype'));
    chmodSync(path.join(dest, 'grype'), 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`[grype] ${GRYPE.version} -> ${path.join(dest, 'grype')}`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error title=grype::${error.message}`);
      process.exit(1);
    },
  );
}
