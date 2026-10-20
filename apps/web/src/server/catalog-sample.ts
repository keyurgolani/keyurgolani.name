import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectFormat, parsePortfolio } from '@portfolio/schema';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue } from './config';
import { deepFreeze } from './freeze';

// The sample adapter (#1, item 16): the CatalogReader for `demo`. It reads
// the bundled portfolio.example.yml once at startup, which the standalone
// output ships through outputFileTracingIncludes, and freezes it. It never
// reads PORTFOLIO_SOURCE_DIR.

export interface SampleCatalogOptions {
  /** The bundled example document. */
  readonly examplePath: string;
}

export type OpenSampleResult =
  | { readonly ok: true; readonly reader: CatalogReader; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

// A broken sample is a broken build, not a configuration mistake. The issue
// names the profile that needs it.
const KEY = 'PORTFOLIO_PROFILE';

export function openSampleCatalog({ examplePath }: SampleCatalogOptions): OpenSampleResult {
  const file = path.basename(examplePath);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(/*turbopackIgnore: true*/ examplePath);
  } catch {
    return {
      ok: false,
      issues: [
        fatal(
          'sample_missing',
          'The demo profile renders the bundled sample, and this build has none.',
          file,
        ),
      ],
    };
  }
  const parsed = parsePortfolio(bytes.toString('utf8'), detectFormat(file));
  if (!parsed.ok) {
    return {
      ok: false,
      issues: [
        fatal(
          'sample_invalid',
          "The bundled sample doesn't validate, so this build is broken.",
          file,
        ),
      ],
    };
  }
  const live: LiveRevision = Object.freeze({
    revisionId: `sample-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`,
    unit: Object.freeze({ portfolio: deepFreeze(parsed.value) }),
  });
  return { ok: true, issues: [], reader: Object.freeze({ getLive: async () => live }) };
}

function fatal(code: string, message: string, file: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message, file };
}
