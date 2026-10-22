import type { SecretKind } from '../secrets';
import type { DocumentFormat } from '../source';
import type { Diagnostic } from '../validate';
import type { AssignedId } from './section-ids';

/** An id the step minted: a record's or a media asset's. */
export interface MintedId {
  readonly id: string;
  readonly owner: 'work' | 'evidence' | 'chronology' | 'media';
  /** Where it is in the new portfolio. */
  readonly pointer: string;
  /** What it came from in the old one. */
  readonly from: string;
}

/** Where a value went: a JSON pointer into the new portfolio or site document. */
export interface Target {
  readonly document: 'portfolio' | 'site';
  readonly pointer: string;
}

/** One thing the migration did. Notes never quote the document; `value` may. */
export interface Change {
  /**
   * `moved`: same value, new home. `mapped`: a new value for the old one.
   * `default`: filled where the old file had nothing. `removed`: gone,
   * with nowhere to go. `dropped`: a key the old schema dropped too.
   * `set`: from `--set`. `warned`: carried over, with something to look at,
   * such as an image with no alt text or a stat whose value isn't a number.
   */
  readonly code: 'moved' | 'mapped' | 'default' | 'removed' | 'dropped' | 'set' | 'warned';
  /** Pointer into the old file, and where that is in its text. */
  readonly from?: string;
  readonly line?: number;
  readonly column?: number;
  readonly to?: Target;
  readonly value?: string;
  readonly note: string;
}

/** Why a value the owner has to give isn't filled in. */
export interface NeedReason {
  readonly reason: string;
  /** The old file's value, when it had one. */
  readonly was?: string;
}

/** A value only the owner can give, with `--set <path>=<value>`. */
export interface Need extends NeedReason {
  /** Such as `site.appearance.colorScheme`. */
  readonly path: string;
  /** The ids this build accepts there, when there's a list to ask. */
  readonly accepts?: readonly string[];
}

/** A key the old schema dropped when it read the file. */
export interface UnknownKey {
  readonly pointer: string;
  readonly line?: number;
  readonly column?: number;
}

/** A `--set` value: `<portfolio|site>.<dot.path>=<value>`. Values are strings. */
export interface SetValue {
  readonly path: string;
  readonly value: string;
}

/** Where the old file, or a `--set` value, holds secret-shaped text. Never the text. */
export interface SecretSpot {
  readonly kind: SecretKind;
  /** A value or a key at `pointer`, a YAML comment, or the `--set` value for `path`. */
  readonly in: 'value' | 'key' | 'comment' | 'set';
  /** For a value, the pointer to it; for a key, to the object that has it. Redacted. */
  readonly pointer?: string;
  /** For a `--set` value, its path. */
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
}

/** The documents the migration would write, and everything it found doing it. */
export interface MigrationPlan {
  /** `ready`: nothing stops writing. `blocked`: see needs, unknown, and diagnostics. */
  readonly status: 'ready' | 'blocked';
  /** 1 for the old one-file format, 2 for a version 2 portfolio document. */
  readonly from: number;
  readonly to: number;
  readonly format: DocumentFormat;
  readonly portfolio: { readonly data: unknown; readonly text: string };
  /**
   * The site document, for the old one-file format. A version 2 portfolio
   * document's site document doesn't change, so a plan for one has none.
   */
  readonly site?: { readonly data: unknown; readonly text: string };
  /** The old file's text, for the diff. */
  readonly source: string;
  readonly changes: readonly Change[];
  /** The section ids the old one-file format got. Empty for a version 2 document, whose ids stay. */
  readonly ids: readonly AssignedId[];
  /** The record and media ids the 2-to-3 step minted, once, in document order. */
  readonly minted: readonly MintedId[];
  readonly needs: readonly Need[];
  readonly unknown: readonly UnknownKey[];
  /** Whether `unknown` keys are dropped from the new documents, as with `--drop-unknown`. */
  readonly dropUnknown: boolean;
  /**
   * The new pair's own diagnostics. Values still needed are filled with
   * placeholders for the check, and the records at their pointers left out.
   */
  readonly diagnostics: readonly Diagnostic[];
  /** The checks the pair didn't get, such as the link checks without an origin. */
  readonly notChecked: readonly string[];
  /** Lines of the old file's comments, which the new documents don't keep. */
  readonly comments: readonly number[];
  /**
   * Secret-shaped text in the old file, dropped keys and comments included,
   * or in a `--set` value. While there's any, the report shows no value, no
   * diff, and neither document.
   */
  readonly secrets: readonly SecretSpot[];
  /** The origin `meta.url` named, a starting point for PORTFOLIO_ORIGIN. */
  readonly origin?: string;
}

export type Migration =
  /** The file is already at this release's version: a version 3 portfolio, or a version 2 site document. */
  | { readonly status: 'current'; readonly document: 'portfolio' | 'site' }
  /**
   * The file can't be migrated: it doesn't parse, or it isn't the old format
   * or a version a step reads. `summary` has the reasons without any value
   * from the file, for a log.
   */
  | {
      readonly status: 'failed';
      readonly reasons: readonly string[];
      readonly summary?: readonly string[];
    }
  | MigrationPlan;

/** One stored document: its text and format, as #3 keeps it. */
export interface StoredDocument {
  readonly text: string;
  readonly format: DocumentFormat;
}

/** A stored publication unit's documents (#3): the pair, and from slice 2 on, the media document. */
export interface StoredUnit {
  readonly portfolio: StoredDocument;
  readonly site: StoredDocument;
  /** #10's derived media catalog. Passed through as it is: no step changes it yet. */
  readonly media?: StoredDocument;
}

/** What migrateDocuments() would make of a stored unit. */
export interface UnitMigrationPlan {
  /** `ready`: nothing stops writing. `blocked`: see needs and diagnostics. */
  readonly status: 'ready' | 'blocked';
  readonly from: { readonly portfolio: number; readonly site: number };
  readonly to: { readonly portfolio: number; readonly site: number };
  /** Every document in its own format. One no step changes comes back byte for byte. */
  readonly documents: {
    readonly portfolio: StoredDocument;
    readonly site: StoredDocument;
    readonly media?: StoredDocument;
  };
  readonly changes: readonly Change[];
  readonly minted: readonly MintedId[];
  readonly needs: readonly Need[];
  readonly diagnostics: readonly Diagnostic[];
  readonly notChecked: readonly string[];
  /** Portfolio source lines whose comments the new text doesn't keep. */
  readonly comments: readonly number[];
  readonly secrets: readonly SecretSpot[];
}

export type UnitMigration =
  /** Both documents are at this release's versions. */
  | { readonly status: 'current' }
  /** Text that doesn't parse, or a version no step reads. `summary` carries no document value, for a log. */
  | {
      readonly status: 'failed';
      readonly reasons: readonly string[];
      readonly summary: readonly string[];
    }
  | UnitMigrationPlan;
