// The canaries the leak scans seed (#1, Verification item 2), shared by the
// profile matrix against the built server and `pnpm smoke:profiles` against
// the image. No response may carry one, in a body or a header.

/**
 * The directory holding a _FILE the server reads at startup, so the path it
 * read holds a canary: PORTFOLIO_TRUSTED_PROXY_HOPS_FILE, which every profile
 * takes, set to 0, the default.
 */
export const CANARY_SECRET = 'canary-secret-5d81c2e7';
/** The read-only and owner source directory's name, so its path holds a canary. */
export const CANARY_SOURCE = 'canary-source-0f3b9a64';
/** The owner data directory's name, so its path holds a canary. */
export const CANARY_DATA = 'canary-data-3e9d51b0';
/** Sent in every request body, which no response may echo. */
export const CANARY_BODY = 'canary-draft-7c1e04aa';
/** Fields only the config summary has, which only an owner session gets, through config.status. */
export const SUMMARY_FIELDS = ['"proxyHops"', '"adapters"'];

/** The _FILE in the canary directory: the key that names it, its file name, and its text. */
export const HOPS_FILE = {
  key: 'PORTFOLIO_TRUSTED_PROXY_HOPS_FILE',
  name: 'hops',
  text: '0\n',
};

/**
 * `value` in each form a response could carry it: as is, inside a JSON
 * string (an RSC payload, once or nested twice), and escaped for HTML text
 * or an attribute. A scan for the plain form alone would miss "proxyHops"
 * written as \"proxyHops\" or &quot;proxyHops&quot;.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function encodings(value) {
  const json = JSON.stringify(value).slice(1, -1);
  const html = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
  return [
    ...new Set([
      value,
      json,
      JSON.stringify(json).slice(1, -1),
      value.replace(/"/g, '\\u0022'),
      html,
      value.replace(/"/g, '&#34;'),
      value.replace(/"/g, '&#x22;'),
    ]),
  ];
}

/**
 * What no response may carry, in every encoding. `root` is the server's own
 * directory, or a part of its path no response has a reason to name, and
 * `secrets` the run's own, such as owner's password and its hash. With
 * `summary: false` the config summary's fields are left out, for requests
 * an owner session sends: config.status answers it with the summary.
 *
 * @param {string} root
 * @param {{ secrets?: readonly string[], summary?: boolean }} [options]
 * @returns {string[]}
 */
export function canaries(root, { secrets = [], summary = true } = {}) {
  return [
    ...new Set(
      [
        CANARY_SECRET,
        CANARY_SOURCE,
        CANARY_DATA,
        CANARY_BODY,
        root,
        ...(summary ? SUMMARY_FIELDS : []),
        ...secrets,
      ].flatMap(encodings),
    ),
  ];
}

/**
 * The parts of an owner password hash a leak would show: the whole PHC
 * string, and its salt and key on their own.
 *
 * @param {string} hash
 * @returns {string[]}
 */
export function hashCanaries(hash) {
  const [, , , salt, key] = hash.split('$');
  return [hash, salt, key].filter((part) => typeof part === 'string' && part.length >= 16);
}

/** A JSON log line no server writes, so a request that gets it into the log forged it. */
export const FORGED_LINE = '{"level":"fatal","event":"config.fatal","key":"FORGED_7d2a"}';

/**
 * /_next/image with a url that ends the line, writes FORGED_LINE, and opens
 * a terminal escape. With the optimizer on, Next wrote the url to stderr as
 * it came.
 */
export const IMAGE_PROBE = `/_next/image?url=${encodeURIComponent(`/x\n${FORGED_LINE}\n\u001b[31m`)}&w=64&q=75`;
