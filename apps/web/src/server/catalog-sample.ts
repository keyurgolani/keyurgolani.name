import 'server-only';
import path from 'node:path';
import type { AppearanceCatalog, ContentExtension, UnitValidator } from '@portfolio/schema';
import { readPair, readUnitFiles, type PairFiles } from '@portfolio/schema/node';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue } from './config';
import { frozenUnit, pairDigest, recordIssue } from './pair-records';

// The sample adapter (#1, item 16): the CatalogReader for `demo`. It reads
// the bundled pair, portfolio.example.yml and site.example.yml, once at
// startup, validates them as a pair, reads the snapshots bundled beside them
// (#10: snapshots/github.json), and freezes it all. The standalone output
// ships them through outputFileTracingIncludes. It never reads
// PORTFOLIO_SOURCE_DIR, and nothing it renders fetches: a github section
// shows the bundled snapshot's values.

export interface SampleCatalogOptions {
  /** The bundled examples. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers, which the sample is checked against. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions the sample is checked against, as documents are. Others warn. */
  readonly extensions?: readonly ContentExtension[];
  /** The contract's checks on the pair, live, as documents get them (#5). */
  readonly validators?: readonly UnitValidator[];
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
  validators,
}: SampleCatalogOptions): OpenSampleResult {
  const result = readPair(examples, { catalog, extensions, validators });
  if (!result.ok) {
    const unread = result.diagnostics.find(({ code }) => code in UNREAD);
    if (unread) {
      const [code, message] = UNREAD[unread.code as keyof typeof UNREAD];
      return {
        ok: false,
        issues: [fatal(code, message, path.basename(examples[pairDocument(unread.document)]))],
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
          path.basename(examples[pairDocument(first?.document)]),
        ),
      ],
    };
  }
  const { pair, sources } = result;
  const unitFiles = readUnitFiles(path.dirname(examples.portfolio));
  const broken = unitFiles.diagnostics.find(({ severity }) => severity !== 'warning');
  if (broken) {
    // The bundled snapshots are the build's: one that doesn't read is a broken build.
    return {
      ok: false,
      issues: [
        fatal(
          'sample_invalid',
          "The bundled sample's snapshots don't read, so this build is broken.",
          broken.file ?? 'snapshots',
        ),
      ],
    };
  }
  const live: LiveRevision = Object.freeze({
    revisionId: `sample-${pairDigest(sources)}`,
    unit: frozenUnit(pair.portfolio, pair.site, unitFiles),
  });
  const names = { portfolio: sources.portfolio.name, site: sources.site.name };
  return {
    ok: true,
    issues: [...result.diagnostics, ...unitFiles.diagnostics].map((record) =>
      recordIssue(record, KEY, names),
    ),
    reader: Object.freeze({ getLive: async () => live }),
  };
}

/** Which of the pair's two documents a record names: readPair's records name one or the other. */
function pairDocument(document: string | undefined): keyof PairFiles {
  return document === 'site' ? 'site' : 'portfolio';
}

function fatal(code: string, message: string, file: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message, file };
}
