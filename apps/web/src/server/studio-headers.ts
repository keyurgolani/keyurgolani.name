import type { RuntimeMode } from './config';

// What proxy.ts adds to a Studio request and its response (#2). Studio's
// Content-Security-Policy goes on every /studio response with a fresh nonce,
// and on the request too, where Next reads the nonce and puts it on the
// scripts it renders. Studio renders none of the site's inline script or
// JSON-LD, so nothing else needs one. #7 and #8 may widen frame-src and
// img-src, and #9 add worker-src 'self' for the demo Studio, each for a
// documented need. Nothing else widens it.

/**
 * The paths Studio's pages live under: /studio, and anything below it, in
 * any case, as next.config.ts's header rules match them.
 */
export const STUDIO_PAGES = /^\/studio(?:\/|$)/i;

/**
 * Whether a request for `pathname` is for a Studio page path, read as the
 * route table reads one: percent-decoded, so /%73tudio is one too. A path
 * that doesn't decode is read as sent.
 */
export function isStudioPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Read as sent.
  }
  return STUDIO_PAGES.test(path);
}

/**
 * What every Studio response carries besides its CSP, under a profile with
 * a Studio page (#2). Referrer-Policy: same-origin, since no-referrer would
 * null the Origin of the sign-in form's post, and
 * Cross-Origin-Resource-Policy: same-origin, so a page on a sibling origin,
 * such as the demo, can't load one with a no-cors fetch to tell a signed-in
 * owner from a signed-out one.
 */
export const STUDIO_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'referrer-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});

/**
 * The request header proxy.ts sets on a GET or HEAD it answers as a path no
 * route matches: a Studio page under a profile with none, a route spelled
 * with a fixed segment percent-encoded, or a missing path that is a route
 * file's own, as sent or decoded whole. next.config.ts's rewrite sends it to
 * Next's 404 page, so the path answers as any unknown one does. proxy.ts
 * drops it from every other request, so a client can't set it.
 */
export const NOT_FOUND_HEADER = 'x-portfolio-not-found';

/**
 * The request header proxy.ts sets to the Studio path and query asked for,
 * where requireOwnerPage reads where to come back to after sign-in. It
 * drops the header from every request first, so a client can't set it.
 */
export const STUDIO_PATH_HEADER = 'x-studio-path';

/** A nonce for one response: 16 random bytes, in base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy for one Studio response. `next dev` needs 'unsafe-eval', which
 * React uses there to rebuild server error stacks. A production build never
 * gets it. Studio frames its own origin's previews, and a configured preview
 * origin's (#7, Slice 4), and nothing else.
 */
export function studioCsp(nonce: string, mode: RuntimeMode, previewOrigin?: string): string {
  const evaluation = mode === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evaluation}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    previewOrigin === undefined ? "frame-src 'self'" : `frame-src 'self' ${previewOrigin}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}
