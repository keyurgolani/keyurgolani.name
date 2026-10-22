import type { ContentExtension } from './extensions';
import type { AppearanceAxis, AppearanceSelection } from './site';
import type { DocumentFormat } from './source';
import type { ParsedPair } from './view';

// What the publication-unit validator returns, and what its checks rely on
// (#4, items 13 to 15; #10). Types and the severities alone, so every check
// can name them without importing the validator.

export type DiagnosticSeverity = 'blocks-preview' | 'blocks-publish' | 'warning';

/** The pair's two documents. */
export type PairDoc = 'portfolio' | 'site';

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
  'media.syntax': 'blocks-preview',
  'media.invalid': 'blocks-preview',
  'source.missing': 'blocks-preview',
  'source.duplicate': 'blocks-preview',
  'source.unreadable': 'blocks-preview',
  'legacy.document': 'blocks-preview',
  'site.deployment-setting': 'blocks-preview',
  'appearance.unknown': 'blocks-preview',
  // The Markdown cap (#10): refused before anything renders the field.
  'markdown.too-long': 'blocks-preview',
  'markdown.too-deep': 'blocks-preview',
  'markdown.too-dense': 'blocks-preview',
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
