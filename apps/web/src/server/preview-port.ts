import type { Readable } from 'node:stream';
import type { AppearanceSelection, PublicView } from '@portfolio/schema';
import type { DerivedScheme } from '~/lib/derived-schemes';
import type { Session } from './session';

// Types for #7's preview grants that config-store.ts, the composition root,
// the preview routes, and proxy.ts name without importing owner code. Only
// the composition root's owner branch binds a PreviewGrantsPort, so under
// demo and read-only there's none, and no grant path is served.

/** What the owner's auth provider gives the grants of its sessions (#2). */
export interface GrantSessionPort {
  /**
   * The session the dispatcher resolved for this request, by the Session the
   * provider minted for it: its digest and when it ends regardless, or null
   * once it ended during the request.
   */
  of(
    session: Session | null,
  ): { readonly digest: string; readonly absoluteExpiresAt: number } | null;
  /** Whether the session `digest` names still counts, read without sliding it. */
  resolveDigest(digest: string): Promise<{ readonly status: 'valid' | 'ended' | 'unavailable' }>;
  /** Called with the digest of each session that ends in this process. Returns an unsubscribe. */
  onSessionEnded(listener: (digest: string) => void): () => void;
}

/** One document of a pair a grant can render, as written: its format and its text. */
export interface PreviewDocumentSource {
  readonly format: 'yaml' | 'json';
  readonly sourceText: string;
}

/** A #5 contract fixture, which a fixture grant renders: its pair, and what sits beside it. */
export interface PreviewFixture {
  readonly portfolio: PreviewDocumentSource;
  readonly site: PreviewDocumentSource;
  /** Its media document (#10), as written. */
  readonly media?: PreviewDocumentSource;
  /** Its snapshots by kind, as plain JSON, which the view checks itself. */
  readonly snapshots?: Readonly<Record<string, unknown>>;
}

/** The environment a frame starts in, as its grant holds it (Slice 4's controls). */
export interface PreviewEnvironment {
  readonly displayMode: 'system' | 'light' | 'dark' | 'high-contrast';
  readonly contrast: 'system' | 'more';
  readonly motion: 'system' | 'reduce';
  readonly enhancement: 'on' | 'off';
}

/** A grant's document, once its check passed. */
export interface OpenedGrant {
  /** The public view of what it renders, with the frame's appearance override. */
  readonly view: PublicView;
  /** The frame's environment at its first paint. */
  readonly environment: PreviewEnvironment;
  /** The channel nonce Studio got at mint, for the agent's handshake (Slice 3). */
  readonly nonce: string;
  /** The version the agent's `ready` says the frame renders: a draft grant's pinned version, or null. */
  readonly renderedVersion: number | null;
  /** What a log line calls the grant: the first 8 hex characters of its digest. */
  readonly ref: string;
  /**
   * The generated schemes the grant's own subject stored (#20 PR 3), each
   * checked by readDerivedSchemes(): its pinned revision's or fixture's
   * `snapshots.schemes`. Never the request's, and never another grant's. A
   * draft grant has none until #10's 10h pins its `derived.schemes` at mint.
   */
  readonly schemes?: Readonly<Record<string, DerivedScheme>>;
}

/** The grants, as the owner composition binds them into the deployment state (#7, Slice 2). */
export interface PreviewGrantsPort {
  /**
   * The per-request check proxy.ts makes before Next routes a grant path,
   * from the grant alone: whether it is active now. It never throws; a store
   * it can't read admits nothing.
   */
  admit(grant: string): Promise<boolean>;
  /**
   * The same check again, for the page, and what the grant renders: null
   * when the grant isn't active. It throws when an active grant's content
   * can't be read or no longer validates, which the page answers with its
   * render failure.
   */
  open(grant: string): Promise<OpenedGrant | null>;
  /**
   * The same check, and what the agent's channel needs (Slice 3), without
   * reading what the grant renders: null when the grant isn't active. A
   * frame whose content fails to render still opens its channel, to tell
   * Studio so with the log's reference.
   */
  channel(grant: string): Promise<GrantChannel | null>;
  /**
   * What /studio/preview offers to preview (Slice 4): the working draft's
   * latest version and the live revision, each with the variant its site
   * selects. They're read under preview.grant, authorized again from the
   * page's session, as a grant's own reads are from its bound one, so this
   * module needn't import authorize.ts, which reads the config store that
   * holds this port. Empty when there's neither, or the session doesn't
   * reach preview.grant.
   */
  previewable(session: Session | null): Promise<readonly Previewable[]>;
  /**
   * A rendition the grant's view keeps (#10), at the media path below
   * /preview-assets/<grant>/: `<assetId>/<sha256>/<rendition>.<ext>`. The
   * same check as open(), and the media the grant pinned, never what's live
   * or what the draft holds now. Null when the grant isn't active or the
   * path names nothing it keeps.
   */
  asset(grant: string, segments: readonly string[]): Promise<PreviewAsset | null>;
}

/** A rendition a grant's view keeps: its record's type and size, and its blob's bytes. */
export interface PreviewAsset {
  readonly assetId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly blob: `sha256:${string}`;
  /** The blob's bytes, or null when the AssetStore doesn't hold it. */
  open(): Promise<Readable | null>;
}

/** What a frame's agent needs to open its channel to Studio. */
export interface GrantChannel {
  readonly nonce: string;
  readonly renderedVersion: number | null;
}

/** Something a grant can be minted of, as Studio's content control offers it. */
export type Previewable =
  | {
      readonly kind: 'draft';
      readonly subject: { readonly draft: string; readonly version: number };
      readonly variant: string | null;
      /** The appearance its site selects, which a frame's override starts from, or null. */
      readonly appearance: AppearanceSelection | null;
    }
  | {
      readonly kind: 'revision';
      readonly subject: { readonly revision: string };
      readonly variant: string | null;
      readonly appearance: AppearanceSelection | null;
    };
