// The exceptions validator's test inputs (#11, Slice 1, item 12), under
// tests/quality/fixtures/exceptions/: the known-bad ones, each with the
// reason it must fail for, and the known-good ones. Its unit tests and pnpm
// quality:meta both run them, against one pinned run so the fixtures' dates
// never age out.

import fs from 'node:fs';
import path from 'node:path';
import { loadThresholds, REPO_ROOT } from '../../../quality/thresholds';
import {
  BUDGETS_FILE,
  EXCEPTIONS_FILE,
  type ExceptionContext,
  type ExceptionInputs,
} from './exceptions';

export const EXCEPTION_FIXTURES_DIR = path.join(
  REPO_ROOT,
  'tests',
  'quality',
  'fixtures',
  'exceptions',
);

/** The run the fixtures are checked against: a fixed UTC date, axe-core, manual run, and surface owner. */
export function fixtureContext(overrides: Partial<ExceptionContext> = {}): ExceptionContext {
  return {
    today: '2026-11-01',
    thresholds: loadThresholds(),
    mode: 'pr',
    axeVersion: '4.11.0',
    manualRuns: new Set(['2026-10-20-login-voiceover']),
    surfaceOwners: new Map([['login', 'keyurgolani']]),
    ...overrides,
  };
}

/** A fixture's files: one of the two in tests/quality/fixtures/exceptions/, the repository's for the other. */
export interface ExceptionFixtureFiles {
  /** In place of quality/exceptions.yml. */
  readonly quality?: string;
  /** In place of runtime-budgets.json. */
  readonly budgets?: string;
}

/** The inputs a fixture gives validateExceptions(). */
export function fixtureInputs(files: ExceptionFixtureFiles): ExceptionInputs {
  const quality = files.quality
    ? path.join(EXCEPTION_FIXTURES_DIR, files.quality)
    : EXCEPTIONS_FILE;
  const budgets = files.budgets ? path.join(EXCEPTION_FIXTURES_DIR, files.budgets) : BUDGETS_FILE;
  return {
    quality: { file: quality, text: fs.readFileSync(quality, 'utf8') },
    budgets: { file: budgets, text: fs.readFileSync(budgets, 'utf8') },
  };
}

export interface KnownBadExceptions extends ExceptionFixtureFiles {
  readonly name: string;
  /** What every problem it raises names. */
  readonly reason: RegExp;
}

export const KNOWN_BAD_EXCEPTIONS: readonly KnownBadExceptions[] = [
  { name: 'expired', quality: 'expired.yml', reason: /expires: expired on 2026-09-01/ },
  { name: 'wildcard', quality: 'wildcard.yml', reason: /scope\.route: is a wildcard/ },
  {
    name: 'non-waivable',
    quality: 'non-waivable.yml',
    reason:
      /axe color-contrast is WCAG AA: a WCAG A or AA failure on essential content can't be excepted, in any tier\. This exception is non-waivable\./,
  },
  {
    name: 'over-90-days',
    quality: 'over-90-days.yml',
    reason: /expires: is 106 days after created, more than the 90 days an exception may run/,
  },
  { name: 'missing-scope', quality: 'missing-scope.yml', reason: /scope\.viewport: is missing/ },
  {
    name: 'quarantine-over-14-days',
    quality: 'quarantine-over-14-days.yml',
    reason: /expires: is 21 days after created, more than the 14 days a flake quarantine may run/,
  },
  {
    name: 'low-contrast',
    quality: 'low-contrast.yml',
    reason:
      /contrast text is WCAG AA: a WCAG A or AA failure on essential content can't be excepted, in any tier/,
  },
  {
    name: 'decorative-low-contrast',
    quality: 'decorative-low-contrast.yml',
    reason:
      /contrast text measures a pack's text roles, which carry the page's content, so decorative can't excuse it\./,
  },
  {
    name: 'budgets-missing-metric',
    budgets: 'runtime-budgets.missing-metric.json',
    reason: /scope\.metric: is missing: budget varies on metric/,
  },
];

export const KNOWN_GOOD_EXCEPTIONS: readonly (ExceptionFixtureFiles & { readonly name: string })[] =
  [
    { name: 'valid', quality: 'valid.yml' },
    { name: 'budgets-valid', budgets: 'runtime-budgets.valid.json' },
  ];
