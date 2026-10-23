// Quality exceptions (#11, Slice 1, item 12): quality/exceptions.yml, and the
// exceptions block of #6's runtime-budgets.json, read with one zod schema and
// one set of expiry rules.
//
// An exception waives one rule of one gate for an exact scope: the fields
// that gate varies on, each named outright, never wildcarded, and no field it
// doesn't vary on (EXCEPTION_GATES lists each gate's). It says which kind of
// limit it waives, and the schema checks that claim against the rule's level:
//
//   - above-aa: a floor above WCAG AA, such as the 44px primary target;
//   - decorative: an A or AA contrast rule on decorative content, named by
//     its element's selector, since WCAG exempts decorative text and graphics;
//   - timing: a timing ceiling (vitals, idle work, memory);
//   - budget: a #6 budget limit, scoped by unit and metric, which lives in
//     runtime-budgets.json;
//   - quarantine: a flaky interaction test, for at most 14 days, owned by the
//     surface's owner.
//
// WCAG A and AA failures on essential content can't be excepted, in any
// tier: no kind waives one, and an exception names no tier. Nor can the
// floors the owner's direction holds every pack to (reduced motion, forced
// colors, and reduced transparency override every creative choice) or the
// rules that fail on any run.
//
// expires is at most 90 days after created (quality/thresholds.json), both
// compared with the run's UTC date: an expired entry fails, and so does one
// created after today. A scheduled run also fails on an exception that
// matched no failure, and warns on one within 14 days of its expiry.
//
// A confirmed axe false positive goes under falsePositives, with the rule,
// the selector, and the quality/manual-runs/ record proving the criterion
// passes. It isn't an open exception, and it lapses on an axe upgrade: it
// names the axe-core version it was confirmed under, and fails once another
// is installed.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import {
  issueLines,
  loadThresholds,
  REPO_ROOT,
  type Thresholds,
} from '../../../quality/thresholds';
import { ID, INPUT_MODES, PREFERENCE_MODES, TUPLE, VIEWPORT } from './vocabulary';

export const EXCEPTIONS_FILE = path.join(REPO_ROOT, 'quality', 'exceptions.yml');
export const BUDGETS_FILE = path.join(REPO_ROOT, 'runtime-budgets.json');
export const MANUAL_RUNS_DIR = path.join(REPO_ROOT, 'quality', 'manual-runs');
export const SURFACES_DIR = path.join(REPO_ROOT, 'quality', 'surfaces');

/** What kind of limit an exception waives. */
export const EXCEPTION_KINDS = [
  'above-aa',
  'decorative',
  'timing',
  'budget',
  'quarantine',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/**
 * How a rule's failures may be excepted. A and AA: never, but as decorative
 * content where the gate allows it. floor: never. above-aa, ceiling, and
 * budget: by the kind of the same name (timing for a ceiling).
 */
export type RuleLevel = 'A' | 'AA' | 'floor' | 'above-aa' | 'ceiling' | 'budget';

/** The fields a scope may name. */
export const SCOPE_FIELDS = [
  'surface',
  'route',
  'tuple',
  'viewport',
  'inputMode',
  'preferenceMode',
  'unit',
  'metric',
] as const;
export type ScopeField = (typeof SCOPE_FIELDS)[number];

export interface ExceptionGate {
  readonly description: string;
  /** The fields the gate varies on: an exception's scope names each, and no other. */
  readonly scope: readonly ScopeField[];
  /** Each rule's level, or one level for every rule a tool such as axe names. */
  readonly rules:
    Readonly<Record<string, RuleLevel>> | { readonly pattern: RegExp; readonly level: RuleLevel };
  /** The A and AA rules whose WCAG criterion exempts decorative content. */
  readonly decorative?: readonly string[];
  /** It runs interaction tests, which retry once and can flake, so one may be quarantined. */
  readonly interactions?: boolean;
}

const CELL = ['surface', 'route', 'tuple', 'viewport'] as const satisfies readonly ScopeField[];

/**
 * The quality gates an exception may name, from the refined body's slices
 * 1 to 3, with the rules each reports. A slice that adds or renames a
 * gate's rules updates its row: a rule no row lists can't be excepted.
 */
export const EXCEPTION_GATES = {
  axe: {
    description: "axe-core's WCAG A and AA rules, at quality/thresholds.json's tags (Slice 1).",
    scope: [...CELL, 'preferenceMode'],
    rules: { pattern: /^[a-z][a-z0-9-]*$/, level: 'AA' },
    decorative: ['color-contrast'],
  },
  contrast: {
    description:
      "Rendered contrast, axe's incomplete results resampled with the glyphs hidden (Slice 2).",
    scope: [...CELL, 'preferenceMode'],
    rules: {
      text: 'AA',
      'large-text': 'AA',
      'non-text': 'AA',
      'high-contrast-text': 'above-aa',
      'high-contrast-large-text': 'above-aa',
      'high-contrast-non-text': 'above-aa',
      print: 'above-aa',
    },
    decorative: ['text', 'large-text', 'non-text'],
  },
  focus: {
    description:
      'Focus visible, in default and forced colors: the change, its contrast, and its perimeter (Slice 2).',
    scope: [...CELL, 'preferenceMode'],
    rules: { visible: 'AA', contrast: 'AA', perimeter: 'above-aa' },
  },
  keyboard: {
    description: 'Reachability, traps, Escape, focus return, and route focus (Slice 2).',
    scope: [...CELL, 'preferenceMode'],
    rules: {
      reachable: 'A',
      trap: 'A',
      escape: 'A',
      'focus-return': 'A',
      'route-focus': 'A',
      'hidden-focusable': 'A',
    },
    interactions: true,
  },
  occlusion: {
    description:
      'A focused element hit at its center, and the closed visitor control over nothing (Slice 2).',
    scope: [...CELL, 'preferenceMode'],
    rules: { obscured: 'AA', 'visitor-control': 'AA' },
  },
  targets: {
    description:
      "Target sizes by hit-testing: 2.5.8's minimum, and the narrow and primary floors above it (Slice 1's thresholds).",
    scope: [...CELL, 'inputMode'],
    rules: { minimum: 'AA', narrow: 'above-aa', primary: 'above-aa' },
  },
  reflow: {
    description:
      'Content and controls inside their clipping ancestor at 320px, 200% zoom, 200% root text, and the 1.4.12 override (Slice 2).',
    scope: [...CELL, 'preferenceMode'],
    rules: { reflow: 'AA', zoom: 'AA', 'root-text': 'AA', 'text-spacing': 'AA' },
  },
  inventory: {
    description:
      'Every authored field survives each condition, and no visible button outside a form without JavaScript (Slice 2).',
    scope: [...CELL, 'preferenceMode'],
    rules: { content: 'A', 'button-without-form': 'A' },
  },
  hover: {
    description:
      'What hover reveals, focus or tap reveals too, and nothing lives in title alone (Slice 2).',
    scope: [...CELL, 'inputMode'],
    rules: { parity: 'AA', 'title-only': 'A' },
    interactions: true,
  },
  structure: {
    description:
      'The skip link and landmarks, one main, the h1 first, no duplicate id (2.4.1), and lang (3.1.1, 3.1.2).',
    scope: [...CELL],
    rules: {
      'skip-link': 'A',
      landmarks: 'A',
      'one-main': 'A',
      'h1-first': 'A',
      'duplicate-id': 'A',
      lang: 'A',
      'lang-parts': 'AA',
    },
  },
  drag: {
    description: 'Every registered drag has a keyboard or single-pointer path (2.5.7).',
    scope: [...CELL, 'inputMode'],
    rules: { alternative: 'AA' },
    interactions: true,
  },
  status: {
    description: 'A live region announces a change and focus stays put (4.1.3).',
    scope: [...CELL],
    rules: { 'live-region': 'AA' },
    interactions: true,
  },
  authentication: {
    description:
      'Paste and password managers work, and re-entered data is prefilled (3.3.7, 3.3.8).',
    scope: [...CELL],
    rules: { paste: 'AA', 'password-manager': 'AA', 'redundant-entry': 'A' },
    interactions: true,
  },
  motion: {
    description:
      "Reduced motion from first paint, with and without JavaScript, and the compiled-CSS kill-switch audit (Slice 2). The owner's direction holds every pack to it.",
    scope: [...CELL, 'preferenceMode'],
    rules: {
      animation: 'floor',
      'frame-loop': 'floor',
      'kill-switch': 'floor',
      'os-wins': 'floor',
    },
  },
  enhancement: {
    description:
      'Semantic HTML and navigation with the enhancement chunks, canvas contexts, and fonts taken away (Slice 2).',
    scope: [...CELL],
    rules: { semantics: 'A', navigation: 'A' },
  },
  vitals: {
    description:
      'Lab vitals on the median of the runs, and the canvas-led LCP element, which fails on any run (Slice 3).',
    scope: [...CELL],
    rules: {
      lcp: 'ceiling',
      cls: 'ceiling',
      tbt: 'ceiling',
      'lcp-element': 'floor',
      'lcp-missing': 'floor',
    },
  },
  idle: {
    description:
      'Idle TaskDuration, and LayoutCount growth in static mode, which fails on any run (Slice 3).',
    scope: [...CELL],
    rules: { 'task-duration': 'ceiling', 'layout-count': 'floor' },
  },
  memory: {
    description: 'JSHeapUsedSize at 10s, and its growth from 5s to 15s (Slice 3).',
    scope: [...CELL],
    rules: { heap: 'ceiling', growth: 'ceiling' },
  },
  budget: {
    description:
      "#6's runtime budgets: a unit's metric over its limit. These live in runtime-budgets.json's exceptions block.",
    scope: ['unit', 'metric'],
    rules: { limit: 'budget' },
  },
} as const satisfies Record<string, ExceptionGate>;
export type ExceptionGateId = keyof typeof EXCEPTION_GATES;

const GATES: Readonly<Record<string, ExceptionGate>> = EXCEPTION_GATES;

/** A rule's level in `gate`, or undefined when the gate has no such rule. */
export function ruleLevel(gate: string, rule: string): RuleLevel | undefined {
  const row = GATES[gate];
  if (!row) return undefined;
  if ('pattern' in row.rules) {
    const { pattern, level } = row.rules as { pattern: RegExp; level: RuleLevel };
    return pattern.test(rule) ? level : undefined;
  }
  return (row.rules as Readonly<Record<string, RuleLevel>>)[rule];
}

/** A value that names more than one thing: a glob or pattern, or a word for every. */
const WILDCARD = /[*?[\]{}|^$+()\\]/;
const WILDCARD_WORDS = new Set(['all', 'any', 'every', 'each', 'none', '-', '.']);
/** A selector's universal selector, or a word for every. */
const isWildcardSelector = (value: string) =>
  value.includes('*') || WILDCARD_WORDS.has(value.trim().toLowerCase());
export function isWildcard(value: string): boolean {
  return WILDCARD.test(value) || WILDCARD_WORDS.has(value.trim().toLowerCase());
}

/** Each scope field's grammar, after the wildcard check. */
const SCOPE_GRAMMAR: Readonly<
  Record<ScopeField, { readonly test: (value: string) => boolean; readonly expected: string }>
> = {
  surface: {
    test: (value) => ID.test(value),
    expected: 'a surface or composition id, such as fallback',
  },
  route: {
    test: (value) => /^\/(?:[A-Za-z0-9._~%-]+\/?)*$/.test(value) && !value.includes('//'),
    expected: 'a route path, such as / or /studio/login',
  },
  tuple: {
    test: (value) => TUPLE.test(value),
    expected:
      'designLanguage/colorScheme/typography/displayMode, such as platform-neutral/warm-parchment/humanist-ui/light',
  },
  viewport: { test: (value) => VIEWPORT.test(value), expected: 'WIDTHxHEIGHT, such as 1440x900' },
  inputMode: {
    test: (value) => (INPUT_MODES as readonly string[]).includes(value),
    expected: INPUT_MODES.join(', '),
  },
  preferenceMode: {
    test: (value) => (PREFERENCE_MODES as readonly string[]).includes(value),
    expected: PREFERENCE_MODES.join(', '),
  },
  unit: { test: (value) => ID.test(value), expected: 'a #6 unit id, such as fallback' },
  metric: {
    test: (value) => /^[a-z][a-zA-Z0-9-]{0,63}$/.test(value),
    expected: 'a #6 metric name, such as jsBytes',
  },
};

const IsoDate = z.string().refine(
  (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  },
  { message: 'must be a date written YYYY-MM-DD, such as 2026-10-22.' },
);
const Text = z.string().trim().min(1, 'must not be empty.').max(1000);
const Id = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{2,63}$/,
    'must be 3 to 64 lowercase letters, digits, or hyphens, starting with a letter.',
  );

const ScopeSchema = z
  .object(
    Object.fromEntries(SCOPE_FIELDS.map((field) => [field, z.string().optional()])) as Record<
      ScopeField,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict();

const ExceptionShape = z
  .object({
    id: Id,
    kind: z.enum(EXCEPTION_KINDS),
    gate: z.string(),
    rule: z.string().min(1, 'must not be empty.'),
    owner: z
      .string()
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'must be a GitHub login, such as keyurgolani.'),
    rationale: Text,
    affectedUsers: Text,
    fallback: Text,
    trackingIssue: z
      .string()
      .regex(
        /^(?:#[1-9]\d*|https:\/\/github\.com\/keyurgolani\/keyurgolani\.name\/issues\/[1-9]\d*)$/,
        'must be an issue of this repository, such as #11.',
      ),
    created: IsoDate,
    expires: IsoDate,
    /** The element a decorative exception waives, by selector. */
    selector: z.string().min(1).max(300).optional(),
    scope: ScopeSchema,
  })
  .strict();
export type QualityException = z.infer<typeof ExceptionShape>;

const FalsePositiveShape = z
  .object({
    id: Id,
    /** The axe rule, such as color-contrast. */
    rule: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be an axe rule id, such as color-contrast.'),
    selector: z.string().min(1).max(300),
    /** The quality/manual-runs/ record proving the criterion passes, by its file's name. */
    manualRun: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{2,63}$/,
        'must be a quality/manual-runs/ record id, such as 2026-10-20-login-voiceover.',
      ),
    /** The axe-core version the false positive was confirmed under. */
    axe: z
      .string()
      .regex(
        /^\d+\.\d+\.\d+$/,
        'must be the axe-core version it was confirmed under, such as 4.11.0.',
      ),
  })
  .strict();
export type FalsePositive = z.infer<typeof FalsePositiveShape>;

/** Where an entry sits: quality/exceptions.yml, or runtime-budgets.json's exceptions block. */
export type ExceptionSource = 'quality' | 'budgets';

/** What the rules compare an entry against: the run, and what the repository holds. */
export interface ExceptionContext {
  /** The run's UTC date, YYYY-MM-DD. */
  readonly today: string;
  readonly thresholds: Thresholds;
  /** A scheduled run fails on an exception that matched nothing, and warns before one expires. */
  readonly mode: 'pr' | 'scheduled';
  /** The exception ids the scheduled run's failures matched. */
  readonly matched?: ReadonlySet<string>;
  /** The installed axe-core version, or null when none is installed. */
  readonly axeVersion: string | null;
  /** The ids of the records in quality/manual-runs/. */
  readonly manualRuns: ReadonlySet<string>;
  /** Each registered surface's owner, from quality/surfaces/. */
  readonly surfaceOwners: ReadonlyMap<string, string>;
}

const DAY = 24 * 60 * 60 * 1000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** The schema an entry in `source` must pass, under `context`'s run. */
export function exceptionSchema(source: ExceptionSource, context: ExceptionContext) {
  const { today, thresholds } = context;
  const { maxDays, quarantineMaxDays } = thresholds.exceptions;
  return ExceptionShape.superRefine((entry, ctx) => {
    const fail = (pathTo: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: pathTo, message });
    const gate = GATES[entry.gate];

    // The gate, the rule, and the kind.
    if (!gate) {
      fail(['gate'], `names no gate: it must be one of ${Object.keys(GATES).join(', ')}.`);
    } else if (entry.kind === 'quarantine') {
      if (!gate.interactions) {
        fail(
          ['kind'],
          `${entry.gate} runs no interaction tests, and its assertions never retry, so nothing of it flakes to quarantine.`,
        );
      }
      if (!/^[a-z][a-z0-9-]*$/.test(entry.rule) || isWildcard(entry.rule)) {
        fail(['rule'], 'must be the id of the flaky interaction test, such as dialog-escape.');
      }
    } else if (isWildcard(entry.rule)) {
      fail(['rule'], `is a wildcard. Name the one ${entry.gate} rule the exception waives.`);
    } else {
      const level = ruleLevel(entry.gate, entry.rule);
      if (!level) {
        fail(['rule'], `isn't a rule of ${entry.gate}, so it can't be excepted.`);
      } else if (entry.kind === 'decorative') {
        if (level !== 'A' && level !== 'AA') {
          fail(
            ['kind'],
            `${entry.gate} ${entry.rule} is no A or AA rule, so decorative doesn't apply: use the kind its level takes.`,
          );
        } else if (!(gate.decorative ?? []).includes(entry.rule)) {
          fail(
            ['kind'],
            `${entry.gate} ${entry.rule} is WCAG ${level}, and it exempts no decorative content: a WCAG A or AA failure on essential content can't be excepted, in any tier.`,
          );
        }
        if (!entry.selector)
          fail(['selector'], 'a decorative exception names the element it waives, by selector.');
      } else if (level === 'A' || level === 'AA') {
        fail(
          ['kind'],
          `${entry.gate} ${entry.rule} is WCAG ${level}: a WCAG A or AA failure on essential content can't be excepted, in any tier. This exception is non-waivable.`,
        );
      } else if (level === 'floor') {
        fail(
          ['kind'],
          `${entry.gate} ${entry.rule} is a floor every pack is held to, in every tier, so it can't be excepted. This exception is non-waivable.`,
        );
      } else {
        const takes: Record<'above-aa' | 'ceiling' | 'budget', readonly [ExceptionKind, string]> = {
          'above-aa': ['above-aa', 'a floor above AA'],
          ceiling: ['timing', 'a timing ceiling'],
          budget: ['budget', 'a #6 budget limit'],
        };
        const [kind, what] = takes[level];
        if (kind !== entry.kind) {
          fail(['kind'], `${entry.gate} ${entry.rule} is ${what}, so its kind is ${kind}.`);
        }
      }
    }
    if (entry.selector !== undefined && isWildcardSelector(entry.selector)) {
      fail(['selector'], 'is a wildcard. Name the one element the exception waives.');
    }
    if (entry.selector !== undefined && entry.kind !== 'decorative') {
      fail(
        ['selector'],
        'only a decorative exception names a selector: the others waive a rule across their scope.',
      );
    }

    // Where it lives.
    if (source === 'quality' && entry.gate === 'budget') {
      fail(
        ['gate'],
        "a budget exception lives in runtime-budgets.json's exceptions block, with #6's budgets.",
      );
    }
    if (source === 'budgets' && entry.gate !== 'budget') {
      fail(
        ['gate'],
        "runtime-budgets.json's exceptions block holds budget exceptions alone; quality/exceptions.yml holds the rest.",
      );
    }

    // The scope: each field the gate varies on, named outright, and no other.
    if (gate) {
      for (const field of SCOPE_FIELDS) {
        const value = entry.scope[field];
        const wanted = gate.scope.includes(field);
        if (value === undefined) {
          if (wanted)
            fail(
              ['scope', field],
              `is missing: ${entry.gate} varies on ${field}, so the scope names it.`,
            );
          continue;
        }
        if (!wanted) {
          fail(['scope', field], `${entry.gate} doesn't vary on ${field}, so the scope omits it.`);
        } else if (isWildcard(value)) {
          fail(
            ['scope', field],
            `is a wildcard. Name the exact ${field}: a scope is never wildcarded.`,
          );
        } else if (!SCOPE_GRAMMAR[field].test(value)) {
          fail(['scope', field], `must be ${SCOPE_GRAMMAR[field].expected}.`);
        }
      }
    }

    // Dates, against the run's UTC date.
    if (IsoDate.safeParse(entry.created).success && IsoDate.safeParse(entry.expires).success) {
      const span = days(entry.created, entry.expires);
      const cap = entry.kind === 'quarantine' ? quarantineMaxDays : maxDays;
      if (entry.created > today) fail(['created'], `is after the run's UTC date, ${today}.`);
      if (span <= 0) fail(['expires'], 'must be after created.');
      else if (span > cap) {
        fail(
          ['expires'],
          entry.kind === 'quarantine'
            ? `is ${span} days after created, more than the ${cap} days a flake quarantine may run.`
            : `is ${span} days after created, more than the ${cap} days an exception may run.`,
        );
      }
      if (entry.expires <= today) {
        fail(
          ['expires'],
          `expired on ${entry.expires}, on or before the run's UTC date, ${today}. Fix the failure, or renew the exception with a new created date.`,
        );
      }
    }

    // A quarantine is owned by the surface's owner.
    if (entry.kind === 'quarantine' && entry.scope.surface !== undefined) {
      const owner = context.surfaceOwners.get(entry.scope.surface);
      if (owner === undefined) {
        fail(
          ['owner'],
          `a quarantine is owned by its surface's owner, and ${entry.scope.surface} registers none in quality/surfaces/.`,
        );
      } else if (owner.toLowerCase() !== entry.owner.toLowerCase()) {
        fail(
          ['owner'],
          `a quarantine is owned by its surface's owner, ${owner}, not ${entry.owner}.`,
        );
      }
    }

    // A scheduled run fails on one that matched nothing.
    if (context.mode === 'scheduled' && !(context.matched ?? new Set()).has(entry.id)) {
      fail(['id'], 'matched no failure in this scheduled run, so it waives nothing: remove it.');
    }
  });
}

/** The schema a false positive must pass. */
export function falsePositiveSchema(context: ExceptionContext) {
  return FalsePositiveShape.superRefine((entry, ctx) => {
    const fail = (pathTo: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path: pathTo, message });
    if (isWildcardSelector(entry.selector)) {
      fail(['selector'], 'is a wildcard. Name the one element axe misreads.');
    }
    if (!context.manualRuns.has(entry.manualRun)) {
      fail(
        ['manualRun'],
        `names no record in quality/manual-runs/: a false positive needs the manual run that proves the criterion passes.`,
      );
    }
    if (context.axeVersion === null) {
      fail(
        ['axe'],
        `was confirmed under axe-core ${entry.axe}, and no axe-core is installed to hold it to.`,
      );
    } else if (context.axeVersion !== entry.axe) {
      fail(
        ['axe'],
        `was confirmed under axe-core ${entry.axe}, and ${context.axeVersion} is installed: a false positive lapses on an axe upgrade. Confirm it again under ${context.axeVersion}.`,
      );
    }
  });
}

/** One problem with one file. */
export interface ExceptionProblem {
  readonly file: string;
  /** The entry's id, when the problem is one entry's. */
  readonly id?: string;
  readonly message: string;
}

export interface ExceptionsResult {
  readonly exceptions: readonly (QualityException & { readonly source: ExceptionSource })[];
  readonly falsePositives: readonly FalsePositive[];
  readonly problems: readonly ExceptionProblem[];
  /** A scheduled run's warnings: exceptions within warnDays of their expiry. */
  readonly warnings: readonly ExceptionProblem[];
}

const QualityFileShape = z
  .object({
    version: z.literal(1),
    exceptions: z.array(z.unknown()),
    falsePositives: z.array(z.unknown()),
  })
  .strict();

/** The inputs to validate: quality/exceptions.yml's text, and runtime-budgets.json's. */
export interface ExceptionInputs {
  readonly quality: { readonly file: string; readonly text: string };
  readonly budgets: { readonly file: string; readonly text: string };
}

const shown = (file: string) => path.relative(REPO_ROOT, file) || file;

/** Each entry of `entries` through `schema`, with its problems named by file and id. */
function check<T>(
  entries: readonly unknown[],
  schema: z.ZodType<T>,
  file: string,
  where: string,
  problems: ExceptionProblem[],
): T[] {
  const valid: T[] = [];
  entries.forEach((entry, index) => {
    const id =
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : undefined;
    const parsed = schema.safeParse(entry);
    if (parsed.success) valid.push(parsed.data);
    else {
      for (const line of issueLines(parsed.error)) {
        problems.push({
          file,
          ...(id ? { id } : {}),
          message: `${where}[${index}]${id ? ` (${id})` : ''} ${line}`,
        });
      }
    }
  });
  return valid;
}

/**
 * Validates quality/exceptions.yml and runtime-budgets.json's exceptions
 * block, as `inputs` holds them, under `context`'s run. An absent block holds
 * no exceptions. Every problem is returned, never thrown.
 */
export function validateExceptions(
  inputs: ExceptionInputs,
  context: ExceptionContext,
): ExceptionsResult {
  const problems: ExceptionProblem[] = [];
  const warnings: ExceptionProblem[] = [];
  const exceptions: (QualityException & { source: ExceptionSource })[] = [];
  let falsePositives: FalsePositive[] = [];

  // quality/exceptions.yml
  const qualityFile = shown(inputs.quality.file);
  const document = parseDocument(inputs.quality.text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      problems.push({
        file: qualityFile,
        message: `isn't valid YAML: ${error.message.split('\n')[0]}`,
      });
    }
  } else {
    const shape = QualityFileShape.safeParse(document.toJS());
    if (!shape.success) {
      for (const line of issueLines(shape.error))
        problems.push({ file: qualityFile, message: line });
    } else {
      for (const entry of check(
        shape.data.exceptions,
        exceptionSchema('quality', context),
        qualityFile,
        'exceptions',
        problems,
      )) {
        exceptions.push({ ...entry, source: 'quality' });
      }
      falsePositives = check(
        shape.data.falsePositives,
        falsePositiveSchema(context),
        qualityFile,
        'falsePositives',
        problems,
      );
    }
  }

  // runtime-budgets.json's exceptions block
  const budgetsFile = shown(inputs.budgets.file);
  let budgets: unknown;
  try {
    budgets = JSON.parse(inputs.budgets.text);
  } catch (error) {
    problems.push({ file: budgetsFile, message: `isn't valid JSON: ${(error as Error).message}` });
  }
  if (budgets !== undefined) {
    const block =
      typeof budgets === 'object' && budgets !== null
        ? (budgets as { exceptions?: unknown }).exceptions
        : undefined;
    if (block !== undefined && !Array.isArray(block)) {
      problems.push({
        file: budgetsFile,
        message: 'exceptions must be a list of budget exceptions.',
      });
    } else if (Array.isArray(block)) {
      for (const entry of check(
        block,
        exceptionSchema('budgets', context),
        budgetsFile,
        'exceptions',
        problems,
      )) {
        exceptions.push({ ...entry, source: 'budgets' });
      }
    }
  }

  // Ids are unique across both files.
  const seen = new Map<string, string>();
  for (const { id, file } of [
    ...exceptions.map((entry) => ({
      id: entry.id,
      file: entry.source === 'quality' ? qualityFile : budgetsFile,
    })),
    ...falsePositives.map((entry) => ({ id: entry.id, file: qualityFile })),
  ]) {
    const first = seen.get(id);
    if (first !== undefined)
      problems.push({ file, id, message: `${id} is already an entry's id in ${first}.` });
    else seen.set(id, file);
  }

  // A scheduled run warns before an exception expires.
  if (context.mode === 'scheduled') {
    const { warnDays } = context.thresholds.exceptions;
    for (const entry of exceptions) {
      const left = days(context.today, entry.expires);
      if (left > 0 && left <= warnDays) {
        warnings.push({
          file: entry.source === 'quality' ? qualityFile : budgetsFile,
          id: entry.id,
          message: `${entry.id} expires on ${entry.expires}, in ${left} day${left === 1 ? '' : 's'}.`,
        });
      }
    }
  }

  const failed = new Set(problems.flatMap(({ id }) => (id ? [id] : [])));
  return {
    exceptions: exceptions.filter(({ id }) => !failed.has(id)),
    falsePositives: falsePositives.filter(({ id }) => !failed.has(id)),
    problems,
    warnings,
  };
}

/** What a failure is, for matching it to an exception: its gate, rule, and cell. */
export interface ExceptionTarget {
  readonly gate: string;
  readonly rule: string;
  readonly surface?: string;
  readonly route?: string;
  readonly tuple?: string;
  readonly viewport?: string;
  readonly inputMode?: string;
  readonly preferenceMode?: string;
  readonly unit?: string;
  readonly metric?: string;
  /** The failing element's selector, which a decorative exception names. */
  readonly selector?: string;
}

/**
 * The exception among `exceptions` that waives `target`, or undefined: the
 * same gate and rule, every field its scope names equal to the target's, and
 * for a decorative one, the same element. Pass only what validateExceptions()
 * returned, which holds no failing entry.
 */
export function exceptionFor(
  target: ExceptionTarget,
  exceptions: readonly QualityException[],
): QualityException | undefined {
  return exceptions.find(
    (entry) =>
      entry.kind !== 'quarantine' &&
      entry.gate === target.gate &&
      entry.rule === target.rule &&
      SCOPE_FIELDS.every(
        (field) => entry.scope[field] === undefined || entry.scope[field] === target[field],
      ) &&
      (entry.kind !== 'decorative' || entry.selector === target.selector),
  );
}

/**
 * The quarantine among `exceptions` that covers the flaky interaction test
 * `target` names, its rule being the test's id, or undefined: the same gate
 * and test, and every field its scope names equal to the target's.
 */
export function quarantineFor(
  target: ExceptionTarget,
  exceptions: readonly QualityException[],
): QualityException | undefined {
  return exceptions.find(
    (entry) =>
      entry.kind === 'quarantine' &&
      entry.gate === target.gate &&
      entry.rule === target.rule &&
      SCOPE_FIELDS.every(
        (field) => entry.scope[field] === undefined || entry.scope[field] === target[field],
      ),
  );
}

/** The false positive among `falsePositives` for an axe rule on the element `selector` names, or undefined. */
export function falsePositiveFor(
  target: { readonly rule: string; readonly selector: string },
  falsePositives: readonly FalsePositive[],
): FalsePositive | undefined {
  return falsePositives.find(
    (entry) => entry.rule === target.rule && entry.selector === target.selector,
  );
}

/** The installed axe-core's version, through @axe-core/playwright, or null when it isn't installed. */
export function installedAxeVersion(): string | null {
  const require = createRequire(path.join(REPO_ROOT, 'package.json'));
  try {
    const playwright = require.resolve('@axe-core/playwright');
    return (createRequire(playwright)('axe-core/package.json') as { version: string }).version;
  } catch {
    return null;
  }
}

/** The ids of the records in quality/manual-runs/: each .yml or .yaml file's name. */
export function manualRunIds(dir: string = MANUAL_RUNS_DIR): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(dir)
        .filter((name) => /\.ya?ml$/.test(name))
        .map((name) => name.replace(/\.ya?ml$/, '')),
    );
  } catch {
    return new Set();
  }
}

/** Each registered surface's owner: the id and owner every quality/surfaces/<id>.ts exports. */
export async function surfaceOwners(dir: string = SURFACES_DIR): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  let names: string[];
  try {
    names = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .sort();
  } catch {
    return owners;
  }
  for (const name of names) {
    const surface = (await import(pathToFileURL(path.join(dir, name)).href)) as {
      id?: unknown;
      owner?: unknown;
    };
    if (typeof surface.id === 'string' && typeof surface.owner === 'string')
      owners.set(surface.id, surface.owner);
  }
  return owners;
}

/** The run's UTC date, YYYY-MM-DD. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The context the repository gives a run on `today`: thresholds, axe-core, manual runs, and surfaces. */
export async function repositoryContext(
  options: {
    readonly today?: string;
    readonly mode?: 'pr' | 'scheduled';
    readonly matched?: ReadonlySet<string>;
  } = {},
): Promise<ExceptionContext> {
  return {
    today: options.today ?? utcToday(),
    thresholds: loadThresholds(),
    mode: options.mode ?? 'pr',
    ...(options.matched ? { matched: options.matched } : {}),
    axeVersion: installedAxeVersion(),
    manualRuns: manualRunIds(),
    surfaceOwners: await surfaceOwners(),
  };
}

/** The repository's two files, as validateExceptions() takes them. */
export function repositoryInputs(
  quality: string = EXCEPTIONS_FILE,
  budgets: string = BUDGETS_FILE,
): ExceptionInputs {
  return {
    quality: { file: quality, text: fs.readFileSync(quality, 'utf8') },
    budgets: { file: budgets, text: fs.readFileSync(budgets, 'utf8') },
  };
}
