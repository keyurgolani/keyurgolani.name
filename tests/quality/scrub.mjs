#!/usr/bin/env node
// Scrubs every artifact under the reports directory (#11, Slice 1, item 11):
// cookie, Set-Cookie, Authorization, and CSRF values, and the run's canary
// when QUALITY_CANARY_FILE holds it. run.ts scrubs and scans after every run;
// CI runs this too, with `if: always()`, before it uploads, so a run cut off
// by a timeout uploads nothing a scrub would have taken out.
//
//   node tests/quality/scrub.mjs
import { readFileSync } from 'node:fs';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { canaryPassword, scrubArtifacts } from './lib/artifacts.mjs';

/** The run's canary, from the file run.ts wrote it to, or none. */
function canary(env = process.env) {
  if (!env.QUALITY_CANARY_FILE) return null;
  try {
    return readFileSync(env.QUALITY_CANARY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const planted = canary();
const changed = await scrubArtifacts(
  reportsDir(),
  planted ? [planted, canaryPassword(planted)] : [],
);
console.log(`[quality] scrubbed ${changed.length} file(s) under ${reportsDir()}`);
