// The canaries the leak scans seed (#1, Verification item 2), shared by the
// profile matrix against the built server and `pnpm smoke:profiles` against
// the image. No response may carry one, in a body or a header.

/**
 * The directory holding a _FILE the server reads at startup, so the path it
 * read holds a canary: PORTFOLIO_TRUSTED_PROXY_HOPS_FILE, which every profile
 * takes, set to 0, the default.
 */
export const CANARY_SECRET = 'canary-secret-5d81c2e7';
/** The read-only source directory's name, so its path holds a canary. */
export const CANARY_SOURCE = 'canary-source-0f3b9a64';
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
 * What no response may carry. `root` is the server's own directory, or a
 * part of its path no response has a reason to name.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function canaries(root) {
  return [CANARY_SECRET, CANARY_SOURCE, CANARY_BODY, root, ...SUMMARY_FIELDS];
}

/** A JSON log line no server writes, so a request that gets it into the log forged it. */
export const FORGED_LINE = '{"level":"fatal","event":"config.fatal","key":"FORGED_7d2a"}';

/**
 * /_next/image with a url that ends the line, writes FORGED_LINE, and opens
 * a terminal escape. With the optimizer on, Next wrote the url to stderr as
 * it came.
 */
export const IMAGE_PROBE = `/_next/image?url=${encodeURIComponent(`/x\n${FORGED_LINE}\n\u001b[31m`)}&w=64&q=75`;
