// The manual-run records' cases for `pnpm quality:meta` (#11, 11-4): the
// repository's records in quality/manual-runs/ validate, each committed
// template validates once a tester fills it and fails as it stands, and
// each known-bad record, a filled template with one thing broken, fails for
// that one reason (lib/manual-runs.ts).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  MANUAL_RUNS_DIR,
  manualRunProblems,
  repositoryManualRunContext,
  TODO,
  validateManualRuns,
  type ManualRun,
  type ManualRunContext,
} from '../lib/manual-runs';
import type { MetaCase, MetaOutcome } from './cases';

const GATE = 'manual-runs';
const TEMPLATES = path.join(MANUAL_RUNS_DIR, 'templates');
/** The day the filled records are dated, and the one after, which the checks take as today. */
const DATE = '2026-10-23';
const TODAY = '2026-10-24';

/** The committed templates, by surface. */
export function templates(): { surface: string; file: string; text: string }[] {
  return readdirSync(TEMPLATES)
    .filter((name) => name.endsWith('.yml'))
    .sort()
    .map((name) => ({
      surface: name.split('.')[0]!,
      file: path.join(TEMPLATES, name),
      text: readFileSync(path.join(TEMPLATES, name), 'utf8'),
    }));
}

/** A template as a tester fills it: every todo answered, every item passed. */
export function filled(text: string): ManualRun {
  const record = parse(text) as ManualRun & Record<string, unknown>;
  return {
    ...record,
    commit: '0123456789abcdef0123456789abcdef01234567',
    date: DATE,
    tester: 'test-tester',
    browser: { ...record.browser, version: '26.0' },
    assistiveTechnology: { ...record.assistiveTechnology, version: '26.0' },
    os: { ...record.os, version: '26.0' },
    result: 'pass',
    items: record.items.map((item) => ({ ...item, result: 'pass' as const })),
  };
}

let context: Promise<ManualRunContext> | undefined;
/** The repository's context, with today fixed so the cases hold on any day. */
const repository = async () => {
  context ??= repositoryManualRunContext();
  return { ...(await context), today: TODAY };
};

const outcome = (problems: readonly string[]): MetaOutcome => ({
  passed: problems.length === 0,
  findings: problems,
});

/** The record `run` makes, saved as `name`, checked against the repository. */
async function recordOutcome(name: string, run: unknown): Promise<MetaOutcome> {
  const ctx = await repository();
  return outcome(manualRunProblems(name, typeof run === 'string' ? run : stringify(run), ctx));
}

/** The first template, filled, as the known-bad records start from. */
const base = () => {
  const [first] = templates();
  if (!first) throw new Error(`No template in ${TEMPLATES}.`);
  return { surface: first.surface, run: filled(first.text) };
};
const nameFor = (surface: string) => `${surface}-${DATE}-safari-voiceover.yml`;

function badCase(
  slug: string,
  input: string,
  reason: RegExp,
  change: (run: ManualRun, surface: string) => { name?: string; run: unknown },
): MetaCase {
  return {
    id: `${GATE}/${slug}`,
    gate: GATE,
    input,
    expect: 'fail',
    reason,
    run: async () => {
      const { surface, run } = base();
      const changed = change(structuredClone(run), surface);
      return recordOutcome(changed.name ?? nameFor(surface), changed.run);
    },
  };
}

export const MANUAL_RUN_CASES: readonly MetaCase[] = [
  {
    id: `${GATE}/repository`,
    gate: GATE,
    input: 'quality/manual-runs/*.yml',
    expect: 'pass',
    run: async () => outcome(validateManualRuns(MANUAL_RUNS_DIR, await repository()).problems),
  },
  {
    id: `${GATE}/templates-filled`,
    gate: GATE,
    input: 'each quality/manual-runs/templates/*.yml with every todo answered',
    expect: 'pass',
    run: async () => {
      const all = templates();
      if (all.length === 0) return outcome([`No template in ${TEMPLATES}.`]);
      const problems: string[] = [];
      for (const { surface, text } of all) {
        problems.push(...(await recordOutcome(nameFor(surface), filled(text))).findings);
      }
      return outcome(problems);
    },
  },
  {
    id: `${GATE}/template-unfilled`,
    gate: GATE,
    input: 'a template saved as a record as it stands',
    expect: 'fail',
    reason: new RegExp(`is still a template: commit, date, tester, .* are ${TODO}\\.$`),
    run: async () => {
      const [first] = templates();
      return recordOutcome(nameFor(first!.surface), first!.text);
    },
  },
  badCase('missing-tester', 'a record with no tester', /: tester: Required$/, (run) => {
    const { tester: _tester, ...rest } = run;
    void _tester;
    return { run: rest };
  }),
  badCase(
    'unknown-item',
    "a record answering an item its checklist doesn't have",
    /answers page:\/nowhere:complete, which \S+'s checklist doesn't have\.$/,
    (run) => ({
      run: { ...run, items: [...run.items, { id: 'page:/nowhere:complete', result: 'pass' }] },
    }),
  ),
  badCase(
    'missing-item',
    'a record that leaves the flash check unanswered',
    /leaves flash of \S+'s checklist unanswered\.$/,
    (run) => ({ run: { ...run, items: run.items.filter((item) => item.id !== 'flash') } }),
  ),
  badCase(
    'fail-without-note',
    'a failed item with no note',
    /flash is fail, with no note saying why\.$/,
    (run) => ({
      run: {
        ...run,
        result: 'fail',
        items: run.items.map((item) =>
          item.id === 'flash' ? { ...item, result: 'fail' as const } : item,
        ),
      },
    }),
  ),
  badCase(
    'pass-with-failed-item',
    'a passing run with a failed item',
    /passes, and flash failed\.$/,
    (run) => ({
      run: {
        ...run,
        items: run.items.map((item) =>
          item.id === 'flash'
            ? { ...item, result: 'fail' as const, note: 'The hero flashed four times.' }
            : item,
        ),
      },
    }),
  ),
  badCase(
    'unknown-exception',
    "a record linking an exception quality/exceptions.yml doesn't hold",
    /links exception no-such-exception, which quality\/exceptions\.yml doesn't hold\.$/,
    (run) => ({ run: { ...run, exceptions: ['no-such-exception'] } }),
  ),
  badCase(
    'future-date',
    'a record dated after today',
    /date 2026-10-25 is after today, 2026-10-24\.$/,
    (run, surface) => ({
      name: `${surface}-2026-10-25-safari-voiceover.yml`,
      run: { ...run, date: '2026-10-25' },
    }),
  ),
  badCase(
    'unregistered-surface',
    'a record of a surface nothing registers',
    /surface studio isn't registered\. Registered: /,
    (run) => ({ name: `studio-${DATE}-safari-voiceover.yml`, run: { ...run, surface: 'studio' } }),
  ),
  badCase(
    'misnamed',
    'a record whose file is named for another day',
    /is named for another run: name it \S+-2026-10-23-<browser>-<assistive technology>\.yml\.$/,
    (run, surface) => ({ name: `${surface}-2026-01-01-safari-voiceover.yml`, run }),
  ),
  badCase(
    'old-checklist',
    'a record of an older checklist version',
    /answers checklist version 1, and the checklist is version \d+\.$/,
    (run) => ({ run: { ...run, checklistVersion: 1 } }),
  ),
];
