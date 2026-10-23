import 'server-only';
import {
  sourceCatalogReader,
  type CatalogReader,
  type SourceFinding,
  type UnitChecks,
} from '@portfolio/core';
import {
  validatePublicationUnit,
  type AppearanceCatalog,
  type ContentExtension,
  type Context,
  type UnitValidator,
} from '@portfolio/schema';
import type { PairFiles } from '@portfolio/schema/node';
import { isSampleIdentity } from '../lib/sample-identity';
import type { ConfigIssue, RuntimeMode } from './config';

// The mounted documents as a CatalogReader (#3, item 19): @portfolio/core's
// SourceCatalogReader over PORTFOLIO_SOURCE_DIR, which read-only serves, and
// which owner's empty store serves until #3's Slice 3 imports them. Its
// findings are startup issues under PORTFOLIO_SOURCE_DIR. The pair is
// checked as served, with the build's live context, by #4's startup rule as
// #5 amends it: an unregistered variant and stale controls only warn.

export { BUNDLED_SAMPLE_NAMES } from '../lib/sample-identity';

const KEY = 'PORTFOLIO_SOURCE_DIR';

export interface SourceCatalogInput {
  /** Absolute PORTFOLIO_SOURCE_DIR. */
  readonly sourceDir: string;
  readonly mode: RuntimeMode;
  /** The bundled examples, rendered under `next dev` when the directory holds neither document. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers. Without one, they go unchecked. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions documents are checked against. Others warn. */
  readonly extensions?: readonly ContentExtension[];
  /** The contract's checks on the pair, live (#5): an unregistered selection only warns. */
  readonly validators?: readonly UnitValidator[];
  /** The deployment's canonical origin, which links are checked against. */
  readonly origin?: string;
  /** Receives the findings of every re-reading under `next dev`. */
  readonly report: (issue: ConfigIssue) => void;
}

export type OpenSourceCatalogResult =
  | { readonly ok: true; readonly reader: CatalogReader; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

export function openSourceCatalog(input: SourceCatalogInput): OpenSourceCatalogResult {
  const context: Context = {
    catalog: input.catalog,
    extensions: input.extensions,
    validators: input.validators,
    ...(input.origin ? { canonicalOrigin: input.origin } : {}),
  };
  const opened = sourceCatalogReader({
    sourceDir: input.sourceDir,
    mode: input.mode,
    examples: input.examples,
    checks: servedChecks(context),
    context,
    isSampleIdentity,
    report: (finding) => input.report(issueOf(finding)),
  });
  const issues = opened.findings.map(issueOf);
  return opened.ok ? { ok: true, reader: opened.reader, issues } : { ok: false, issues };
}

/** #4's validator with the live context: a served pair is checked as it serves. */
function servedChecks(context: Context): UnitChecks {
  return { validate: (pair) => validatePublicationUnit(pair, context), appVersion: '' };
}

/** A finding as a startup issue under PORTFOLIO_SOURCE_DIR. */
function issueOf({ severity, code, ...where }: SourceFinding): ConfigIssue {
  return { severity, key: KEY, code, ...where };
}
