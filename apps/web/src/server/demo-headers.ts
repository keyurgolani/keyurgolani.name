import type { RuntimeMode } from './config';

// The demo deployment's Content-Security-Policy (#9, Slice 1 item 6):
// what proxy.ts sends, with a fresh nonce, on the pages a demo visitor
// works in. That's the showroom at /, the sample under /sample, the
// read-only reference under /reference (#9's second pull request), and Demo
// Studio under /studio, which the route table gives demo with #9's second
// pull request. It is Studio's nonce policy (#2), plus `worker-src 'self'`
// for the browser-side import worker #9 adds, with `form-action` narrowed to
// 'none', since nothing on a demo page submits a form anywhere. Only /sample
// may be framed, and only by the demo's own pages: Studio's preview frames
// and the showroom's. Every other demo path keeps the public policy. This
// module imports nothing, so proxy.ts can load it.

/** Who may frame a demo page: its own origin for /sample, and no one else anywhere. */
export type DemoFraming = "'self'" | "'none'";

/**
 * Whether `pathname`, read percent-decoded as the route table reads it, is
 * the showroom, under /sample, or under /reference, the read-only
 * reference's pages and renditions (#9), which no page may frame.
 */
export function demoPagePath(pathname: string): 'showroom' | 'sample' | 'reference' | null {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Read as sent.
  }
  if (path === '/') return 'showroom';
  if (/^\/sample(?:\/|$)/.test(path)) return 'sample';
  return /^\/reference(?:\/|$)/.test(path) ? 'reference' : null;
}

/**
 * The policy for one demo response. `next dev` needs 'unsafe-eval', which
 * React uses there to rebuild server error stacks; a production build never
 * gets it. Demo Studio frames /sample, its own origin, and nothing else.
 */
export function demoCsp(nonce: string, mode: RuntimeMode, framing: DemoFraming): string {
  const evaluation = mode === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evaluation}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-src 'self'",
    `frame-ancestors ${framing}`,
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}
