// The static workflow check's test inputs (#11, Slice 1, item 13), under
// tests/quality/fixtures/workflows/: a known-bad workflow per rule, each with
// the reason it must fail for, and a known-good one. Its unit tests and pnpm
// quality:meta both run them. They sit outside .github/workflows/, so
// GitHub never runs them and actionlint and zizmor never read them.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../quality/thresholds';
import { checkWorkflowSource, type WorkflowProblem, type WorkflowRule } from './workflows';

export const WORKFLOW_FIXTURES_DIR = path.join(
  REPO_ROOT,
  'tests',
  'quality',
  'fixtures',
  'workflows',
);

export interface KnownBadWorkflow {
  readonly file: string;
  readonly rule: WorkflowRule;
  /** What every problem it raises says. */
  readonly reason: RegExp;
}

export const KNOWN_BAD_WORKFLOWS: readonly KnownBadWorkflow[] = [
  {
    file: 'pull-request-target.yml',
    rule: 'pull-request-target',
    reason:
      /^triggers on pull_request_target, which runs a fork's pull request with the base repository's secrets/,
  },
  {
    file: 'write-permissions.yml',
    rule: 'permissions',
    reason:
      /^job comment runs on pull requests with pull-requests: write: a pull request's job gets contents: read and actions: read at most\.$/,
  },
  {
    file: 'secrets.yml',
    rule: 'secrets',
    reason: /^job preview runs on pull requests and references secrets\.$/,
  },
];

export const KNOWN_GOOD_WORKFLOWS: readonly string[] = ['push-tags-schedule.yml'];

/** A fixture's problems, as the check reports them. */
export function fixtureProblems(file: string): WorkflowProblem[] {
  const full = path.join(WORKFLOW_FIXTURES_DIR, file);
  return checkWorkflowSource(path.relative(REPO_ROOT, full), fs.readFileSync(full, 'utf8'));
}
