#!/usr/bin/env node
// CI only: node ci/install-workflow-linters.mjs <dest-dir>
// Downloads the pinned linux x64 actionlint and zizmor, refuses any archive
// whose SHA-256 differs from ci/workflow-linters.mjs, and puts the binaries in
// <dest-dir>.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKFLOW_LINTERS } from './workflow-linters.mjs';

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

const dest = process.argv[2];
if (!dest) {
  console.error('usage: node ci/install-workflow-linters.mjs <dest-dir>');
  process.exit(2);
}
if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error(
    'This installer only fetches linux x64 builds. Locally, see ci/check-workflows.mjs.',
  );
  process.exit(2);
}

mkdirSync(dest, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'workflow-linters-'));
try {
  for (const { name, version, url, sha256 } of WORKFLOW_LINTERS) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${name}: download failed with HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== sha256)
      throw new Error(`${name}: SHA-256 ${actual} does not match the pinned ${sha256}`);

    const unpacked = path.join(work, name);
    mkdirSync(unpacked);
    writeFileSync(path.join(work, `${name}.tar.gz`), archive);
    const tar = spawnSync('tar', ['-xzf', path.join(work, `${name}.tar.gz`), '-C', unpacked], {
      stdio: 'inherit',
    });
    if (tar.status !== 0) throw new Error(`${name}: could not unpack the archive`);
    const binary = findFile(unpacked, name);
    if (!binary) throw new Error(`${name}: the archive has no ${name} binary`);
    copyFileSync(binary, path.join(dest, name));
    chmodSync(path.join(dest, name), 0o755);
    console.log(`[workflow-linters] ${name} ${version} installed (sha256 ${sha256})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
