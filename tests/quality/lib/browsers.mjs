// The missing-browser check (#11, Slice 1, item 8): before a quality run
// starts, each engine it plans must launch. A browser that isn't installed,
// or doesn't start, fails the run, instead of its tests going uncollected
// or reporting a launch error as one more test failure.
//
//   node tests/quality/lib/browsers.mjs chromium [firefox webkit]
//
// prints {"missing":[{"engine","error"}]} and exits 1 when one is missing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Each of `engines` that doesn't launch, with why.
 *
 * @param {readonly string[]} engines
 * @returns {Promise<{ engine: string, error: string }[]>}
 */
export async function missingBrowsers(engines) {
  const playwright = await import('playwright');
  const missing = [];
  for (const engine of engines) {
    const type = playwright[engine];
    if (!type) {
      missing.push({ engine, error: `Playwright has no engine named ${engine}` });
      continue;
    }
    try {
      const browser = await type.launch({ timeout: 60_000 });
      await browser.close();
    } catch (error) {
      missing.push({ engine, error: String(error.message ?? error).split('\n')[0] ?? '' });
    }
  }
  return missing;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const missing = await missingBrowsers(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({ missing })}\n`);
  process.exitCode = missing.length > 0 ? 1 : 0;
}
