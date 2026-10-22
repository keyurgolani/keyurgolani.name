import type { Portfolio, Site } from '@portfolio/schema';

// The CatalogReader port (#1, item 3; #3, item 19): where the site's
// published catalog comes from. The web app reads it only through
// apps/web/src/server/catalog.ts, once per request. read-only serves its
// mounted documents through SourceCatalogReader, owner the revision store
// through RevisionCatalogReader, and demo the bundled sample. Types only.

/**
 * What a revision publishes, as the site renders it: plain models, so
 * @portfolio/schema's renderers and #10's view take them as they are.
 */
export interface PublicationUnit {
  readonly portfolio: Portfolio;
  readonly site: Site;
  /** The media document's model (#10). Absent until #10 adds one. */
  readonly media?: unknown;
  /** Derived data by kind, as the revision or snapshots/<kind>.json holds it: #5's controls, #10's, #19's. */
  readonly snapshots: Readonly<Record<string, unknown>>;
}

/**
 * What visitors get. `live`: the revision the pointer names. `degraded`:
 * the last known good in place of a live revision that can't be served.
 * `incompatible`: nothing this build can serve. `empty`: nothing published
 * yet. Under the last two nothing is servable, and visitor routes answer 503.
 */
export type ServingState = 'live' | 'degraded' | 'incompatible' | 'empty';

/** What one request renders: every part of a response reads this one result. */
export type LiveRevision =
  | {
      readonly state: 'live' | 'degraded';
      /** The serving revision: the live one, or the last known good in its place. */
      readonly revisionId: string;
      /** The serving revision's unitHash. */
      readonly unitHash: string;
      readonly unit: PublicationUnit;
    }
  | {
      readonly state: 'incompatible' | 'empty';
      readonly revisionId: null;
      readonly unitHash: null;
      readonly unit: null;
    };

export interface CatalogReader {
  getLive(): Promise<LiveRevision>;
}

/**
 * Where the live manifest's rendering differs from the build's (#3, item
 * 21): a variant or pack at another version, or one the build lacks, or a
 * contract at another version.
 */
export interface RenderDrift {
  readonly kind: 'variant' | 'pack' | 'contract';
  readonly id: string;
  /** What the live revision recorded. */
  readonly revision: string;
  /** What this build has, or null when it has none. */
  readonly build: string | null;
}

/** The serving state with the IDs behind it, for the owner's config.status and live.get. */
export interface CatalogStatus {
  readonly state: ServingState;
  /** What the published pointer names: null before anything is published, or when the pointer can't be read. */
  readonly liveRevisionId: string | null;
  /** What's served: the live revision, the last known good, or null. */
  readonly servingRevisionId: string | null;
  /** The pointer's seq. */
  readonly seq: number | null;
  /** The pointer's unitHash. */
  readonly unitHash: string | null;
  /** Why the live revision isn't served, when it isn't, such as `damaged:hash_mismatch`. */
  readonly reason?: string;
  /** How the live manifest's rendering differs from the build's, or null when it doesn't. */
  readonly renderDrift: readonly RenderDrift[] | null;
}

/** Called with whether anything is servable each time the reader decides, so visitor routes can answer 503. */
export type SetServable = (servable: boolean) => void;
