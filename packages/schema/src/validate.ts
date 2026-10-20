import type { ContentExtension } from './extensions';
import { parseExtensionKind, RESERVED_SECTION_IDS } from './ids';
import { isPlainObject } from './json';
import {
  readPortfolio,
  readSite,
  type DocumentProblem,
  type DocumentRead,
  type DocumentWarning,
} from './load';
import type { Portfolio } from './portfolio';
import type { ParsedPair } from './public-view';
import { findSecrets, redactSecrets, SECRET_LABELS } from './secrets';
import type { AppearanceAxis, AppearanceSelection, Site } from './site';
import { toPointer, type DocumentFormat } from './source';

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

/** A check from another package, such as #5's variant contract or #19's packs. */
export interface UnitValidator {
  readonly id: string;
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
  'site.deployment-setting': 'blocks-preview',
  'appearance.unknown': 'blocks-preview',
  'id.duplicate': 'blocks-publish',
  'ref.missing': 'blocks-publish',
  'metric.conflict': 'blocks-publish',
  'anchor.broken': 'blocks-publish',
  'secret.detected': 'blocks-publish',
  'content.empty': 'blocks-publish',
  'metric.duplicate': 'warning',
  'origin.sample': 'warning',
  'origin.stale': 'warning',
  'extension.unregistered': 'warning',
} as const satisfies Record<string, DiagnosticSeverity>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_SEVERITIES;

const REMEDIATIONS: Record<DiagnosticCode, string> = {
  'parse.syntax':
    'Fix the text at this position. A document is one plain YAML or JSON document, with no anchors, aliases, merge keys, tags, or directives.',
  'schema.invalid':
    "Change the value at this pointer to what the schema expects. Data the schema doesn't define goes under extensions, keyed by an npm package name.",
  'schema.version': 'Set schemaVersion: 2. This release reads only version 2 documents.',
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
  'origin.sample': 'Replace the sample address with your own, or remove the link.',
  'origin.stale': "If that's an old domain, point the link at the configured origin's host.",
  'extension.unregistered':
    "Register the extension's package with the host, or remove the data. Until then it's kept as written and never shown.",
};

/**
 * Keys that belong to the deployment (#1), not the site document, at the top
 * level or under `features`, with the environment variable that sets each.
 */
const DEPLOYMENT_SETTINGS: Readonly<Record<string, string>> = {
  deploymentProfile: 'PORTFOLIO_PROFILE',
  profile: 'PORTFOLIO_PROFILE',
  origin: 'PORTFOLIO_ORIGIN',
  canonicalOrigin: 'PORTFOLIO_ORIGIN',
  url: 'PORTFOLIO_ORIGIN',
  baseUrl: 'PORTFOLIO_ORIGIN',
  studio: 'PORTFOLIO_PROFILE',
  previewOrigin: 'PORTFOLIO_PREVIEW_ORIGIN',
  trustedProxies: 'PORTFOLIO_TRUSTED_PROXY_HOPS',
  proxy: 'PORTFOLIO_TRUSTED_PROXY_HOPS',
};

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
          severity: 'blocks-preview',
          document: 'portfolio',
          pointer: '',
          message: 'The validator failed before it could check this pair.',
          remediation:
            'This is a bug in the build, such as two content extensions with one namespace, not in the documents.',
        },
      ],
      notChecked: [],
    };
  }
}

function check(
  unit: { readonly portfolio: SourceDocument; readonly site: SourceDocument },
  ctx: Context,
): PublicationUnitResult {
  const options = { extensions: ctx.extensions };
  const portfolio = readPortfolio(unit.portfolio.text, unit.portfolio.format, options);
  const site = readSite(unit.site.text, unit.site.format, options);
  const diagnostics: Diagnostic[] = [];
  const notChecked: string[] = [];
  const add = (
    document: Diagnostic['document'],
    code: DiagnosticCode,
    found: { pointer: string; message: string; line?: number; column?: number },
    remediation = REMEDIATIONS[code],
  ) => {
    diagnostics.push({
      code,
      severity: DIAGNOSTIC_SEVERITIES[code],
      document,
      pointer: found.pointer,
      ...stableId(document, found.pointer, document === 'portfolio' ? portfolio.data : site.data),
      ...(found.line !== undefined ? { line: found.line, column: found.column } : {}),
      message: found.message,
      remediation,
    });
  };

  for (const problem of portfolio.problems)
    add('portfolio', problemCode(problem), located(problem));
  for (const problem of portfolio.duplicates) add('portfolio', 'id.duplicate', located(problem));
  for (const problem of site.problems) {
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
  for (const [document, read] of [
    ['portfolio', portfolio],
    ['site', site],
  ] as const) {
    secrets(read, (found) => add(document, 'secret.detected', found));
    for (const warning of read.warnings) {
      add(document, 'extension.unregistered', locatedWarning(warning));
    }
  }

  let pair: ParsedPair | null = null;
  if (portfolio.value && site.value && portfolio.locate && site.locate) {
    pair = { portfolio: portfolio.value, site: site.value };
    const locateIn = { portfolio: portfolio.locate, site: site.locate };
    const at = (document: Diagnostic['document'], path: readonly (string | number)[]) => ({
      pointer: toPointer(path),
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
      try {
        const result = validator.validate(pair, ctx);
        for (const diagnostic of result.diagnostics) {
          diagnostics.push({
            ...diagnostic,
            pointer: redactSecrets(diagnostic.pointer),
            message: redactSecrets(diagnostic.message),
          });
        }
        notChecked.push(...(result.notChecked ?? []));
      } catch {
        notChecked.push(`validator:${validator.id}`);
      }
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

function problemCode(problem: DocumentProblem): DiagnosticCode {
  switch (problem.kind) {
    case 'syntax':
      return 'parse.syntax';
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
  return match ? DEPLOYMENT_SETTINGS[match[1]!] : undefined;
}

/** The section a pointer is about: its id in the portfolio, its key in the site document. */
function stableId(document: Diagnostic['document'], pointer: string, data: unknown) {
  const [first, second] = pointer.split('/').slice(1);
  if (first !== 'sections' || second === undefined) return {};
  if (document === 'site') return { stableId: second };
  const sections = isPlainObject(data) ? data.sections : undefined;
  const section = Array.isArray(sections) ? sections[Number(second)] : undefined;
  return isPlainObject(section) && typeof section.id === 'string' ? { stableId: section.id } : {};
}

function secrets(
  read: DocumentRead<unknown>,
  report: (found: { pointer: string; message: string; line?: number; column?: number }) => void,
) {
  if (read.data === undefined || !read.locate) return;
  for (const finding of findSecrets(read.data)) {
    const pointer = toPointer(finding.path);
    const where = finding.in === 'key' ? `A key in ${pointer || 'the document'}` : pointer;
    report({
      pointer,
      message: `${where} looks like ${SECRET_LABELS[finding.kind]}. A document can't hold secrets.`,
      ...read.locate(finding.path),
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
    const pointer = toPointer(['appearanceInputs', schemeId]);
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
        `${toPointer(['sections', id])} names no section in the portfolio.`,
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
      report('portfolio', 'anchor.broken', path, `${toPointer(path)} links to no visible section.`);
    }
  }

  checkMetrics(portfolio, visible, report);

  const origin = canonicalHost(ctx.canonicalOrigin);
  if (origin === undefined) {
    notChecked.push('origin.sample', 'origin.stale');
    return;
  }
  for (const { path, url } of links) {
    const host = httpHost(url);
    if (host === undefined) continue;
    if (!isSampleHost(origin) && isSampleHost(host)) {
      report('portfolio', 'origin.sample', path, `${toPointer(path)} links to a sample address.`);
    } else if (isStaleHost(host, origin)) {
      report(
        'portfolio',
        'origin.stale',
        path,
        `${toPointer(path)} links to a host that differs from the configured origin's only in its last label.`,
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
  for (const stated of byKey.values()) {
    const [first, ...rest] = stated;
    for (const later of rest) {
      const where = `${toPointer(later.path)} and ${toPointer(first!.path)}`;
      if (!sameValue(later.value, first!.value)) {
        report(
          'portfolio',
          'metric.conflict',
          later.path,
          `${where} give one metric different values.`,
        );
      } else if (
        later.section !== first!.section &&
        visible[later.section] &&
        visible[first!.section]
      ) {
        report(
          'portfolio',
          'metric.duplicate',
          later.path,
          `${where} show one metric with the same value.`,
        );
      }
    }
  }
}

/** Numbers compare as numbers when both sides read as finite numbers, else as trimmed, case-insensitive text. */
function sameValue(a: string | number, b: string | number): boolean {
  const number = (value: string | number) => {
    const text = String(value).trim();
    const parsed = text === '' ? Number.NaN : Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const [x, y] = [number(a), number(b)];
  if (x !== undefined && y !== undefined) return x === y;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
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
