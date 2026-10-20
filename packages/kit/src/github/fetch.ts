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

export function revalidatedFetch(
  input: RequestInfo | URL,
  init: RevalidatedInit = {},
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  } as RequestInit);
}
