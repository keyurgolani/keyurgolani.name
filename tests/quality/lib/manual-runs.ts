// Manual-run records (#11, original item 3): what automation can't prove,
// a person checks with a browser and an assistive technology, and keeps as
// YAML in quality/manual-runs/, one file per run, validated here and by
// `pnpm quality:meta`. A record names the surface or composition, the
// checklist version it answers, the commit tested, the date, the tester,
// the browser, assistive technology, and OS with their versions, the
// viewport, optionally the appearance tuple, its result, each checklist
// item's result by the item's id, and any exception in
// quality/exceptions.yml it links.
//
// The checks, past the schema:
//
// - the surface is registered, and its file is named for it and the date;
// - it answers the current checklist (tests/quality/checklist.ts): its
//   version, every item once, and no item the checklist doesn't have;
// - fail and not-applicable items carry a note, a pass run has no failed
//   item, and a fail run has at least one;
// - the date is a real day, not after today;
// - every linked exception exists;
// - no field is still a template's `todo`.
//
// Whether a record is stale once its surface changes, and the fresh
// records a release needs, wait in the backlog with the rest of the
// manual-run governance.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { REPO_ROOT } from '../../../ci/lib/reports.mjs';
import { CHECKLIST_VERSION, checklistItems, registeredCompositions } from '../checklist';
import { loadRegistrations } from './registration';
import { TUPLE, VIEWPORT } from './vocabulary';

/** Where records are kept: every *.yml directly in it is one. Templates sit in templates/. */
export const MANUAL_RUNS_DIR = path.join(REPO_ROOT, 'quality', 'manual-runs');

/** The placeholder a template leaves in every field the tester fills. */
export const TODO = 'todo';

const text = z.string().trim().min(1);
const versioned = z.object({ name: text, version: text }).strict();

export const ManualRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    surface: text,
    checklistVersion: z.number().int().positive(),
    commit: z.string().regex(/^[0-9a-f]{40}$/, 'a full 40-digit commit SHA'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date, YYYY-MM-DD'),
    tester: text,
    browser: versioned,
    assistiveTechnology: versioned,
    os: versioned,
    viewport: z.string().regex(VIEWPORT, 'WIDTHxHEIGHT, such as 1440x900'),
    tuple: z.string().regex(TUPLE, 'designLanguage/colorScheme/typography/displayMode').optional(),
    result: z.enum(['pass', 'fail']),
    exceptions: z.array(text).default([]),
    items: z
      .array(
        z
          .object({
            id: text,
            /** The item's words, as the template copies them, for the tester. */
            check: z.string().optional(),
            result: z.enum(['pass', 'fail', 'not-applicable']),
            note: text.optional(),
          })
          .strict(),
      )
      .min(1),
    notes: z.string().optional(),
  })
  .strict();

export type ManualRun = z.infer<typeof ManualRunSchema>;

/** What a record is checked against. */
export interface ManualRunContext {
  /** The checklist item ids of each registered surface and composition. */
  readonly checklists: ReadonlyMap<string, readonly string[]>;
  /** The ids quality/exceptions.yml holds. */
  readonly exceptionIds: ReadonlySet<string>;
  /** Today, UTC, YYYY-MM-DD. */
  readonly today: string;
}

/** Every path in `value` whose string is still the template's placeholder. */
function placeholders(value: unknown, at = ''): string[] {
  if (value === TODO) return [at || '(record)'];
  if (Array.isArray(value))
    return value.flatMap((each, index) => placeholders(each, `${at}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, each]) =>
      placeholders(each, at ? `${at}.${key}` : key),
    );
  }
  return [];
}

const realDay = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

/** Why the record `file` holds as `source` isn't a valid manual run, one line each, or none. */
export function manualRunProblems(
  file: string,
  source: string,
  context: ManualRunContext,
): string[] {
  const name = path.basename(file);
  let data: unknown;
  try {
    data = parse(source);
  } catch (error) {
    return [`${name}: isn't YAML: ${(error as Error).message.split('\n')[0]}`];
  }
  const left = placeholders(data);
  if (left.length > 0) {
    return [
      `${name}: is still a template: ${left.join(', ')} ${left.length === 1 ? 'is' : 'are'} ${TODO}.`,
    ];
  }
  const parsed = ManualRunSchema.safeParse(data);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `${name}: ${issue.path.join('.') || '(record)'}: ${issue.message}`,
    );
  }
  const run = parsed.data;
  const problems: string[] = [];
  const say = (message: string) => problems.push(`${name}: ${message}`);

  const items = context.checklists.get(run.surface);
  if (!items) {
    say(
      `surface ${run.surface} isn't registered. Registered: ${[...context.checklists.keys()].join(', ')}.`,
    );
  }
  if (!name.startsWith(`${run.surface}-${run.date}`) || !name.endsWith('.yml')) {
    say(
      `is named for another run: name it ${run.surface}-${run.date}-<browser>-<assistive technology>.yml.`,
    );
  }
  if (!realDay(run.date)) say(`date ${run.date} isn't a real day.`);
  else if (run.date > context.today) say(`date ${run.date} is after today, ${context.today}.`);
  if (run.checklistVersion !== CHECKLIST_VERSION) {
    say(
      `answers checklist version ${run.checklistVersion}, and the checklist is version ${CHECKLIST_VERSION}.`,
    );
  }

  const ids = run.items.map((item) => item.id);
  const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (repeated.length > 0) say(`answers ${repeated.join(', ')} more than once.`);
  if (items) {
    const unknown = ids.filter((id) => !items.includes(id));
    const missing = items.filter((id) => !ids.includes(id));
    if (unknown.length > 0)
      say(`answers ${unknown.join(', ')}, which ${run.surface}'s checklist doesn't have.`);
    if (missing.length > 0)
      say(`leaves ${missing.join(', ')} of ${run.surface}'s checklist unanswered.`);
  }
  for (const item of run.items) {
    if (item.result !== 'pass' && !item.note) {
      say(`${item.id} is ${item.result}, with no note saying why.`);
    }
  }
  const failed = run.items.filter((item) => item.result === 'fail').map((item) => item.id);
  if (run.result === 'pass' && failed.length > 0) {
    say(`passes, and ${failed.join(', ')} failed.`);
  }
  if (run.result === 'fail' && failed.length === 0) say('fails, and no item failed.');
  for (const id of run.exceptions) {
    if (!context.exceptionIds.has(id))
      say(`links exception ${id}, which quality/exceptions.yml doesn't hold.`);
  }
  return problems;
}

/** Every record in `dir`, by file, with its problems. Templates, in templates/, aren't records. */
export function validateManualRuns(
  dir: string,
  context: ManualRunContext,
): { readonly files: readonly string[]; readonly problems: readonly string[] } {
  if (!existsSync(dir)) return { files: [], problems: [] };
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  const problems = files.flatMap((file) =>
    manualRunProblems(file, readFileSync(file, 'utf8'), context),
  );
  for (const file of files.filter((each) => each.endsWith('.yaml'))) {
    problems.push(`${path.basename(file)}: records end in .yml.`);
  }
  return { files, problems };
}

/** The ids quality/exceptions.yml holds. */
export function exceptionIds(
  file = path.join(REPO_ROOT, 'quality', 'exceptions.yml'),
): Set<string> {
  const data = parse(readFileSync(file, 'utf8')) as { exceptions?: { id?: unknown }[] } | null;
  return new Set(
    (data?.exceptions ?? []).flatMap((entry) => (typeof entry?.id === 'string' ? [entry.id] : [])),
  );
}

/** The repository's context: its registered surfaces' and compositions' checklists, its exceptions, and today. */
export async function repositoryManualRunContext(now = new Date()): Promise<ManualRunContext> {
  const registrations = await loadRegistrations();
  const compositions = await registeredCompositions();
  const ids = [...registrations.surfaces.map((surface) => surface.id), ...compositions];
  return {
    checklists: new Map(
      ids.map((id) => [id, checklistItems(id, registrations, compositions).map((item) => item.id)]),
    ),
    exceptionIds: exceptionIds(),
    today: now.toISOString().slice(0, 10),
  };
}
