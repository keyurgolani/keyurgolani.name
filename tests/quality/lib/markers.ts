// The quality build's fixture markers (#11, Slice 1, item 6), and the
// fail-closed check on them. A build made with QUALITY_FIXTURES carries
// data-quality-fixture="<id>" on <html> and an x-quality-fixture header on
// every response, 404, 503, and Studio routes included, keyed on the
// build-time FIXTURE_FLAGS.quality, so a cell can tell it's testing the
// quality build and not a production one. A response without them fails
// the cell.
//
// The host files that place them (the root layouts, global-not-found,
// global-error, and proxy.ts for the header, since the proxy's own answers
// never get next.config.ts headers) are stream A's, and change tonight with
// #6 slice 2 and #7 slice 4, so the markers land last, after the lead's
// sign-off. Until then HOST_MARKERS is 'stand-in': the quality fixture
// adds both markers to the app's responses in the browser (standInMarkers),
// so every cell runs the same check it will run against the host, and
// summary.json says the markers are the stand-in's. Setting it to 'host'
// drops the stand-in; nothing else changes.

/** The header every response of a quality build carries. */
export const MARKER_HEADER = 'x-quality-fixture';

/** The attribute on every quality build document's <html>. */
export const MARKER_ATTRIBUTE = 'data-quality-fixture';

/** The id both carry in a build made with QUALITY_FIXTURES=1. */
export const MARKER_ID = 'quality';

/** Who places the markers: the host, or, until its change lands, the quality fixture's stand-in. */
export const HOST_MARKERS: 'host' | 'stand-in' = 'stand-in';

/** One response, as the marker check reads it. */
export interface MarkedResponse {
  readonly url: string;
  readonly status: number;
  /** Header names lowercased, as Playwright gives them. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * What's wrong with the markers: each response without the header, or with
 * another id, and the document when its <html> lacks the attribute. Empty
 * when every response carries both.
 *
 * @param documentMarker the <html> attribute's value, or null without one
 */
export function markerProblems(
  responses: readonly MarkedResponse[],
  documentMarker: string | null,
  expected: string = MARKER_ID,
): string[] {
  const problems: string[] = [];
  if (responses.length === 0) problems.push('no response from the app was seen');
  for (const { url, status, headers } of responses) {
    const value = headers[MARKER_HEADER];
    if (value === undefined) problems.push(`${status} ${url} has no ${MARKER_HEADER} header`);
    else if (value !== expected) {
      problems.push(`${status} ${url} has ${MARKER_HEADER}: ${value}, not ${expected}`);
    }
  }
  if (documentMarker === null) problems.push(`<html> has no ${MARKER_ATTRIBUTE}`);
  else if (documentMarker !== expected) {
    problems.push(`<html> has ${MARKER_ATTRIBUTE}="${documentMarker}", not ${expected}`);
  }
  return problems;
}

/** The document's marker as the page has it: the <html> attribute's value, or null. */
export function documentMarkerScript(attribute: string): string | null {
  return document.documentElement.getAttribute(attribute);
}

/**
 * The stand-in's rewrite of one app response: the header added, and for a
 * document, the attribute put on its <html> tag. The host's change replaces
 * it; until then cells pass their marker check only through it.
 */
export function standInMarkers(
  headers: Readonly<Record<string, string>>,
  body: Buffer,
  id: string = MARKER_ID,
): { headers: Record<string, string>; body: Buffer } {
  // The body goes back decoded and maybe longer, so its length and
  // encoding are the browser's to work out again.
  const marked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name !== 'content-length' && name !== 'content-encoding') marked[name] = value;
  }
  marked[MARKER_HEADER] = id;
  if (!(headers['content-type'] ?? '').startsWith('text/html')) return { headers: marked, body };
  const text = body.toString('utf8');
  const html = text.replace(/<html(?=[\s>])/i, `<html ${MARKER_ATTRIBUTE}="${id}"`);
  return { headers: marked, body: Buffer.from(html, 'utf8') };
}
