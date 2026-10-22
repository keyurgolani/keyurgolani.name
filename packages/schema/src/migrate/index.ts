import { applyEdits } from '../edit';
import type { ContentExtension } from '../extensions';
import { isPlainObject } from '../json';
import { detectDocument, SITE_DEFAULTS } from '../legacy';
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
import { validatePublicationUnit, type AppearanceCatalog, type Diagnostic } from '../validate';
import { PORTFOLIO_SCHEMA_VERSION, SITE_SCHEMA_VERSION } from '../versions';
import { legacyStep } from './legacy-step';
import type {
  Change,
  Migration,
  MintedId,
  Need,
  NeedReason,
  SecretSpot,
  SetValue,
  StoredDocument,
  StoredUnit,
  UnitMigration,
} from './types';
import { V2_SCHEMA_VERSION } from './v2/schema';
import { v3Step, type V3StepResult } from './v3-step';

// `@portfolio/schema/migrate`: converts old documents to this release's
// (#4, item 19; #10, item 6). Pure: text in, documents and a report out.
// `pnpm config:migrate` and #3's `migrate-store` are its commands; the web
// runtime never imports it. The steps, oldest first: the one-file format
// (version 1) to the version 2 pair, then the version 2 portfolio to 3. The
// site document stays at 2.

export type * from './types';
export { SCHEMA_VERSIONS } from '../versions';
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
  /**
   * For a version 2 portfolio document, its site document: the sections it
   * hides stay out of what visible sections show, and the new pair is
   * checked with it. Without it, every section counts as visible.
   */
  readonly site?: StoredDocument;
}

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

type Rec = Record<string, unknown>;

/** The ids of the sections a site document's data hides. */
function hiddenSections(site: unknown): Set<string> {
  const sections = isPlainObject(site) && isPlainObject(site.sections) ? site.sections : {};
  return new Set(
    Object.entries(sections)
      .filter(([, settings]) => isPlainObject(settings) && settings.hidden === true)
      .map(([id]) => id),
  );
}

/**
 * The site document without the entries of the sections the 2-to-3 step
 * dropped, each reported: for the old format, whose site document the
 * migration writes.
 */
function withoutDropped(site: Rec, dropped: V3StepResult['dropped'], changes: Change[]): Rec {
  if (!isPlainObject(site.sections)) return site;
  const sections: Rec = { ...site.sections };
  for (const { id, index } of dropped) {
    if (!Object.hasOwn(sections, id)) continue;
    delete sections[id];
    changes.push({
      code: 'removed',
      from: `/sections/${index}/hidden`,
      note: "Its section goes, so the site document doesn't hide it.",
    });
  }
  const { sections: _sections, ...rest } = site;
  return Object.keys(sections).length > 0 ? { ...rest, sections } : rest;
}

/**
 * For a site document the migration keeps as it is: each dropped section it
 * still names, reported, since its entry there now names nothing.
 */
function droppedNamed(site: unknown, dropped: V3StepResult['dropped'], changes: Change[]): void {
  const sections = isPlainObject(site) && isPlainObject(site.sections) ? site.sections : {};
  for (const { id, index } of dropped) {
    if (!Object.hasOwn(sections, id)) continue;
    changes.push({
      code: 'warned',
      from: `/sections/${index}`,
      note: "The site document's sections still name it: remove that entry, since its id is gone.",
    });
  }
}

/** What a version says, without the value itself when it isn't a number. */
function declared(version: unknown): string {
  return typeof version === 'number' && Number.isFinite(version)
    ? `schemaVersion ${version}`
    : "a schemaVersion that isn't a number";
}

/**
 * Migrates one file to this release's documents: the old one-file format to
 * a version 3 portfolio and a version 2 site document, or a version 2
 * portfolio document to version 3. Never writes anything: it returns the new
 * documents' text and a report of every change, value it needs, and key the
 * old schema dropped. The file and options in, the same bytes out, every
 * time, and a second run on the output answers `current`.
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
    const version = (parsed.data as Rec).schemaVersion;
    const current = type === 'portfolio' ? PORTFOLIO_SCHEMA_VERSION : SITE_SCHEMA_VERSION;
    if (version === current) return { status: 'current', document: type };
    if (type === 'portfolio' && version === V2_SCHEMA_VERSION) {
      return migrateV2Portfolio(source, parsed.data as Rec, parsed.locate, options);
    }
    const why = (what: string) =>
      `The file declares ${what}, which no migration step reads. This release writes ${type} documents at schemaVersion ${current}.`;
    return {
      status: 'failed',
      reasons: [why(declared(version))],
      summary: [why('a schemaVersion')],
    };
  }
  if (type !== 'legacy') {
    return failed(
      'The file is neither the old one-file format, a schemaVersion 2 portfolio document, nor a document this release reads.',
    );
  }
  return migrateLegacy(source, parsed.data as Rec, parsed.locate, options);
}

/** The old one-file format, through both steps. */
function migrateLegacy(
  source: { readonly text: string; readonly format: DocumentFormat },
  legacy: Rec,
  locate: Locate,
  options: MigrateOptions,
): Migration {
  const failed = (...reasons: string[]): Migration => ({ status: 'failed', reasons });
  const sets = options.set ?? [];
  const presetIds = new Map<number, string>();
  for (const { path, value } of sets) {
    const index = PRESET_ID.exec(path)?.[1];
    if (index !== undefined) presetIds.set(Number(index), value);
  }
  const first = legacyStep(legacy, { locate, presetIds });
  const second = v3Step(first.portfolio, { hidden: hiddenSections(first.site) });
  const portfolio = second.portfolio;
  const changes: Change[] = [...first.changes, ...second.changes];
  const site = withoutDropped(first.site, second.dropped, changes);
  const setPaths = new Set<string>();
  for (const { path, value } of sets) {
    const [document, ...segments] = path.split('.') as ['portfolio' | 'site', ...string[]];
    const preset = PRESET_ID.exec(path)?.[1];
    if (preset !== undefined) {
      // The id step already used it, on a section the file has.
      const sections = legacy.sections;
      if (!Array.isArray(sections) || Number(preset) >= sections.length) {
        return failed(`--set ${path}: the list has no item ${preset}.`);
      }
    } else {
      const problem = setAt(document === 'portfolio' ? portfolio : site, segments, coerce(value));
      if (problem) return failed(`--set ${path}: ${problem}`);
    }
    setPaths.add(path);
    changes.push({
      code: 'set',
      to: { document, pointer: pointerOf(segments) },
      value,
      note: 'Given with --set.',
    });
  }
  const needs = [
    ...findNeeds(site, first.reasons, options.catalog, setPaths),
    ...portfolioNeeds(second.needs, portfolio),
  ];

  const format = source.format;
  let portfolioText: string;
  let siteText: string;
  try {
    portfolioText = serialize(portfolio, format);
    siteText = serialize(site, format);
  } catch (error) {
    return failed(`The new documents can't be written: ${(error as Error).message}`);
  }
  const { diagnostics, notChecked } = checkNew(portfolio, site, format, needs, options);

  const dropUnknown = options.dropUnknown ?? false;
  if (dropUnknown) {
    for (const { pointer } of first.unknown) {
      changes.push({
        code: 'dropped',
        from: pointer,
        note: 'The old schema dropped it when it read the file.',
      });
    }
  }
  const blocked =
    needs.length > 0 ||
    (first.unknown.length > 0 && !dropUnknown) ||
    diagnostics.some(({ severity }) => severity !== 'warning');
  return {
    status: blocked ? 'blocked' : 'ready',
    from: 1,
    to: PORTFOLIO_SCHEMA_VERSION,
    format,
    portfolio: { data: portfolio, text: portfolioText },
    site: { data: site, text: siteText },
    source: source.text,
    changes: located(changes, locate),
    ids: first.ids,
    minted: second.minted,
    needs,
    unknown: first.unknown,
    dropUnknown,
    diagnostics,
    notChecked,
    comments: format === 'yaml' ? commentLines(source.text) : [],
    secrets: secretsIn([{ data: legacy, locate, source }], sets),
    ...(first.origin ? { origin: first.origin } : {}),
  };
}

/** A version 2 portfolio document, through the 2-to-3 step. */
function migrateV2Portfolio(
  source: { readonly text: string; readonly format: DocumentFormat },
  data: Rec,
  locate: Locate,
  options: MigrateOptions,
): Migration {
  const failed = (...reasons: string[]): Migration => ({ status: 'failed', reasons });
  const sets = options.set ?? [];
  for (const { path } of sets) {
    if (!path.startsWith('portfolio.')) {
      return failed(`--set ${path}: a version 2 portfolio's migration sets portfolio values only.`);
    }
  }
  const siteRead = options.site ? parseSource(options.site.text, options.site.format) : undefined;
  const siteData = siteRead?.ok ? siteRead.data : undefined;
  const step = v3Step(data, { hidden: hiddenSections(siteData) });
  const portfolio = step.portfolio;
  const changes: Change[] = [...step.changes];
  droppedNamed(siteData, step.dropped, changes);
  for (const { path, value } of sets) {
    const segments = path.split('.').slice(1);
    const problem = setAt(portfolio, segments, coerce(value));
    if (problem) return failed(`--set ${path}: ${problem}`);
    changes.push({
      code: 'set',
      to: { document: 'portfolio', pointer: pointerOf(segments) },
      value,
      note: 'Given with --set.',
    });
  }
  const needs = portfolioNeeds(step.needs, portfolio);
  let text: string;
  try {
    text = serialize(portfolio, source.format);
  } catch (error) {
    return failed(`The new document can't be written: ${(error as Error).message}`);
  }
  const site = isPlainObject(siteData) ? siteData : placeholderSite();
  const checked = checkNew(portfolio, site, source.format, needs, options);
  // Only the portfolio changes, so only its records are the migration's.
  const diagnostics = checked.diagnostics.filter(({ document }) => document === 'portfolio');
  const blocked = needs.length > 0 || diagnostics.some(({ severity }) => severity !== 'warning');
  return {
    status: blocked ? 'blocked' : 'ready',
    from: V2_SCHEMA_VERSION,
    to: PORTFOLIO_SCHEMA_VERSION,
    format: source.format,
    portfolio: { data: portfolio, text },
    source: source.text,
    changes: located(changes, locate),
    ids: [],
    minted: step.minted,
    needs,
    unknown: [],
    dropUnknown: false,
    diagnostics,
    notChecked: checked.notChecked,
    comments: source.format === 'yaml' ? commentLines(source.text) : [],
    secrets: secretsIn([{ data, locate, source }], sets),
  };
}

/**
 * Migrates a stored unit (#3's `migrate-store`, and CLI `rollback --to`):
 * the version 2 portfolio to 3, the site document as it is. Each document
 * keeps its format; one no step changes comes back byte for byte, and the
 * media document always does. Deterministic, so a dry run and the real run
 * mint the same ids, and idempotent: its own output answers `current`. A
 * version no step reads, version 1 included, is `failed`, with a summary
 * that holds no value from the documents.
 */
export function migrateDocuments(unit: StoredUnit, options: MigrateOptions = {}): UnitMigration {
  const failed = (reasons: string[], summary: string[]): UnitMigration => ({
    status: 'failed',
    reasons,
    summary,
  });
  const portfolioRead = parseSource(unit.portfolio.text, unit.portfolio.format);
  const siteRead = parseSource(unit.site.text, unit.site.format);
  const unparsed: string[] = [];
  const summary: string[] = [];
  for (const [name, read] of [
    ['portfolio', portfolioRead],
    ['site', siteRead],
  ] as const) {
    if (read.ok) continue;
    summary.push(`The ${name} document doesn't parse.`);
    for (const { message, line, column } of read.problems) {
      unparsed.push(
        `The ${name} document: ${line === undefined ? message : `line ${line}, column ${column}: ${message}`}`,
      );
    }
  }
  if (!portfolioRead.ok || !siteRead.ok) return failed(unparsed, summary);

  const portfolioType = detectDocument(portfolioRead.data);
  const siteType = detectDocument(siteRead.data);
  const portfolioVersion = isPlainObject(portfolioRead.data)
    ? portfolioRead.data.schemaVersion
    : undefined;
  const siteVersion = isPlainObject(siteRead.data) ? siteRead.data.schemaVersion : undefined;
  if (portfolioType !== 'portfolio' || siteType !== 'site') {
    const what =
      portfolioType === 'legacy'
        ? 'The portfolio document is the old one-file format, version 1, which a stored unit never holds. pnpm config:migrate converts it.'
        : "The documents aren't a portfolio and a site document.";
    return failed([what], [what]);
  }
  if (siteVersion !== SITE_SCHEMA_VERSION) {
    const why = (what: string) =>
      `The site document declares ${what}, which no migration step reads. This release reads site documents at schemaVersion ${SITE_SCHEMA_VERSION}.`;
    return failed([why(declared(siteVersion))], [why('a schemaVersion')]);
  }
  if (portfolioVersion === PORTFOLIO_SCHEMA_VERSION) return { status: 'current' };
  if (portfolioVersion !== V2_SCHEMA_VERSION) {
    const why = (what: string) =>
      `The portfolio document declares ${what}, which no migration step reads. This release reads portfolio documents at schemaVersion ${PORTFOLIO_SCHEMA_VERSION}, and migrates them from ${V2_SCHEMA_VERSION}.`;
    return failed([why(declared(portfolioVersion))], [why('a schemaVersion')]);
  }

  const sets = options.set ?? [];
  const step = v3Step(portfolioRead.data as Rec, { hidden: hiddenSections(siteRead.data) });
  const portfolio = step.portfolio;
  const changes: Change[] = [...step.changes];
  droppedNamed(siteRead.data, step.dropped, changes);
  let siteText = unit.site.text;
  let site = siteRead.data as Rec;
  for (const { path, value } of sets) {
    const [document, ...segments] = path.split('.') as ['portfolio' | 'site', ...string[]];
    if (document === 'portfolio') {
      const problem = setAt(portfolio, segments, coerce(value));
      if (problem)
        return failed([`--set ${path}: ${problem}`], ['A --set value has no place to go.']);
    } else {
      // An edit by pointer, so the site document keeps its comments and every other byte.
      try {
        siteText = applyEdits(siteText, unit.site.format, [
          { op: 'set', pointer: pointerOf(segments), value: coerce(value) },
        ]);
      } catch {
        return failed(
          [`--set ${path}: it can't be set there.`],
          ['A --set value has no place to go.'],
        );
      }
      const reread = parseSource(siteText, unit.site.format);
      if (reread.ok && isPlainObject(reread.data)) site = reread.data;
    }
    changes.push({
      code: 'set',
      to: { document, pointer: pointerOf(segments) },
      value,
      note: 'Given with --set.',
    });
  }
  const needs = portfolioNeeds(step.needs, portfolio);
  let portfolioText: string;
  try {
    portfolioText = serialize(portfolio, unit.portfolio.format);
  } catch (error) {
    const why = `The new portfolio document can't be written: ${(error as Error).message}`;
    return failed([why], ["The new portfolio document can't be written."]);
  }
  const checked = validatePublicationUnit(
    {
      portfolio: {
        text: withPlaceholders(portfolio, needs, unit.portfolio.format) ?? portfolioText,
        format: unit.portfolio.format,
        name: `portfolio.${extensionOf(unit.portfolio.format)}`,
      },
      site: {
        text: siteText,
        format: unit.site.format,
        name: `site.${extensionOf(unit.site.format)}`,
      },
    },
    {
      catalog: options.catalog,
      extensions: options.extensions,
      ...(options.origin ? { canonicalOrigin: options.origin } : {}),
    },
  );
  const skipped = needPointers(needs);
  const diagnostics = checked.diagnostics.filter(
    ({ document, pointer }) => !skipped.has(`${document}:${pointer}`),
  );
  const blocked = needs.length > 0 || diagnostics.some(({ severity }) => severity !== 'warning');
  return {
    status: blocked ? 'blocked' : 'ready',
    from: { portfolio: V2_SCHEMA_VERSION, site: SITE_SCHEMA_VERSION },
    to: { portfolio: PORTFOLIO_SCHEMA_VERSION, site: SITE_SCHEMA_VERSION },
    documents: {
      portfolio: { text: portfolioText, format: unit.portfolio.format },
      site: { text: siteText, format: unit.site.format },
      ...(unit.media ? { media: unit.media } : {}),
    },
    changes: located(changes, portfolioRead.locate),
    minted: step.minted,
    needs,
    diagnostics,
    notChecked: checked.notChecked,
    comments: unit.portfolio.format === 'yaml' ? commentLines(unit.portfolio.text) : [],
    secrets: secretsIn(
      [
        { data: portfolioRead.data, locate: portfolioRead.locate, source: unit.portfolio },
        {
          data: site,
          locate: siteRead.locate,
          source: { text: siteText, format: unit.site.format },
        },
      ],
      sets,
    ),
  };
}

function extensionOf(format: DocumentFormat): string {
  return format === 'json' ? 'json' : 'yml';
}

function pointerOf(segments: readonly string[]): string {
  return toPointer(segments.map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment)));
}

/** Each change from the old file, located there, in the old file's order. */
function located(changes: readonly Change[], locate: Locate): Change[] {
  const position = (pointer: string) => locate(parsePointer(pointer) ?? [], 'key') ?? {};
  return changes
    .map((change) => (change.from === undefined ? change : { ...change, ...position(change.from) }))
    .sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
}

/** The portfolio values still needed: the step's, apart from those a `--set` filled. */
function portfolioNeeds(needs: readonly Need[], portfolio: Rec): Need[] {
  return needs.filter((need) => {
    const value = valueAt(portfolio, need.path.split('.').slice(1));
    return typeof value !== 'string' || value.trim() === '';
  });
}

function valueAt(root: unknown, segments: readonly string[]): unknown {
  let node = root;
  for (const segment of segments) {
    if (Array.isArray(node)) node = /^\d+$/.test(segment) ? node[Number(segment)] : undefined;
    else if (isPlainObject(node)) node = Object.hasOwn(node, segment) ? node[segment] : undefined;
    else return undefined;
  }
  return node;
}

/** Each need's pointer, as `<document>:<pointer>`, and for a variant the axes it decides too. */
function needPointers(needs: readonly Need[]): Set<string> {
  const skipped = new Set(
    needs.map(({ path }) => {
      const [document, ...segments] = path.split('.');
      return `${document}:${pointerOf(segments)}`;
    }),
  );
  if (skipped.has('site:/appearance/variant')) {
    skipped.add('site:/appearance/colorScheme').add('site:/appearance/typography');
  }
  return skipped;
}

/** The portfolio with placeholders for the values still needed, as text, or undefined when none are. */
function withPlaceholders(portfolio: Rec, needs: readonly Need[], format: DocumentFormat) {
  const own = needs.filter(({ path }) => path.startsWith('portfolio.'));
  if (own.length === 0) return undefined;
  const stand = structuredClone(portfolio);
  for (const need of own) setAt(stand, need.path.split('.').slice(1), 'placeholder');
  return serialize(stand, format);
}

/**
 * The new pair's diagnostics. The pair is checked even while values are
 * needed, so content problems show on the first run: placeholders stand in
 * for those values, and the records at their pointers are left out.
 * Without a variant, the color scheme and typography can't be checked
 * either.
 */
function checkNew(
  portfolio: Rec,
  site: Rec,
  format: DocumentFormat,
  needs: readonly Need[],
  options: MigrateOptions,
): { diagnostics: Diagnostic[]; notChecked: readonly string[] } {
  const stand = {
    portfolio: structuredClone(portfolio),
    site: structuredClone(site),
  };
  for (const need of needs) {
    const [document, ...segments] = need.path.split('.') as ['portfolio' | 'site', ...string[]];
    const value =
      document === 'site'
        ? (need.accepts?.[0] ?? PLACEHOLDERS[need.path] ?? 'placeholder')
        : 'placeholder';
    setAt(stand[document], segments, value);
  }
  const extension = extensionOf(format);
  const checked = validatePublicationUnit(
    {
      portfolio: {
        text: serialize(stand.portfolio, format),
        format,
        name: `portfolio.${extension}`,
      },
      site: { text: serialize(stand.site, format), format, name: `site.${extension}` },
    },
    {
      catalog: options.catalog,
      extensions: options.extensions,
      ...(options.origin ? { canonicalOrigin: options.origin } : {}),
    },
  );
  const skipped = needPointers(needs);
  return {
    diagnostics: checked.diagnostics.filter(
      ({ document, pointer }) => !skipped.has(`${document}:${pointer}`),
    ),
    notChecked: checked.notChecked,
  };
}

/** A site document to check a version 2 portfolio's migration with, when there's none beside it. */
function placeholderSite(): Rec {
  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    appearance: {
      variant: SITE_DEFAULTS.variant,
      designLanguage: SITE_DEFAULTS.designLanguage,
      colorScheme: 'placeholder',
      typography: 'placeholder',
      displayMode: SITE_DEFAULTS.displayMode,
    },
    visitorControls: { ...SITE_DEFAULTS.visitorControls },
    motionPolicy: SITE_DEFAULTS.motionPolicy,
    features: { ...SITE_DEFAULTS.features },
  };
}

/** What stands in for a value still needed, where the catalog lists none, while the pair is checked. */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  'site.appearance.variant': 'placeholder',
  'site.appearance.displayMode': 'system',
  'site.motionPolicy': 'respect-os',
};

/**
 * Every place the old documents hold secret-shaped text, keys the old schema
 * dropped and YAML comments included, and every `--set` value that's
 * secret-shaped. A PEM key spans lines, so redacting a line at a time would
 * still print its body: while there's any, the report withholds values.
 */
function secretsIn(
  documents: ReadonlyArray<{
    readonly data: unknown;
    readonly locate: Locate;
    readonly source: { readonly text: string; readonly format: DocumentFormat };
  }>,
  sets: readonly SetValue[],
): SecretSpot[] {
  const spots: SecretSpot[] = [];
  for (const { data, locate, source } of documents) {
    for (const { path, kind, in: at, line, column } of findSecrets(data, locate)) {
      spots.push({
        kind,
        in: at,
        pointer: redactedPointer(path),
        ...(line !== undefined ? { line, column } : {}),
      });
    }
    if (source.format === 'yaml') {
      for (const { text, line, column } of yamlComments(source.text)) {
        const kind = secretKind(text);
        if (kind) spots.push({ kind, in: 'comment', line, column });
      }
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
function setAt(root: Rec, segments: readonly string[], value: unknown): string | undefined {
  const define = (record: Rec, key: string, child: unknown) =>
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
  site: Rec,
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
