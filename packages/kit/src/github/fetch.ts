/**
 * Wrapper around `fetch` that opts into Next.js `fetch` revalidation when
 * the host is Next.js. The kit doesn't depend on Next.js types, so we
 * declare the extension locally.
 */
type RevalidatedInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

export function revalidatedFetch(
  input: RequestInfo | URL,
  init: RevalidatedInit = {},
): Promise<Response> {
  return fetch(input, init as RequestInit);
}
