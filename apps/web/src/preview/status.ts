// The preview's status documents (#7, Slice 2, items 8 and 9). Every
// request under /preview and /preview-assets that the grant check turns
// away gets the first one, from proxy.ts: a grant that isn't active, a
// top-level or wrong-destination request, a path no grant route serves, and
// anything but a GET or HEAD. It's its own document, never the site's 404:
// no theme script, no host chrome or stylesheet, no script at all, and no
// link, id, path, or error text, so it tells a guess nothing, and its answer
// is the same whatever the grant's state. proxy.ts sends the preview's
// headers with it. A render failure under an active grant gets the second
// text, with a reference the server log carries too. It imports nothing, so
// proxy.ts, the routes, and the error boundary can all use it.

/** What a frame shows when its grant doesn't let it render. */
export const PREVIEW_UNAVAILABLE_TEXT = 'This preview is not available. Open it from Studio.';

/** What a frame shows when an active grant's content fails to render. */
export const PREVIEW_FAILED_TEXT = "This preview couldn't be shown.";

/** The status document, whole. */
export const PREVIEW_STATUS_DOCUMENT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex, nofollow">',
  '<title>Preview not available</title>',
  '</head>',
  '<body>',
  '<main>',
  `<p>${PREVIEW_UNAVAILABLE_TEXT}</p>`,
  '</main>',
  '</body>',
  '</html>',
  '',
].join('\n');

/** Its status, 404, the same for every reason. */
export const PREVIEW_STATUS = 404;

/** Its Content-Type. */
export const PREVIEW_STATUS_TYPE = 'text/html; charset=utf-8';
