import 'server-only';
import path from 'node:path';
import type { AppearanceCatalog, ContentExtension, Portfolio } from '@portfolio/schema';
import { readPair, type PairFiles } from '@portfolio/schema/node';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue } from './config';
import { frozenUnit, pairDigest, recordIssue } from './pair-records';

// The sample adapter (#1, item 16): the CatalogReader for `demo`. It reads
// the bundled pair, portfolio.example.yml and site.example.yml, once at
// startup, validates them as a pair, and freezes them. The standalone output
// ships both through outputFileTracingIncludes. It never reads
// PORTFOLIO_SOURCE_DIR.

export interface SampleCatalogOptions {
  /** The bundled examples. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers, which the sample is checked against. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions the sample is checked against, as documents are. Others warn. */
  readonly extensions?: readonly ContentExtension[];
}

export type OpenSampleResult =
  | { readonly ok: true; readonly reader: CatalogReader; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

// A broken sample is a broken build, not a configuration mistake. The issue
// names the profile that needs it.
const KEY = 'PORTFOLIO_PROFILE';

/** The issue for an example the build lacks, or ships in a form the server can't read. */
const UNREAD = {
  'source.missing': [
    'sample_missing',
    'The demo profile renders the bundled sample, and this build has none.',
  ],
  'source.unreadable': [
    'sample_unreadable',
    "The demo profile renders the bundled sample, and the server can't read it.",
  ],
} as const;

export function openSampleCatalog({
  examples,
  catalog,
  extensions,
}: SampleCatalogOptions): OpenSampleResult {
  const result = readPair(examples, { catalog, extensions });
  if (!result.ok) {
    const unread = result.diagnostics.find(({ code }) => code in UNREAD);
    if (unread) {
      const [code, message] = UNREAD[unread.code as keyof typeof UNREAD];
      return {
        ok: false,
        issues: [fatal(code, message, path.basename(examples[unread.document]))],
      };
    }
    // Which file is enough: the sample's own records would only describe the build.
    const [first] = result.diagnostics;
    return {
      ok: false,
      issues: [
        fatal(
          'sample_invalid',
          "The bundled sample doesn't validate, so this build is broken.",
          path.basename(examples[first?.document ?? 'portfolio']),
        ),
      ],
    };
  }
  const { pair, sources } = result;
  const live: LiveRevision = Object.freeze({
    revisionId: `sample-${pairDigest(sources)}`,
    unit: frozenUnit(withoutLiveData(pair.portfolio), pair.site),
  });
  const names = { portfolio: sources.portfolio.name, site: sources.site.name };
  return {
    ok: true,
    issues: result.diagnostics.map((record) => recordIssue(record, KEY, names)),
    reader: Object.freeze({ getLive: async () => live }),
  };
}

/**
 * The sample without its `github` sections. Until #10 gives renderers
 * snapshot data, a github section fetches a live account from
 * api.github.com on every render, so the public demo would show someone's
 * real repositories and depend on an outside host. demo serves only the
 * bundled sample, so it drops them.
 */
function withoutLiveData(portfolio: Portfolio): Portfolio {
  return { ...portfolio, sections: portfolio.sections.filter(({ kind }) => kind !== 'github') };
}

function fatal(code: string, message: string, file: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message, file };
}
