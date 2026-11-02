import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Next answers an RSC request whose `_rsc` query value isn't the hash of its
// router headers with a 307 to the URL that has it (base-server.js, under
// experimental.validateRSCRequestHeaders, on by default since 16.4). Its
// router always sends the value. A test that asks for a payload as the router
// does sends it too, from Next's own helper, so the answer is the payload and
// never that redirect.

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web');

type Hash = (
  prefetch: string | undefined,
  segmentPrefetch: string | undefined,
  stateTree: string | undefined,
  nextUrl: string | undefined,
) => Promise<string>;

const { computeCacheBustingSearchParam } = createRequire(path.join(WEB, 'package.json'))(
  'next/dist/shared/lib/router/utils/cache-busting-search-param',
) as { computeCacheBustingSearchParam: Hash };

/** `target` with the `_rsc` value Next expects for a request with `headers`. */
export async function withRscHash(target: string, headers: Record<string, string>) {
  // Node reads header names in lowercase, as base-server does.
  const sent = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const prefetch = sent['next-router-prefetch'];
  const hash = await computeCacheBustingSearchParam(
    prefetch === '1' || prefetch === '2' || prefetch === '3' ? prefetch : undefined,
    sent['next-router-segment-prefetch'] || undefined,
    sent['next-router-state-tree'],
    sent['next-url'],
  );
  return `${target}${target.includes('?') ? '&' : '?'}_rsc=${hash}`;
}
