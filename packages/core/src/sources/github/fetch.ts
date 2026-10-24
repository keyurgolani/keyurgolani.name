import { recordOwnerModule } from '../../load-trace';
recordOwnerModule('core/sources/github/fetch');

/** A fetch the adapter is given: Node's own, or a test's stub. Nothing here reads a global. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * How long one GitHub request may take. A refresh waits on it, so a hung
 * upstream would otherwise stall the owner's request; past this the fetch
 * rejects and the section keeps the record it had.
 */
export const GITHUB_FETCH_TIMEOUT_MS = 3000;

/**
 * How long one section's refresh waits on GitHub in all. A refresh makes
 * its requests one after another, so each would otherwise get its own timeout.
 */
export const GITHUB_REFRESH_BUDGET_MS = 5000;

/**
 * The most one GitHub answer may hold. The largest the adapter asks for is
 * the REST fallback's page of 100 repositories, at a few KB a repository
 * well under 1 MB; the GraphQL answer (100 repositories with 5 languages
 * each, a year's contribution calendar, and 6 pinned items) is smaller.
 * 5 MiB leaves room for long descriptions and topics, and keeps a
 * misbehaving upstream from filling the owner server's memory.
 */
export const GITHUB_BODY_MAX_BYTES = 5 * 1024 * 1024;

/**
 * `fetchFn` with the timeout, and no redirects: GitHub's API answers where
 * it's asked, so a redirect is an answer the adapter doesn't take. A signal
 * the caller passes, such as a refresh's budget, joins the timeout:
 * whichever aborts first ends the request.
 */
export function timedFetch(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetchFn(url, {
    ...init,
    redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}

/**
 * The answer's body as JSON, read up to `maxBytes`: past it, the read stops
 * and this rejects, so the section keeps the record it had.
 */
export async function readJson(
  response: Response,
  maxBytes = GITHUB_BODY_MAX_BYTES,
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The answer is over the size limit.');
  }
  if (!response.body) return JSON.parse('');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('The answer is over the size limit.');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
