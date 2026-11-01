import type { Session } from './session';

// Types config-store.ts names without importing the dispatcher or the
// owner provider back.

/** The Studio transport's dispatcher: runs the named operation for one request. */
export type Dispatch = (request: Request, name: string) => Promise<Response>;

/** What a Studio page request's session cookie comes to (#2). */
export type PageResolution =
  /** No session cookie came at all. */
  | { readonly status: 'none' }
  /** A cookie came and counts for nothing: it ended, no session has it, or it came twice. */
  | { readonly status: 'ended' }
  /** The session store couldn't be read. */
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'valid';
      readonly session: Session;
      /** The session's CSRF token, for the page's own commands. */
      readonly csrfToken: string;
    };

/**
 * How Studio pages find their session, from the owner provider. Only the
 * composition root's owner branch binds it, and requireOwnerPage reads it
 * from the deployment state.
 */
export interface StudioPages {
  /**
   * The session `request` carries, slid when the request is a page the
   * owner opened (`slides()` in @portfolio/core). The request is the page
   * request's own headers, at the path asked for.
   */
  resolve(request: Request): Promise<PageResolution>;
}
