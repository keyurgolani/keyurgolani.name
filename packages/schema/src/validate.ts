import type { ContentExtension } from './extensions';
import { isSectionId, parseExtensionKind, RESERVED_SECTION_IDS } from './ids';
import { isPlainObject } from './json';
import {
  detectDocument,
  legacyNeeds,
  IDS_FIX_COMMAND,
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
import type { ParsedPair } from './view';
import { findSecrets, redactedPointer, redactSecrets, SECRET_LABELS, secretKind } from './secrets';
import { checkPair } from './pair-checks';
import type { AppearanceAxis, AppearanceSelection, Site } from './site';
import { parsePointer, yamlComments, type DocumentFormat, type Locate } from './source';

// The publication-unit validator (#4, items 13 to 15): both documents as one
// pair, checked alone and against each other. Pure and browser-safe, it never
// throws, and startup, the CLI, and Studio print the records it returns.

export type DiagnosticSeverity = 'blocks-preview' | 'blocks-publish' | 'warning';

/** The pair's two documents. */
type PairDoc = 'portfolio' | 'site';

/** Where a finding is: one of the pair's documents, or a snapshot or the media document beside them. */
export type DiagnosticDocument = PairDoc | 'snapshots' | 'media';

/**
 * One finding. `blocks-preview`: the pair can't render. `blocks-publish`: a
 * draft preview may render it, but it can't go live. Startup treats the
 * mounted pair as live, so both stop it. Messages and pointers never repeat a
 * value from the documents.
 */
export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  /**
   * The document the finding is in: one of the pair, or a unit file beside
   * them, a snapshot or the media document, which `file` names.
   */
  readonly document: DiagnosticDocument;
  /** For a snapshot or the media document, its path in the unit, such as snapshots/github.json. */
  readonly file?: string;
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

/**
 * What #3 knows at publish and import: the live revision and the draft's
 * derived block. The publication validators (urls.vanished, id.reused) read
 * it; without it, they report `notChecked`.
 */
export interface Publication {
  /** The live revision: null for an empty store. */
  readonly live: {
    readonly pair: ParsedPair;
    readonly media?: unknown;
    readonly snapshots?: Readonly<Record<string, unknown>>;
  } | null;
  /** The draft's derived block; absent for an import, which counts as accepting derived values. */
  readonly derived?: unknown;
  /**
   * The view paths each side's variant serves, which the schema can't read
   * from manifests. Without them, only the home page and the case-study
   * routes are checked.
   */
  readonly viewPaths?: { readonly live?: readonly string[]; readonly next?: readonly string[] };
}

/** What the checks may rely on. A check whose context is missing goes in `notChecked`. */
export interface Context {
  readonly catalog?: AppearanceCatalog;
  readonly extensions?: readonly ContentExtension[];
  /** The deployment's canonical origin, such as https://jane.name. */
  readonly canonicalOrigin?: string;
  readonly validators?: readonly UnitValidator[];
  /** At publish and import, the live revision and the draft's derived block (#3). */
  readonly publication?: Publication;
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
  'schema.outdated': 'blocks-preview',
  'id.missing': 'blocks-preview',
  'id.invalid': 'blocks-preview',
  'snapshot.syntax': 'blocks-preview',
  'snapshot.invalid': 'blocks-preview',
  'source.missing': 'blocks-preview',
  'source.duplicate': 'blocks-preview',
  'source.unreadable': 'blocks-preview',
  'legacy.document': 'blocks-preview',
  'site.deployment-setting': 'blocks-preview',
  'appearance.unknown': 'blocks-preview',
  'id.duplicate': 'blocks-publish',
  'id.reused': 'blocks-publish',
  'ref.missing': 'blocks-publish',
  'ref.unresolved': 'blocks-publish',
  'ref.type': 'blocks-publish',
  'curation.overlap': 'blocks-publish',
  'slug.duplicate': 'blocks-publish',
  'urls.vanished': 'blocks-publish',
  'metric.conflict': 'blocks-publish',
  'anchor.broken': 'blocks-publish',
  'secret.detected': 'blocks-publish',
  'content.empty': 'blocks-publish',
  'ref.private': 'warning',
  'section.empty': 'warning',
  'snapshot.ignored': 'warning',
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
  'schema.version':
    'Set schemaVersion: 3 in the portfolio document and schemaVersion: 2 in the site document. This release reads only those versions.',
  'schema.outdated': `Run ${MIGRATE_COMMAND} <file> to see every change it makes, then ${MIGRATE_COMMAND} <file> --write --out <dir> to write the schemaVersion 3 portfolio document into <dir>, and put it in place of the old one. Running it on its own output changes nothing.`,
  'id.missing': `Run ${IDS_FIX_COMMAND} to give every section, record, and media asset without an id one, keeping the file's comments and key order. An id is never derived when the document loads.`,
  'id.invalid': `Run ${IDS_FIX_COMMAND} to replace it with a well-formed id, or write one yourself: lowercase words and digits joined by hyphens, at most 64 characters, not main.`,
  'snapshot.syntax':
    'Fix the snapshot file at this position. A snapshot is one plain JSON document of at most 1 MiB. Refreshing the source rewrites it.',
  'snapshot.invalid':
    "Fix the value at this pointer, or remove the file and refresh the source. Until then the deployment won't start.",
  'snapshot.ignored':
    'Rename it to <kind>.json, with a kind of lowercase letters, digits, and hyphens, or remove it.',
  'source.missing':
    'Add the document: portfolio.yml and site.yml, or their .yaml or .json forms. portfolio.example.yml and site.example.yml are ones to start from.',
  'source.duplicate': 'Keep one of them, in the format you edit, and remove the others.',
  'source.unreadable':
    "Make the document a file the server's user can read: check its permissions, and that it isn't a directory.",
  'legacy.document': legacyRemediation('<file>'),
  'site.deployment-setting':
    "Remove it. Deployment settings come from the server's environment; docs/deployment.md lists them.",
  'appearance.unknown': 'Pick an id this build registers.',
  'id.duplicate': `Give each section, record, and media asset an id of its own. ${IDS_FIX_COMMAND} gives the later one a new id; references to the repeated id then name the first.`,
  'id.reused': `Give it an id of its own: the live revision's id names something of another type in anchors, feed entries, JSON-LD, and media URLs. ${IDS_FIX_COMMAND} mints one.`,
  'ref.missing':
    "Remove this entry from the site document's sections, or rename it to a section id the portfolio has.",
  'ref.unresolved': 'Point it at an id the portfolio has, of the right type, or remove it.',
  'ref.type':
    'Point it at a record of the type this place lists: works list works, proof lists evidence, and a cover, an avatar, a logo, or an og image shows an image asset.',
  'curation.overlap':
    'Keep each work in one place: the signature, featured, or archive. A list names each id once.',
  'slug.duplicate':
    'Give each case study a slug of its own. A slug may change; publish redirects the old one.',
  'urls.vanished':
    'Acknowledge the URL with portfolio-store urls ack <url> so it answers 410, or redirect it to a live URL with --redirect <path>.',
  'metric.conflict': 'Give both the same value, or give the evidence different metric keys.',
  'anchor.broken': 'Point the link at a visible section or record id, or drop the #fragment.',
  'secret.detected':
    'Remove it from the document and revoke it. Secrets belong in the environment or a secret file.',
  'content.empty':
    "Add a section with something public to show, or unhide one in the site document's sections.",
  'ref.private':
    "Make the record public, or leave it out here. Until then visitors don't see it here, and nothing else changes.",
  'section.empty':
    'List public records in it, author the part of the practice or the contact it shows, or remove the section.',
  'metric.duplicate':
    'Keep the metric in one piece of evidence, unless repeating it is deliberate.',
  'image.alt-missing':
    "Give the asset, or this placement, alt text that says what it shows, or decorative: true if it's only decoration. A caption isn't alt text.",
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
    document: PairDoc,
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
      add('portfolio', portfolioCode(problem), located(problem));
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
    const at = (document: PairDoc, path: readonly (string | number)[]) => ({
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
  locateIn: Readonly<Record<PairDoc, Locate>>,
  data: Readonly<Record<PairDoc, unknown>>,
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
    case 'outdated':
      return 'schema.outdated';
    case 'version':
      return 'schema.version';
    case 'duplicate-id':
      return 'id.duplicate';
    default:
      return 'schema.invalid';
  }
}

/** An entry id's pointer: a section's, a record's, or a media asset's. */
const ENTRY_ID = /^\/(?:sections|works|evidence|chronology|media)\/\d+\/id$/;

/** A portfolio problem's code: a missing or malformed entry id points at ids-fix. */
function portfolioCode(problem: DocumentProblem): DiagnosticCode {
  const code = problemCode(problem);
  if (
    code !== 'schema.invalid' ||
    problem.pointer === undefined ||
    !ENTRY_ID.test(problem.pointer)
  ) {
    return code;
  }
  return problem.code === 'invalid_type' && /is required\.$/.test(problem.message)
    ? 'id.missing'
    : 'id.invalid';
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
function stableId(document: PairDoc, pointer: string, data: unknown) {
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

/** By document, then pointer (array indexes in number order), then code. */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
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
