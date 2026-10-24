import type { RuntimeMode } from './config';

// The Content-Security-Policy of the public site (#6, item 8): what proxy.ts
// sends on every response that isn't Studio's or a preview's, with a fresh
// nonce it also puts on the request, so Next puts it on the scripts it
// renders. No script runs that the response didn't send with its nonce, or
// that one of those loaded, and nothing loads from another host. The site
// renders no inline script of its own: its JSON-LD goes out as a data
// block, `application/ld+json`, which no policy governs since it never
// runs, and #19 slice 4 took the theme script out. next.config.ts keeps its
// baseline policy for what Next answers before proxy.ts runs, and proxy.ts
// takes its place everywhere else, so each response carries one.

/**
 * Where a page's images and media load from (#10): the site's own /media,
 * /_portfolio/still/ for a catalog still (#6), or a data: URL, and never a
 * remote host. The baseline, the public policy, and a preview's all use it.
 */
export const MEDIA_DIRECTIVES = ["img-src 'self' data:", "media-src 'self'"] as const;

/** next.config.ts's policy, for what Next answers before proxy.ts sees the request. */
export const BASELINE_CSP = ["frame-ancestors 'none'", ...MEDIA_DIRECTIVES].join('; ');

/**
 * The policy for one public response. `'self'` beside the nonce in
 * `script-src` is for a browser without `'strict-dynamic'`, which ignores
 * it otherwise, so it can still load the chunks Next's runtime adds. Styles
 * are the site's own files, and inline: the kit's spatial effects render a
 * `<style>` of their own, and React's style props set attributes. `next
 * dev` adds `'unsafe-eval'`, which React uses there to rebuild server error
 * stacks, and a production build never does.
 */
export function publicCsp(nonce: string, mode: RuntimeMode): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${mode === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    ...MEDIA_DIRECTIVES,
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
