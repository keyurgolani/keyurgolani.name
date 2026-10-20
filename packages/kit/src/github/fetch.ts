/**
 * Wrapper around `fetch` that opts into Next.js `fetch` revalidation when
 * the host is Next.js. The kit doesn't depend on Next.js types, so we
 * declare the extension locally.
 */
type RevalidatedInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

/**
 * How long one GitHub request may take. A render waits on it, so a hung
 * upstream would otherwise stall the page; past this the fetch rejects and
 * the renderer shows its "stats unavailable" state.
 */
export const GITHUB_FETCH_TIMEOUT_MS = 3000;

/**
 * How long one render waits on GitHub in all. fetchGitHubData makes its
 * requests one after another, so each would otherwise get its own timeout.
 */
export const GITHUB_RENDER_BUDGET_MS = 5000;

/**
 * fetch with the timeout. A signal the caller passes, such as a render's
 * budget, joins the timeout: whichever aborts first ends the request.
 */
export function revalidatedFetch(
  input: RequestInfo | URL,
  init: RevalidatedInit = {},
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  } as RequestInit);
}
