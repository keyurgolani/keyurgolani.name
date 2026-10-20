import type { ContentExtension } from '../extensions';
import { isPlainObject } from '../json';
import { detectDocument } from '../legacy';
import { SCHEMA_VERSION } from '../portfolio';
import { findSecrets, redactedPointer, redactSecrets, secretKind } from '../secrets';
import { serialize } from '../serialize';
import { DisplayModeSchema, type AppearanceSelection } from '../site';
import {
  parsePointer,
  parseSource,
  toPointer,
  yamlComments,
  type DocumentFormat,
  type Locate,
} from '../source';
import { validatePublicationUnit, type AppearanceCatalog } from '../validate';
import { legacyStep, type LegacyStepResult } from './legacy-step';
import type { Change, Migration, Need, NeedReason, SecretSpot, SetValue } from './types';

// `@portfolio/schema/migrate`: converts old documents to this release's
// (#4, item 19). Pure: text in, documents and a report out. `pnpm
// config:migrate` is its command; the web runtime never imports it.

export type * from './types';
export { formatMigration } from './report';
export { unifiedDiff } from './diff';
export { assignSectionIds, slugify, type AssignedId, type IdSource } from './section-ids';

export interface MigrateOptions {
  /** `--set` values, applied in order after the steps run. */
  readonly set?: readonly SetValue[];
  /** Drop the keys the old schema dropped, rather than stopping on them. */
  readonly dropUnknown?: boolean;
  /** The appearance ids this build registers. Without it, ids go unchecked. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions the new documents are checked against. */
  readonly extensions?: readonly ContentExtension[];
  /**
   * The site's origin, which the new pair's links are checked against. Never
   * the old meta.url, which often names another domain. Without it, those
   * checks go in `notChecked`.
   */
  readonly origin?: string;
}

/** What a step passes on: the documents so far, and what each step found. */
interface StepState {
  readonly version: number;
  readonly legacy?: Record<string, unknown>;
  readonly result?: LegacyStepResult;
}

interface MigrationStep {
  readonly from: number;
  readonly to: number;
  run(
    state: StepState,
    context: { locate: Locate; presetIds: ReadonlyMap<number, string> },
  ): StepState;
}

/**
 * The schema changes, oldest first. The old one-file format counts as
 * version 1. A later schema change adds its step at the end.
 */
const MIGRATION_STEPS: readonly MigrationStep[] = [
  {
    from: 1,
    to: 2,
    run: (state, context) => ({ version: 2, result: legacyStep(state.legacy!, context) }),
  },
];

/** Parses `--set <path>=<value>`. The value is a string, except `true` and `false`. */
export function parseSet(argument: string): SetValue {
  const equals = argument.indexOf('=');
  const path = equals === -1 ? '' : argument.slice(0, equals);
  if (!/^(?:portfolio|site)(?:\.[^.=]+)+$/.test(path)) {
    throw new Error(
      `--set takes <portfolio|site>.<path>=<value>, such as site.appearance.colorScheme=warm.`,
    );
  }
  return { path, value: argument.slice(equals + 1) };
}

const PRESET_ID = /^portfolio\.sections\.(\d+)\.id$/;

/**
 * Migrates one old file to this release's documents. Never writes anything:
 * it returns the new documents' text and a report of every change, value it
 * needs, and key the old schema dropped. The file and options in, the same
 * bytes out, every time.
 */
export function migrate(
  source: { readonly text: string; readonly format: DocumentFormat },
  options: MigrateOptions = {},
): Migration {
  const failed = (...reasons: string[]): Migration => ({ status: 'failed', reasons });
  const parsed = parseSource(source.text, source.format);
  if (!parsed.ok) {
    return failed(
      ...parsed.problems.map(({ message, line, column }) =>
        line === undefined ? message : `Line ${line}, column ${column}: ${message}`,
      ),
    );
  }
  const type = detectDocument(parsed.data);
  if (type === 'portfolio' || type === 'site') {
    const version = (parsed.data as Record<string, unknown>).schemaVersion;
    if (version === SCHEMA_VERSION) return { status: 'current', document: type };
    // Only a number is shown: any other value could be text pasted there.
    const declared =
      typeof version === 'number' && Number.isFinite(version)
        ? `schemaVersion ${version}`
        : "a schemaVersion that isn't a number";
    const why = (what: string) =>
      `The file declares ${what}, which no migration step reads. This release writes ${SCHEMA_VERSION}.`;
    return {
      status: 'failed',
      reasons: [why(declared)],
      summary: [why('a schemaVersion')],
    };
  }
  if (type !== 'legacy') {
    return failed('The file is neither the old one-file format nor a schemaVersion 2 document.');
  }

  const sets = options.set ?? [];
  const presetIds = new Map<number, string>();
  for (const { path, value } of sets) {
    const index = PRESET_ID.exec(path)?.[1];
    if (index !== undefined) presetIds.set(Number(index), value);
  }
  let state: StepState = { version: 1, legacy: parsed.data as Record<string, unknown> };
  for (const step of MIGRATION_STEPS) {
    if (step.from === state.version) state = step.run(state, { locate: parsed.locate, presetIds });
  }
  const step = state.result!;
  const { portfolio, site } = step;

  // Each change from the old file, in the old file's order.
  const position = (pointer: string) => parsed.locate(parsePointer(pointer) ?? [], 'key') ?? {};
  const changes: Change[] = step.changes
    .map((change) => (change.from === undefined ? change : { ...change, ...position(change.from) }))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
  const setPaths = new Set<string>();
  for (const { path, value } of sets) {
    const [document, ...segments] = path.split('.') as ['portfolio' | 'site', ...string[]];
    const pointer = toPointer(
      segments.map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment)),
    );
    const preset = PRESET_ID.exec(path)?.[1];
    if (preset !== undefined) {
      // The id step already used it, on a section the file has.
      const sections = (parsed.data as Record<string, unknown>).sections;
      if (!Array.isArray(sections) || Number(preset) >= sections.length) {
        return failed(`--set ${path}: the list has no item ${preset}.`);
      }
    } else {
      const problem = setAt(document === 'portfolio' ? portfolio : site, segments, coerce(value));
      if (problem) return failed(`--set ${path}: ${problem}`);
    }
    setPaths.add(path);
    changes.push({ code: 'set', to: { document, pointer }, value, note: 'Given with --set.' });
  }
  const needs = findNeeds(site, step.reasons, options.catalog, setPaths);

  const format = source.format;
  let portfolioText: string;
  let siteText: string;
  try {
    portfolioText = serialize(portfolio, format);
    siteText = serialize(site, format);
  } catch (error) {
    return failed(`The new documents can't be written: ${(error as Error).message}`);
  }
  const extension = format === 'json' ? 'json' : 'yml';
  // The pair is checked even while values are needed, so content problems
  // show on the first run: placeholders stand in for those values, and the
  // records at their pointers are left out. Without a variant, the color
  // scheme and typography can't be checked either.
  const skipped = new Set(needs.map(({ path }) => `/${path.split('.').slice(1).join('/')}`));
  if (skipped.has('/appearance/variant')) {
    skipped.add('/appearance/colorScheme').add('/appearance/typography');
  }
  let checkedSite = siteText;
  if (needs.length > 0) {
    const stand = structuredClone(site);
    for (const need of needs) {
      const value = need.accepts?.[0] ?? PLACEHOLDERS[need.path] ?? 'placeholder';
      setAt(stand, need.path.split('.').slice(1), value);
    }
    checkedSite = serialize(stand, format);
  }
  const checked = validatePublicationUnit(
    {
      portfolio: { text: portfolioText, format, name: `portfolio.${extension}` },
      site: { text: checkedSite, format, name: `site.${extension}` },
    },
    {
      catalog: options.catalog,
      extensions: options.extensions,
      ...(options.origin ? { canonicalOrigin: options.origin } : {}),
    },
  );
  const diagnostics = checked.diagnostics.filter(
    ({ document, pointer }) => !(document === 'site' && skipped.has(pointer)),
  );

  const dropUnknown = options.dropUnknown ?? false;
  if (dropUnknown) {
    for (const { pointer } of step.unknown) {
      changes.push({
        code: 'dropped',
        from: pointer,
        note: 'The old schema dropped it when it read the file.',
      });
    }
  }
  const blocked =
    needs.length > 0 ||
    (step.unknown.length > 0 && !dropUnknown) ||
    diagnostics.some(({ severity }) => severity !== 'warning');
  return {
    status: blocked ? 'blocked' : 'ready',
    from: 1,
    to: SCHEMA_VERSION,
    format,
    portfolio: { data: portfolio, text: portfolioText },
    site: { data: site, text: siteText },
    source: source.text,
    changes,
    ids: step.ids,
    needs,
    unknown: step.unknown,
    dropUnknown,
    diagnostics,
    notChecked: checked.notChecked,
    comments: format === 'yaml' ? commentLines(source.text) : [],
    secrets: secretsIn(parsed.data, parsed.locate, source, sets),
    ...(step.origin ? { origin: step.origin } : {}),
  };
}

/** What stands in for a value still needed, where the catalog lists none, while the pair is checked. */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  'site.appearance.variant': 'placeholder',
  'site.appearance.displayMode': 'system',
  'site.motionPolicy': 'respect-os',
};

/**
 * Every place the old file holds secret-shaped text, keys the old schema
 * dropped and YAML comments included, and every `--set` value that's
 * secret-shaped. A PEM key spans lines, so redacting a line at a time would
 * still print its body: while there's any, the report withholds values.
 */
function secretsIn(
  data: unknown,
  locate: Locate,
  source: { readonly text: string; readonly format: DocumentFormat },
  sets: readonly SetValue[],
): SecretSpot[] {
  const spots: SecretSpot[] = findSecrets(data, locate).map(
    ({ path, kind, in: at, line, column }) => ({
      kind,
      in: at,
      pointer: redactedPointer(path),
      ...(line !== undefined ? { line, column } : {}),
    }),
  );
  if (source.format === 'yaml') {
    for (const { text, line, column } of yamlComments(source.text)) {
      const kind = secretKind(text);
      if (kind) spots.push({ kind, in: 'comment', line, column });
    }
  }
  for (const { path, value } of sets) {
    const kind = secretKind(value);
    if (kind) spots.push({ kind, in: 'set', path: redactSecrets(path) });
  }
  return spots;
}

function coerce(value: string): string | boolean {
  return value === 'true' ? true : value === 'false' ? false : value;
}

/**
 * Sets a value at a dotted path, making mappings on the way. It reads and
 * writes own keys only, so a path through __proto__ makes a key of that name
 * and never reaches Object.prototype. Returns what went wrong, if anything.
 */
function setAt(
  root: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): string | undefined {
  const define = (record: Record<string, unknown>, key: string, child: unknown) =>
    Object.defineProperty(record, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  let node: unknown = root;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (Array.isArray(node)) {
      const at = /^\d+$/.test(segment) ? Number(segment) : Number.NaN;
      if (!(at < node.length)) return `the list has no item ${segment}.`;
      if (last) node[at] = value;
      else node = node[at];
    } else if (isPlainObject(node)) {
      if (last) {
        define(node, segment, value);
      } else {
        if (!Object.hasOwn(node, segment) || node[segment] === undefined) define(node, segment, {});
        node = node[segment];
      }
    } else {
      return `a value is in the way at ${segment}.`;
    }
  }
  return undefined;
}

const AXES = ['variant', 'designLanguage', 'colorScheme', 'typography', 'displayMode'] as const;

/** The values the owner still has to give: missing, or not ones this build registers. */
function findNeeds(
  site: Record<string, unknown>,
  reasons: ReadonlyMap<string, NeedReason>,
  catalog: AppearanceCatalog | undefined,
  setPaths: ReadonlySet<string>,
): Need[] {
  const appearance = isPlainObject(site.appearance) ? site.appearance : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const selection = Object.fromEntries(
    AXES.map((axis) => [axis, text(appearance[axis])]),
  ) as unknown as AppearanceSelection;
  const needs: Need[] = [];
  for (const axis of AXES) {
    const path = `site.appearance.${axis}`;
    const value = appearance[axis];
    let ids: readonly string[] | null = null;
    try {
      ids = catalog?.ids(axis, selection) ?? null;
    } catch {
      ids = null;
    }
    if (!ids && axis === 'displayMode') ids = DisplayModeSchema.options;
    const accepts = ids ? { accepts: ids } : {};
    const reason = reasons.get(path);
    if (typeof value !== 'string' || value === '') {
      needs.push({
        path,
        reason: reason?.reason ?? 'It has no value.',
        ...pick(reason),
        ...accepts,
      });
    } else if (ids && !ids.includes(value)) {
      needs.push({
        path,
        reason: setPaths.has(path)
          ? "The id given isn't one this build registers."
          : "The old id isn't one this build registers.",
        was: value,
        ...accepts,
      });
    }
  }
  const motion = site.motionPolicy;
  if (motion !== 'respect-os' && motion !== 'reduce') {
    const reason = reasons.get('site.motionPolicy');
    needs.push({
      path: 'site.motionPolicy',
      reason: reason?.reason ?? "It isn't a motion policy.",
      ...pick(reason),
      accepts: ['respect-os', 'reduce'],
    });
  }
  return needs;
}

function pick(reason: NeedReason | undefined): { was?: string } {
  return reason?.was !== undefined ? { was: reason.was } : {};
}

/** The line of every comment in YAML text, in order. */
function commentLines(text: string): number[] {
  return [...new Set(yamlComments(text).map(({ line }) => line))];
}
