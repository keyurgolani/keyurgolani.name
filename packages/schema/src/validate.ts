import type { ContentExtension } from './extensions';
import { isSectionId, parseExtensionKind, RESERVED_SECTION_IDS } from './ids';
import { isPlainObject } from './json';
import {
  detectDocument,
  legacyNeeds,
  MIGRATE_COMMAND,
  migratedNames,
  shellQuote,
  SITE_DEFAULTS,
  SITE_SKELETON,
  SITE_SKELETON_JSON,
} from './legacy';
import {
  readPortfolio,
  readSite,
  type DocumentProblem,
  type DocumentRead,
  type DocumentWarning,
} from './load';
import type { Portfolio } from './portfolio';
import type { ParsedPair } from './public-view';
import { findSecrets, redactedPointer, redactSecrets, SECRET_LABELS, secretKind } from './secrets';
import type { AppearanceAxis, AppearanceSelection, Site } from './site';
import { parsePointer, yamlComments, type DocumentFormat, type Locate } from './source';

// The publication-unit validator (#4, items 13 to 15): both documents as one
// pair, checked alone and against each other. Pure and browser-safe, it never
// throws, and startup, the CLI, and Studio print the records it returns.

export type DiagnosticSeverity = 'blocks-preview' | 'blocks-publish' | 'warning';

/**
 * One finding. `blocks-preview`: the pair can't render. `blocks-publish`: a
 * draft preview may render it, but it can't go live. Startup treats the
 * mounted pair as live, so both stop it. Messages and pointers never repeat a
 * value from the documents.
 */
export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly document: 'portfolio' | 'site';
  /** JSON pointer into `document`; '' is the whole document. */
  readonly pointer: string;
  /** The id of the section the finding is about, when there is one. */
  readonly stableId?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly remediation: string;
}

/** One document's text, as read from its file. */
export interface SourceDocument {
  readonly text: string;
  readonly format: DocumentFormat;
  /**
   * The file as the reader would type it, such as portfolio.yml or
   * config/portfolio.yml. A remediation that suggests a command prints it.
   */
  readonly name: string;
}

/**
 * What appearance ids this build registers. #19 replaces the host's interim
 * catalog with the appearance registries.
 */
export interface AppearanceCatalog {
  /** The ids an axis allows for this selection, or null when the axis has no registry. */
  ids(axis: AppearanceAxis, selection: AppearanceSelection): readonly string[] | null;
  /**
   * The input a generator-backed color scheme takes: null when the scheme
   * isn't generator-backed, undefined when there's no registry to ask.
   */
  generatorInput(schemeId: string): 'seed-color' | 'asset' | null | undefined;
}

/**
 * A check from another package, such as #5's variant contract or #19's packs.
 * Its records are located and redacted like the core ones. One that throws,
 * or returns anything malformed, adds no record and leaves
 * `validator:<id>` in `notChecked`.
 */
export interface UnitValidator {
  readonly id: string;
  /**
   * The `notChecked` entries this validator checks, cleared once it returns,
   * such as `site.routes.*` for #5's route registry. A trailing `*` matches
   * any rest.
   */
  readonly covers?: readonly string[];
  validate(pair: ParsedPair, ctx: Context): { diagnostics: Diagnostic[]; notChecked?: string[] };
}

/** What the checks may rely on. A check whose context is missing goes in `notChecked`. */
export interface Context {
  readonly catalog?: AppearanceCatalog;
  readonly extensions?: readonly ContentExtension[];
  /** The deployment's canonical origin, such as https://jane.name. */
  readonly canonicalOrigin?: string;
  readonly validators?: readonly UnitValidator[];
}

export interface PublicationUnitResult {
  /** Both documents' models, unless a `blocks-preview` diagnostic stops rendering. */
  readonly pair: ParsedPair | null;
  /** Sorted by document, pointer, and code. */
  readonly diagnostics: readonly Diagnostic[];
  /** Checks that couldn't run, such as one whose registry doesn't exist yet. */
  readonly notChecked: readonly string[];
}

/** The severity of each code the core checks raise. */
export const DIAGNOSTIC_SEVERITIES = {
  'parse.syntax': 'blocks-preview',
  'schema.invalid': 'blocks-preview',
  'schema.version': 'blocks-preview',
  'source.missing': 'blocks-preview',
  'source.duplicate': 'blocks-preview',
  'source.unreadable': 'blocks-preview',
  'legacy.document': 'blocks-preview',
  'site.deployment-setting': 'blocks-preview',
  'appearance.unknown': 'blocks-preview',
  'id.duplicate': 'blocks-publish',
  'ref.missing': 'blocks-publish',
  'metric.conflict': 'blocks-publish',
  'anchor.broken': 'blocks-publish',
  'secret.detected': 'blocks-publish',
  'content.empty': 'blocks-publish',
  'metric.duplicate': 'warning',
  'image.alt-missing': 'warning',
  'origin.sample': 'warning',
  'origin.stale': 'warning',
  'extension.unregistered': 'warning',
  'validator.failed': 'blocks-preview',
} as const satisfies Record<string, DiagnosticSeverity>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_SEVERITIES;

/** What to do about each code. `@portfolio/schema/node` raises the `source.*` ones. */
export const DIAGNOSTIC_REMEDIATIONS: Readonly<Record<DiagnosticCode, string>> = {
  'parse.syntax':
    'Fix the text at this position. A document is one plain YAML or JSON document, with no anchors, aliases, merge keys, tags, or directives.',
  'schema.invalid':
    "Change the value at this pointer to what the schema expects. Data the schema doesn't define goes under extensions, keyed by an npm package name.",
  'schema.version': 'Set schemaVersion: 2. This release reads only version 2 documents.',
  'source.missing':
    'Add the document: portfolio.yml and site.yml, or their .yaml or .json forms. portfolio.example.yml and site.example.yml are ones to start from.',
  'source.duplicate': 'Keep one of them, in the format you edit, and remove the others.',
  'source.unreadable':
    "Make the document a file the server's user can read: check its permissions, and that it isn't a directory.",
  'legacy.document': legacyRemediation('<file>'),
  'site.deployment-setting':
    "Remove it. Deployment settings come from the server's environment; docs/deployment.md lists them.",
  'appearance.unknown': 'Pick an id this build registers.',
  'id.duplicate': 'Give each section an id of its own.',
  'ref.missing':
    "Remove this entry from the site document's sections, or rename it to a section id the portfolio has.",
  'metric.conflict': 'Give both the same value, or give the stats different metric keys.',
  'anchor.broken': 'Point the link at a visible section id, or drop the #fragment.',
  'secret.detected':
    'Remove it from the document and revoke it. Secrets belong in the environment or a secret file.',
  'content.empty': "Add a section, or unhide one in the site document's sections.",
  'metric.duplicate': 'Keep the metric in one section, unless repeating it is deliberate.',
  'image.alt-missing':
    "Give it alt text that says what it shows, or alt: '' if it's only decoration. A gallery image can take a caption instead.",
  'origin.sample': 'Replace the sample address with your own, or remove the link.',
  'origin.stale': "If that's an old domain, point the link at the configured origin's host.",
  'extension.unregistered':
    "Register the extension's package with the host, or remove the data. Until then it's kept as written and never shown.",
  'validator.failed':
    'This is a bug in the build, such as two content extensions with one namespace, not in the documents.',
};

/**
 * Keys that belong to the deployment (#1), not the site document, at the top
 * level or under `features`, with the environment variable that sets each. A
 * Map, so `constructor` and the other Object.prototype names aren't in it.
 */
const DEPLOYMENT_SETTINGS: ReadonlyMap<string, string> = new Map([
  ['deploymentProfile', 'PORTFOLIO_PROFILE'],
  ['profile', 'PORTFOLIO_PROFILE'],
  ['origin', 'PORTFOLIO_ORIGIN'],
  ['canonicalOrigin', 'PORTFOLIO_ORIGIN'],
  ['url', 'PORTFOLIO_ORIGIN'],
  ['baseUrl', 'PORTFOLIO_ORIGIN'],
  ['studio', 'PORTFOLIO_PROFILE'],
  ['previewOrigin', 'PORTFOLIO_PREVIEW_ORIGIN'],
  ['trustedProxies', 'PORTFOLIO_TRUSTED_PROXY_HOPS'],
  ['proxy', 'PORTFOLIO_TRUSTED_PROXY_HOPS'],
]);

const AXES: readonly AppearanceAxis[] = [
  'variant',
  'designLanguage',
  'colorScheme',
  'typography',
  'displayMode',
];

const AXIS_NAMES: Record<AppearanceAxis, string> = {
  variant: 'variant',
  designLanguage: 'design language',
  colorScheme: 'color scheme',
  typography: 'typography preset',
  displayMode: 'display mode',
};

/**
 * Validates a portfolio and site document as one publication unit. It reads
 * both, checks each alone, then checks the pair: appearance ids against the
 * catalog, site references, anchors, metrics, secrets, and origins. Plugged-in
 * validators run last, on a pair that parsed.
 */
export function validatePublicationUnit(
  unit: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
  ctx: Context = {},
): PublicationUnitResult {
  try {
    return check(unit, ctx);
  } catch {
    return {
      pair: null,
      diagnostics: [
        {
          code: 'validator.failed',
          severity: DIAGNOSTIC_SEVERITIES['validator.failed'],
          document: 'portfolio',
          pointer: '',
          // The failure is the build's, so it's placed at the document's start.
          line: 1,
          column: 1,
          message: 'The validator failed before it could check this pair.',
          remediation: DIAGNOSTIC_REMEDIATIONS['validator.failed'],
        },
      ],
      notChecked: [],
    };
  }
}

/**
 * The legacy.document record the pair check reports for a portfolio document
 * in the old one-file format, or undefined when it isn't one. For a directory
 * that holds the old file and no site document yet, as an upgrade finds it.
 */
export function legacyDocumentRecord(
  source: SourceDocument,
  ctx: Context = {},
): Diagnostic | undefined {
  const read = readPortfolio(source.text, source.format, {
    extensions: ctx.extensions,
    name: source.name,
  });
  const [problem] = read.problems;
  if (problem?.kind !== 'legacy') return undefined;
  const found = located(problem);
  return {
    code: 'legacy.document',
    severity: DIAGNOSTIC_SEVERITIES['legacy.document'],
    document: 'portfolio',
    pointer: found.pointer,
    ...(found.line !== undefined ? { line: found.line, column: found.column } : {}),
    message: found.message,
    remediation: legacyRemediation(source.name, read.data, ctx.catalog),
  };
}

function check(
  unit: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
  ctx: Context,
): PublicationUnitResult {
  const { extensions } = ctx;
  const portfolio = readPortfolio(unit.portfolio.text, unit.portfolio.format, {
    extensions,
    name: unit.portfolio.name,
  });
  const site = readSite(unit.site.text, unit.site.format, { extensions, name: unit.site.name });
  const diagnostics: Diagnostic[] = [];
  const notChecked: string[] = [];
  const data = { portfolio: portfolio.data, site: site.data };
  const add = (
    document: Diagnostic['document'],
    code: DiagnosticCode,
    found: { pointer: string; message: string; line?: number; column?: number },
    remediation = DIAGNOSTIC_REMEDIATIONS[code],
  ) => {
    diagnostics.push({
      code,
      severity: DIAGNOSTIC_SEVERITIES[code],
      document,
      pointer: found.pointer,
      ...stableId(document, found.pointer, data[document]),
      ...(found.line !== undefined ? { line: found.line, column: found.column } : {}),
      message: found.message,
      remediation,
    });
  };

  const reads = { portfolio, site } as const;
  const documents = ['portfolio', 'site'] as const;

  // An old-format document is the one thing reported, for either slot (item 18).
  const legacy = documents.filter((document) =>
    reads[document].problems.some(({ kind }) => kind === 'legacy'),
  );
  if (legacy.length > 0) {
    for (const document of legacy) {
      const [problem] = reads[document].problems;
      add(
        document,
        'legacy.document',
        located(problem!),
        legacyRemediation(unit[document].name, reads[document].data, ctx.catalog),
      );
    }
    diagnostics.sort(compareDiagnostics);
    return { pair: null, diagnostics, notChecked: [] };
  }

  // A document in the other's slot gets one problem, not one per field.
  const swapped = {
    portfolio: detectDocument(portfolio.data) === 'site',
    site: detectDocument(site.data) === 'portfolio',
  };
  for (const document of documents) {
    if (!swapped[document]) continue;
    const other = document === 'portfolio' ? 'site' : 'portfolio';
    const marker = other === 'site' ? 'appearance' : 'identity';
    const name = unit[document].name;
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    add(
      document,
      'schema.invalid',
      {
        pointer: '',
        message: `${name} holds a ${other} document (it has ${marker}), not a ${document} document.`,
        ...reads[document].locate?.([marker], 'key'),
      },
      `Put the ${document} document in ${name}, or rename this file to ${other}${extension}.`,
    );
  }

  if (!swapped.portfolio) {
    for (const problem of portfolio.problems) {
      add('portfolio', problemCode(problem), located(problem));
    }
    for (const problem of portfolio.duplicates) {
      add('portfolio', 'id.duplicate', located(problem));
    }
  }
  for (const problem of swapped.site ? [] : site.problems) {
    const setting = deploymentSetting(problem);
    if (setting) {
      add(
        'site',
        'site.deployment-setting',
        {
          ...located(problem),
          message: `${problem.pointer} is a deployment setting, which the site document can't hold.`,
        },
        `Remove it, and set ${setting} in the server's environment instead. docs/deployment.md lists the settings.`,
      );
    } else {
      add('site', problemCode(problem), located(problem));
    }
  }
  for (const [document, read, source] of [
    ['portfolio', portfolio, unit.portfolio],
    ['site', site, unit.site],
  ] as const) {
    secrets(read, (found) => add(document, 'secret.detected', found));
    // Comments aren't data, but the text is stored and shown (#3), so a
    // secret pasted into one leaks as surely.
    if (source.format === 'yaml' && read.data !== undefined) {
      for (const { text, line, column } of yamlComments(source.text)) {
        const kind = secretKind(text);
        if (!kind) continue;
        add(document, 'secret.detected', {
          pointer: '',
          message: `A comment looks like ${SECRET_LABELS[kind]}. A document can't hold secrets.`,
          line,
          column,
        });
      }
    }
    for (const warning of read.warnings) {
      add(document, 'extension.unregistered', locatedWarning(warning));
    }
  }

  let pair: ParsedPair | null = null;
  if (portfolio.value && site.value && portfolio.locate && site.locate) {
    pair = { portfolio: portfolio.value, site: site.value };
    const locateIn = { portfolio: portfolio.locate, site: site.locate };
    const at = (document: Diagnostic['document'], path: readonly (string | number)[]) => ({
      pointer: redactedPointer(path),
      ...locateIn[document](path),
    });
    checkAppearance(pair.site, ctx, notChecked, (path, message, remediation) =>
      add('site', 'appearance.unknown', { ...at('site', path), message }, remediation),
    );
    for (const id of Object.keys(pair.site.routes ?? {})) notChecked.push(`site.routes.${id}`);
    for (const id of Object.keys(pair.site.variantControls ?? {})) {
      notChecked.push(`site.variantControls.${id}`);
    }
    checkPair(pair, ctx, notChecked, (document, code, path, message) =>
      add(document, code, { ...at(document, path), message }),
    );
    for (const validator of ctx.validators ?? []) {
      const result = runValidator(validator, pair, ctx, locateIn, data);
      if (!result) {
        notChecked.push(`validator:${validator.id}`);
        continue;
      }
      diagnostics.push(...result.diagnostics);
      const remaining = notChecked.filter((entry) => !covers(validator, entry));
      notChecked.splice(0, notChecked.length, ...remaining, ...result.notChecked);
    }
  }

  diagnostics.sort(compareDiagnostics);
  const blocked = diagnostics.some(({ severity }) => severity === 'blocks-preview');
  return {
    pair: blocked ? null : pair,
    diagnostics,
    notChecked: [...new Set(notChecked)].sort(),
  };
}

/** Whether a validator declares that it checks a `notChecked` entry. */
function covers(validator: UnitValidator, entry: string): boolean {
  const patterns: readonly unknown[] = Array.isArray(validator.covers) ? validator.covers : [];
  return patterns.some(
    (pattern) =>
      typeof pattern === 'string' &&
      (pattern.endsWith('*') ? entry.startsWith(pattern.slice(0, -1)) : entry === pattern),
  );
}

const SEVERITIES: ReadonlySet<unknown> = new Set(['blocks-preview', 'blocks-publish', 'warning']);
/** A record's code: dotted lowercase words, such as `route.unknown`. */
const RECORD_CODE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/**
 * A plugged-in validator's records, each located from its pointer and
 * redacted like the core's, or null when it threw or returned anything
 * malformed. A malformed result counts whole, so none of its records stay.
 */
function runValidator(
  validator: UnitValidator,
  pair: ParsedPair,
  ctx: Context,
  locateIn: Readonly<Record<Diagnostic['document'], Locate>>,
  data: Readonly<Record<Diagnostic['document'], unknown>>,
): { diagnostics: Diagnostic[]; notChecked: string[] } | null {
  let result: unknown;
  try {
    result = validator.validate(pair, ctx);
  } catch {
    return null;
  }
  if (!isPlainObject(result) || !Array.isArray(result.diagnostics)) return null;
  const notChecked = result.notChecked ?? [];
  if (!Array.isArray(notChecked) || !notChecked.every((entry) => typeof entry === 'string')) {
    return null;
  }
  const records: Diagnostic[] = [];
  for (const record of result.diagnostics as unknown[]) {
    if (!isPlainObject(record)) return null;
    const { code, severity, document, pointer, message, remediation } = record;
    const path = typeof pointer === 'string' ? parsePointer(pointer) : null;
    const core = typeof code === 'string' && Object.hasOwn(DIAGNOSTIC_SEVERITIES, code);
    if (
      typeof code !== 'string' ||
      !RECORD_CODE.test(code) ||
      !SEVERITIES.has(severity) ||
      // A core code keeps its core severity.
      (core && DIAGNOSTIC_SEVERITIES[code as DiagnosticCode] !== severity) ||
      (document !== 'portfolio' && document !== 'site') ||
      path === null ||
      typeof message !== 'string' ||
      typeof remediation !== 'string'
    ) {
      return null;
    }
    const redacted = redactedPointer(path);
    records.push({
      code,
      severity: severity as DiagnosticSeverity,
      document,
      pointer: redacted,
      ...stableId(document, redacted, data[document]),
      ...locateIn[document](path),
      message: redactSecrets(message),
      remediation: redactSecrets(remediation),
    });
  }
  return { diagnostics: records, notChecked: notChecked.map((entry) => redactSecrets(entry)) };
}

/**
 * How to convert an old-format file: the dry run, then the run that writes,
 * with the `--set` values it will stop on, and the site document it starts
 * from, in the file's own format.
 */
function legacyRemediation(file: string, data: unknown = {}, catalog?: AppearanceCatalog): string {
  const names = migratedNames(file);
  let variants: readonly string[] | null = null;
  try {
    variants = catalog?.ids('variant', ANY_SELECTION) ?? null;
  } catch {
    variants = null;
  }
  const sets = legacyNeeds(data, variants)
    .map((path) => ` --set ${path}=<value>`)
    .join('');
  const skeleton = names.site.endsWith('.json') ? SITE_SKELETON_JSON : SITE_SKELETON;
  const command = `${MIGRATE_COMMAND} ${shellQuote(file)}`;
  return `Run ${command} to see every change it makes, then ${command}${sets} --write --out <dir> to write ${names.portfolio} and ${names.site}. A ${names.site} starts like this:\n${skeleton}`;
}

/** A selection to ask the catalog for its variants, which no selection changes. */
const ANY_SELECTION: AppearanceSelection = {
  variant: SITE_DEFAULTS.variant,
  designLanguage: SITE_DEFAULTS.designLanguage,
  colorScheme: '',
  typography: '',
  displayMode: SITE_DEFAULTS.displayMode,
};

function problemCode(problem: DocumentProblem): DiagnosticCode {
  switch (problem.kind) {
    case 'syntax':
      return 'parse.syntax';
    case 'legacy':
      return 'legacy.document';
    case 'version':
      return 'schema.version';
    case 'duplicate-id':
      return 'id.duplicate';
    default:
      return 'schema.invalid';
  }
}

function located(problem: DocumentProblem) {
  return {
    pointer: problem.pointer ?? '',
    message: problem.message,
    ...(problem.line !== undefined ? { line: problem.line, column: problem.column } : {}),
  };
}

function locatedWarning(warning: DocumentWarning) {
  return {
    pointer: warning.pointer,
    message: warning.message,
    ...(warning.line !== undefined ? { line: warning.line, column: warning.column } : {}),
  };
}

/** The environment variable for a deployment key the site document holds, if that's the problem. */
function deploymentSetting(problem: DocumentProblem): string | undefined {
  if (problem.code !== 'unrecognized_keys' || problem.pointer === undefined) return undefined;
  const match = /^(?:\/features)?\/([^/]+)$/.exec(problem.pointer);
  return match ? DEPLOYMENT_SETTINGS.get(match[1]!) : undefined;
}

/**
 * The section a pointer is about: its id in the portfolio, its key in the
 * site document. Only an id in the section-id shape counts, so a value
 * that's no id, such as a pasted token, never rides along in the records.
 */
function stableId(document: Diagnostic['document'], pointer: string, data: unknown) {
  const [first, second] = pointer.split('/').slice(1);
  if (first !== 'sections' || second === undefined) return {};
  let id: unknown = second;
  if (document === 'portfolio') {
    const sections = isPlainObject(data) ? data.sections : undefined;
    const section = Array.isArray(sections) ? sections[Number(second)] : undefined;
    id = isPlainObject(section) ? section.id : undefined;
  }
  return typeof id === 'string' && isSectionId(id) ? { stableId: id } : {};
}

function secrets(
  read: DocumentRead<unknown>,
  report: (found: { pointer: string; message: string; line?: number; column?: number }) => void,
) {
  if (read.data === undefined || !read.locate) return;
  // A secret-shaped key is located at the key; its pointer names the object holding it.
  for (const { path, kind, in: where, line, column } of findSecrets(read.data, read.locate)) {
    const pointer = redactedPointer(path);
    const subject = where === 'key' ? `A key in ${pointer || 'the document'}` : pointer;
    report({
      pointer,
      message: `${subject} looks like ${SECRET_LABELS[kind]}. A document can't hold secrets.`,
      ...(line !== undefined ? { line, column } : {}),
    });
  }
}

function checkAppearance(
  site: Site,
  ctx: Context,
  notChecked: string[],
  report: (path: (string | number)[], message: string, remediation: string) => void,
) {
  for (const axis of AXES) {
    const ids = catalogIds(ctx.catalog, axis, site.appearance);
    if (!ids) {
      notChecked.push(`site.appearance.${axis}`);
      continue;
    }
    if (!ids.includes(site.appearance[axis])) {
      const name = AXIS_NAMES[axis];
      report(
        ['appearance', axis],
        `/appearance/${axis} names no ${name} this build registers.`,
        ids.length > 0 ? `Use one of: ${ids.join(', ')}.` : `This build registers no ${name}.`,
      );
    }
  }
  for (const [schemeId, input] of Object.entries(site.appearanceInputs ?? {})) {
    let takes: 'seed-color' | 'asset' | null | undefined;
    try {
      takes = ctx.catalog?.generatorInput(schemeId);
    } catch {
      takes = undefined;
    }
    const pointer = redactedPointer(['appearanceInputs', schemeId]);
    if (takes === undefined) {
      notChecked.push(`site.appearanceInputs.${schemeId}`);
    } else if (takes === null) {
      report(
        ['appearanceInputs', schemeId],
        `${pointer} is for a color scheme that takes no input.`,
        'Remove the entry, or key it by a generator-backed color scheme.',
      );
    } else {
      const field = takes === 'seed-color' ? 'seedColor' : 'sourceAsset';
      if (!(field in input)) {
        report(
          ['appearanceInputs', schemeId],
          `${pointer} gives its color scheme the wrong kind of input.`,
          `That scheme takes ${takes === 'seed-color' ? 'a seed color' : 'a source asset'}: set ${field}.`,
        );
      }
    }
  }
}

function catalogIds(
  catalog: AppearanceCatalog | undefined,
  axis: AppearanceAxis,
  selection: AppearanceSelection,
): readonly string[] | null {
  try {
    return catalog ? catalog.ids(axis, selection) : null;
  } catch {
    return null;
  }
}

type PairReport = (
  document: Diagnostic['document'],
  code: DiagnosticCode,
  path: readonly (string | number)[],
  message: string,
) => void;

function checkPair(pair: ParsedPair, ctx: Context, notChecked: string[], report: PairReport) {
  const { portfolio, site } = pair;
  const registered = new Set((ctx.extensions ?? []).map(({ namespace }) => namespace));
  const ids = new Set(portfolio.sections.map(({ id }) => id));
  for (const id of Object.keys(site.sections ?? {})) {
    if (!ids.has(id)) {
      report(
        'site',
        'ref.missing',
        ['sections', id],
        `${redactedPointer(['sections', id])} names no section in the portfolio.`,
      );
    }
  }

  // A section is visible unless the site hides it or no registered extension renders it.
  const visible = portfolio.sections.map((section) => {
    if (site.sections?.[section.id]?.hidden === true) return false;
    const extension = parseExtensionKind(section.kind);
    return !extension || registered.has(extension.namespace);
  });
  if (!visible.includes(true)) {
    report('portfolio', 'content.empty', ['sections'], 'The portfolio has no visible section.');
  }

  const links = publicUrls(portfolio, visible);
  const targets = new Set([
    ...RESERVED_SECTION_IDS,
    ...portfolio.sections.filter((_, index) => visible[index]).map(({ id }) => id),
  ]);
  for (const { path, url } of links) {
    const fragment = /^\/?#(.+)$/.exec(url)?.[1];
    if (fragment !== undefined && !targets.has(fragment)) {
      report(
        'portfolio',
        'anchor.broken',
        path,
        `${redactedPointer(path)} links to no visible section.`,
      );
    }
  }

  checkMetrics(portfolio, visible, report);
  checkAltText(portfolio, visible, report);

  const origin = canonicalHost(ctx.canonicalOrigin);
  if (origin === undefined) {
    notChecked.push('origin.sample', 'origin.stale');
    return;
  }
  for (const { path, url } of links) {
    const host = httpHost(url);
    const sample = host !== undefined ? isSampleHost(host) : mailDomains(url).some(isSampleHost);
    if (!isSampleHost(origin) && sample) {
      report(
        'portfolio',
        'origin.sample',
        path,
        `${redactedPointer(path)} links to a sample address.`,
      );
    } else if (host !== undefined && isStaleHost(host, origin)) {
      report(
        'portfolio',
        'origin.stale',
        path,
        `${redactedPointer(path)} links to a host that differs from the configured origin's only in its last label.`,
      );
    }
  }
}

/**
 * Every url, src, and *Url value visitors can reach: outside hidden sections,
 * outside sections no registered extension renders, and outside extension
 * data, which only its extension understands.
 */
function publicUrls(portfolio: Portfolio, visible: readonly boolean[]) {
  const found: Array<{ path: (string | number)[]; url: string }> = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    if (!isPlainObject(node)) return;
    const extensionSection = typeof node.kind === 'string' && parseExtensionKind(node.kind);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'extensions' || (extensionSection && key === 'data')) continue;
      if (typeof child === 'string' && (key === 'url' || key === 'src' || key.endsWith('Url'))) {
        found.push({ path: [...path, key], url: child });
      } else {
        walk(child, [...path, key]);
      }
    }
  };
  const { sections, ...rest } = portfolio;
  walk(rest, []);
  sections.forEach((section, index) => {
    if (visible[index]) walk(section, ['sections', index]);
  });
  return found;
}

/**
 * Visible images that show something no text beside them names, with no
 * words for it: a gallery image without alt text or a caption, and a
 * project's screenshot without alt text. The shared renderers give such an
 * image no alt at all, so an audit finds it too. Logos, avatars, and covers
 * sit beside the name they show, so they're decorative without alt text, and
 * `alt: ''` says an image is decoration on purpose.
 */
function checkAltText(portfolio: Portfolio, visible: readonly boolean[], report: PairReport) {
  const missing = (path: (string | number)[], what: string) =>
    report('portfolio', 'image.alt-missing', path, `${redactedPointer(path)} ${what}`);
  portfolio.sections.forEach((section, index) => {
    if (!visible[index]) return;
    if (section.kind === 'gallery') {
      section.items.forEach((item, position) => {
        if (item.image.alt === undefined && !item.caption?.trim()) {
          missing(
            ['sections', index, 'items', position, 'image'],
            "has no alt text or caption, so a visitor who can't see it can't tell what it shows.",
          );
        }
      });
    } else if (section.kind === 'projects') {
      section.items.forEach((item, position) => {
        item.images?.forEach((image, at) => {
          if (image.alt !== undefined) return;
          missing(
            ['sections', index, 'items', position, 'images', at],
            "has no alt text, so a visitor who can't see it can't tell what it shows.",
          );
        });
      });
    }
  });
}

function checkMetrics(portfolio: Portfolio, visible: readonly boolean[], report: PairReport) {
  interface Stated {
    readonly path: (string | number)[];
    readonly value: string | number;
    readonly section: number;
  }
  const byKey = new Map<string, Stated[]>();
  const state = (key: string, stated: Stated) =>
    byKey.set(key, [...(byKey.get(key) ?? []), stated]);
  portfolio.sections.forEach((section, index) => {
    if (section.kind === 'stats') {
      section.items.forEach((item, position) => {
        if (!item.metric) return;
        const path = ['sections', index, 'items', position, 'value'];
        state(item.metric, { path, value: item.value, section: index });
      });
    } else if (section.kind === 'tenure' && section.years !== undefined) {
      state('tenure-years', {
        path: ['sections', index, 'years'],
        value: section.years,
        section: index,
      });
    }
  });
  const between = (a: Stated, b: Stated) =>
    `${redactedPointer(a.path)} and ${redactedPointer(b.path)}`;
  for (const stated of byKey.values()) {
    // One group per value, in the order each value is first stated.
    const groups = new Map<string, Stated[]>();
    for (const one of stated) {
      const value = normalizedValue(one.value);
      groups.set(value, [...(groups.get(value) ?? []), one]);
    }
    const [first] = stated;
    for (const [value, group] of groups) {
      // Every statement of a value other than the first statement's contradicts it.
      if (value !== normalizedValue(first!.value)) {
        for (const later of group) {
          report(
            'portfolio',
            'metric.conflict',
            later.path,
            `${between(later, first!)} give one metric different values.`,
          );
        }
      }
      // A value visitors see in two sections, hidden statements aside.
      const shown = group.filter(({ section }) => visible[section]);
      const [earliest] = shown;
      for (const later of shown.slice(1)) {
        if (later.section === earliest!.section) continue;
        report(
          'portfolio',
          'metric.duplicate',
          later.path,
          `${between(later, earliest!)} show one metric with the same value.`,
        );
      }
    }
  }
}

/**
 * A metric value as it compares: a number when it reads as a finite number,
 * else its text trimmed and lowercased.
 */
function normalizedValue(value: string | number): string {
  const text = String(value).trim();
  const number = text === '' ? Number.NaN : Number(text);
  return Number.isFinite(number) ? `number:${number}` : `text:${text.toLowerCase()}`;
}

function canonicalHost(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

function httpHost(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The domain of each address a mailto: URL names, lowercased. */
function mailDomains(url: string): string[] {
  if (!/^mailto:/i.test(url)) return [];
  let to = url.slice('mailto:'.length).split('?')[0]!;
  try {
    to = decodeURIComponent(to);
  } catch {
    // Kept as written: a stray % only makes the address unreadable.
  }
  return to
    .split(',')
    .map((address) =>
      address
        .slice(address.lastIndexOf('@') + 1)
        .trim()
        .toLowerCase(),
    )
    .filter((domain) => domain !== '');
}

/** The reserved names sample content uses: example.com, .net, .org, *.example, *.test, *.invalid, and localhost. */
function isSampleHost(host: string): boolean {
  const name = host.replace(/\.$/, '');
  return (
    /(^|\.)example\.(?:com|net|org)$/.test(name) ||
    /(^|\.)(?:example|test|invalid|localhost)$/.test(name)
  );
}

/** keyurgolani.com on keyurgolani.name: every label the same but the last, ignoring www. */
function isStaleHost(host: string, origin: string): boolean {
  const labels = (name: string) => name.replace(/^www\./, '').split('.');
  const [a, b] = [labels(host), labels(origin)];
  if (a.length < 2 || a.length !== b.length) return false;
  const last = a.length - 1;
  return a[last] !== b[last] && a.slice(0, last).every((label, index) => label === b[index]);
}

/** By document, then pointer (array indexes in number order), then code. */
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.document !== b.document) return a.document < b.document ? -1 : 1;
  const pointer = comparePointers(a.pointer, b.pointer);
  if (pointer !== 0) return pointer;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function comparePointers(a: string, b: string): number {
  const [x, y] = [a.split('/'), b.split('/')];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i]!, y[i]!];
    if (p === q) continue;
    const numeric = /^\d+$/.test(p) && /^\d+$/.test(q);
    if (numeric) return Number(p) - Number(q);
    return p < q ? -1 : 1;
  }
  return x.length - y.length;
}
