#!/usr/bin/env node
// Scrubs every artifact under the reports directory (#11, Slice 1, item 11)
// by lib/artifacts.mjs's rules, and of the secrets QUALITY_SECRETS_FILE
// lists by value, then scans for the run's canary when QUALITY_CANARY_FILE
// holds it. run.ts scrubs and scans after every run. CI runs this too, with
// `if: always()`, and uploads only when it succeeds, so a run cut off by a
// timeout uploads nothing a scrub would have taken out.
//
//   node tests/quality/scrub.mjs
//
// It goes through every file, whatever one does: a file it can't read, or
// a packed artifact it can't open, is deleted. It exits 1 when it deleted
// any, or when the canary is still in any artifact, so nothing uploads.
import { readFileSync } from 'node:fs';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { readSecrets, scanArtifacts, scrubArtifacts } from './lib/artifacts.mjs';

/** The run's canary, from the file run.ts wrote it to, or none. */
function canary(env = process.env) {
  if (!env.QUALITY_CANARY_FILE) return null;
  try {
    return readFileSync(env.QUALITY_CANARY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const dir = reportsDir();
const { changed, removed } = await scrubArtifacts(
  dir,
  readSecrets(process.env.QUALITY_SECRETS_FILE),
);
console.log(`[quality] scrubbed ${changed.length} file(s) under ${dir}`);
for (const { file, reason } of removed) {
  console.error(`[quality] deleted ${file}: ${reason}`);
}
const planted = canary();
const left = planted ? await scanArtifacts(dir, [{ label: 'the run canary', value: planted }]) : [];
for (const { file, entry } of left) {
  console.error(`[quality] the run canary is still in ${file}${entry ? ` (${entry})` : ''}`);
}
if (removed.length > 0 || left.length > 0) {
  console.error('[quality] the scrub failed, so the reports must not upload.');
  process.exitCode = 1;
}
