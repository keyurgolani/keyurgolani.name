import type { RuntimeMode } from './config';

// What proxy.ts sends on every response under /preview and /preview-assets
// (#7, Slice 1, item 5), status pages, 404s, and the plain answers included:
// a Content-Security-Policy with a fresh nonce, which proxy.ts sets on the
// request too, so Next puts the nonce on its own scripts and styles, and the
// headers that keep a preview out of search results, shared caches, and
// other sites' frames and Referer. next.config.ts sends neither its baseline
// CSP nor its Referrer-Policy on these paths, so each response carries
// exactly one of each. Preview routes read no cookies (item 4): proxy.ts
// drops the Cookie header before Next routes the request.

/**
 * The paths previews live under: /preview and /preview-assets, and anything
 * below them, in any case, as next.config.ts's header rules match them.
 */
export const PREVIEW_PATHS = /^\/preview(?:-assets)?(?:\/|$)/i;

/**
 * Whether a request for `pathname` is for a preview path, read as the route
 * table reads one: percent-decoded, so /%70review is one too. A path that
 * doesn't decode is read as sent. It covers every path next.config.ts's
 * header rules treat as a preview's, so none goes out without a CSP.
 */
export function isPreviewPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Read as sent.
  }
  return PREVIEW_PATHS.test(path);
}

/** Who may frame a preview, and how strict its policy is. */
export interface PreviewPolicyOptions {
  /** `next dev` adds what React's dev build and hot reloading need. A production build never does. */
  readonly mode: RuntimeMode;
  /**
   * Studio's origin, the deployment's canonical origin, the one page that
   * frames a preview. Before startup there is none, and nothing may frame it.
   */
  readonly studioOrigin?: string;
}

/**
 * The policy for one preview response. `img-src` and `media-src` allow
 * https: while content still hot-links remote media; #10 narrows them to
 * 'self'. `style-src-attr` covers React's style props.
 */
export function previewCsp(nonce: string, { mode, studioOrigin }: PreviewPolicyOptions): string {
  const development = mode === 'development';
  return [
    "default-src 'none'",
    // React's dev build rebuilds server error stacks with eval.
    `script-src 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' https: data:",
    "media-src 'self' https:",
    // Hot reloading's socket and the dev overlay's requests, under next dev only.
    `connect-src ${development ? "'self'" : "'none'"}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${studioOrigin ?? "'none'"}`,
  ].join('; ');
}

/** What every preview response carries besides its CSP. */
export const PREVIEW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
});

/** Every header a preview response carries, `csp` among them. */
export function previewHeaders(csp: string): Record<string, string> {
  return { ...PREVIEW_RESPONSE_HEADERS, 'content-security-policy': csp };
}
