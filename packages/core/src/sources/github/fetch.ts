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
 * `fetchFn` with the timeout. A signal the caller passes, such as a
 * refresh's budget, joins the timeout: whichever aborts first ends the request.
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
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
}
