// The headers every response carries, by path (#1 item 22, #2, #6, #7):
// the baseline next.config.ts sends, the public site's nonce CSP proxy.ts
// sends in place of its CSP (#6, item 8), Studio's own, and the preview's.
// Under a profile with a Studio page, Studio pages get Studio's nonce CSP
// from proxy.ts in place of the public one, and Referrer-Policy: same-origin and
// Cross-Origin-Resource-Policy: same-origin; under another profile they get
// what any path gets. Studio's transport gets same-origin for both in every
// profile, and every Studio response asks for no-store. Every preview path,
// in every profile, gets the preview's nonce CSP, noindex, no-referrer, and
// private, no-store. Only the build's assets and /_portfolio allow any
// origin. Paths match in any case, as Next matches header sources. The
// profile matrix and the profile smoke check responses against these.
// headers.test.ts and proxy.test.ts check next.config.ts and proxy.ts
// themselves.

/**
 * The public site's CSP in production (#6, item 8), with its nonce: 16
 * random bytes in base64. Every response proxy.ts sends outside Studio and
 * preview carries it, Studio's transport included.
 */
export const PUBLIC_CSP =
  /^default-src 'self'; script-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'$/;

/** The headers a path outside Studio and preview carries, its policy with one nonce for the example. */
export const BASELINE_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'nonce-MVlEoQyHU2PoMq1Imu8oSA==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
});

/** A Studio page's CSP in production, with its nonce: 16 random bytes in base64. */
export const STUDIO_CSP =
  /^default-src 'self'; script-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'$/;

/**
 * A preview response's CSP in production (#7), with its nonce on scripts
 * and styles alike, and one origin, Studio's, that may frame it.
 */
export const PREVIEW_CSP =
  /^default-src 'none'; script-src 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic'; style-src 'self' 'nonce-\1'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors (https?:\/\/[a-z0-9.-]+(?::\d+)?)$/;

/** A response's nonce, as a policy, an attribute, a Link header, or Next's payload carries it. */
const NONCE = /('nonce-|nonce=\\?"|nonce=|\\?"nonce\\?":\\?")([A-Za-z0-9+/]{22}==)/g;

/**
 * `text` with each nonce in it as `<nonce>`, so two answers that differ in
 * nothing but the nonce each response gets (#2, #6, #7) compare equal.
 *
 * @param {string} text
 */
export function withoutNonces(text) {
  return text.replace(NONCE, '$1<nonce>');
}

/** What every preview response carries besides its CSP (#7). */
export const PREVIEW_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
});

/** `pathname` percent-decoded, as the route table reads it, or as sent when it doesn't decode. */
function decoded(/** @type {string} */ pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Whether `pathname` is a preview path: /preview or /preview-assets, or
 * below either, in any case, read percent-decoded (#7).
 *
 * @param {string} pathname
 */
export const isPreviewPath = (pathname) =>
  /^\/preview(?:-assets)?(?:\/|$)/i.test(decoded(pathname));

/**
 * Whether `pathname` is under /_next/static or /_portfolio, in any case, as
 * next.config.ts's header rules match them: the only paths that allow any
 * origin (#7). proxy.ts answers any method or spelling there that Next
 * doesn't serve a file for with its plain 404.
 *
 * @param {string} pathname
 */
export const isSharedAsset = (pathname) =>
  /^\/(?:_next\/static|_portfolio)(?:\/|$)/i.test(pathname);

/**
 * Whether `pathname` is a Studio page path: /studio or under it, in any case,
 * read percent-decoded as the route table reads it, so /%73tudio is one too.
 *
 * @param {string} pathname
 */
export function isStudioPath(pathname) {
  return /^\/studio(?:\/|$)/i.test(decoded(pathname));
}

/** Whether `pathname` is Studio's transport: /api/studio or under it, in any case. */
export const isStudioTransport = (/** @type {string} */ pathname) =>
  /^\/api\/studio(?:\/|$)/i.test(pathname);

/**
 * What is wrong with the headers of a response to `pathname`, or nothing.
 * `headers` holds lowercase names. `studio` says whether the profile serves
 * a Studio page, as owner does: under one that doesn't, a Studio path is as
 * unknown as any other. `origin`, the app's PORTFOLIO_ORIGIN, is the one
 * origin a preview's frame-ancestors may name.
 *
 * @param {string} pathname
 * @param {Readonly<Record<string, string | undefined>>} headers
 * @param {{ studio?: boolean, origin?: string }} [options]
 * @returns {string[]}
 */
export function headerProblems(pathname, headers, { studio: served = true, origin } = {}) {
  const problems = [];
  const expect = (/** @type {string} */ name, /** @type {string | undefined} */ value) => {
    if (headers[name] !== value) problems.push(`${name} is ${headers[name]}, not ${value}`);
  };
  const publicPolicy = () => {
    const csp = headers['content-security-policy'];
    if (csp === undefined || !PUBLIC_CSP.test(csp)) {
      problems.push(`content-security-policy is ${csp}, not the public site's nonce CSP`);
    }
  };
  expect('x-content-type-options', 'nosniff');
  expect('access-control-allow-origin', isSharedAsset(pathname) ? '*' : undefined);
  const studio = served && isStudioPath(pathname);
  const transport = isStudioTransport(pathname);
  if (isPreviewPath(pathname)) {
    for (const [name, value] of Object.entries(PREVIEW_HEADERS)) expect(name, value);
    expect('cross-origin-resource-policy', undefined);
    const csp = headers['content-security-policy'];
    const policy = csp === undefined ? null : PREVIEW_CSP.exec(csp);
    if (!policy) {
      problems.push(`content-security-policy is ${csp}, not the preview's nonce CSP`);
    } else if (origin !== undefined && policy[2] !== origin) {
      problems.push(`frame-ancestors is ${policy[2]}, not ${origin}`);
    }
    return problems;
  }
  if (studio) {
    expect('referrer-policy', 'same-origin');
    expect('cross-origin-resource-policy', 'same-origin');
    const csp = headers['content-security-policy'];
    if (csp === undefined || !STUDIO_CSP.test(csp)) {
      problems.push(`content-security-policy is ${csp}, not Studio's nonce CSP`);
    }
  } else if (transport) {
    expect('referrer-policy', 'same-origin');
    expect('cross-origin-resource-policy', 'same-origin');
    publicPolicy();
  } else {
    expect('referrer-policy', BASELINE_HEADERS['referrer-policy']);
    publicPolicy();
    expect('cross-origin-resource-policy', undefined);
  }
  // A dynamic page's Cache-Control is Next's, which has no-store among its
  // directives; the transport's and proxy.ts's own answers are no-store alone.
  if (
    (studio || transport) &&
    !/(?:^|,)\s*no-store\s*(?:,|$)/.test(headers['cache-control'] ?? '')
  ) {
    problems.push(`cache-control is ${headers['cache-control']}, without no-store`);
  }
  return problems;
}
