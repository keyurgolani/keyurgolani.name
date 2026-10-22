import type { PublicView } from '@portfolio/schema';
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

/** A #5 contract fixture's pair, which a fixture grant renders. */
export interface PreviewFixture {
  readonly portfolio: PreviewDocumentSource;
  readonly site: PreviewDocumentSource;
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
  /** What a log line calls the grant: the first 8 hex characters of its digest. */
  readonly ref: string;
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
}
