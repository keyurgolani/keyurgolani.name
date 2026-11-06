// A small GitHub REST client for the release checks: GET only, with the
// job's own token (contents: read, actions: read), JSON or, for an artifact,
// bytes, and a list read whole, page by page. The checks' decisions are pure
// functions over what it returns, tested on fixture responses
// (ci/release/fixtures/); githubList() is tested on a stand-in getter, and
// nothing here reaches the network in a test.
//
// Pure Node with no dependencies.

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

/**
 * GET `route` (a path under the API, with its query) and parse the JSON.
 * With `missing: null`, a 404 answers null instead of throwing.
 */
export async function githubGet(route, { token = process.env.GITHUB_TOKEN, missing } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const response = await fetch(`${API}${route}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404 && missing === null) return null;
  if (!response.ok) throw new Error(`GET ${route} answered HTTP ${response.status}`);
  return response.json();
}

/** A list call's page size: the API's largest. */
export const PAGE_SIZE = 100;
/** The most pages a list call reads: past them it refuses, rather than read part of the list. */
export const MAX_PAGES = 20;

/**
 * Every item of the GET list `route` (a path with its query, without per_page or page) under
 * `key` (jobs, artifacts, workflow_runs), page by page, PAGE_SIZE a page, until a page comes back
 * short. A page with no `key` list, or a list past `maxPages` pages, throws: a check never
 * decides on part of a list. `get` is githubGet, or a test's stand-in.
 */
export async function githubList(route, key, { get = githubGet, maxPages = MAX_PAGES } = {}) {
  const items = [];
  const join = route.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await get(`${route}${join}per_page=${PAGE_SIZE}&page=${page}`);
    const found = body?.[key];
    if (!Array.isArray(found)) throw new Error(`GET ${route} answered no ${key} list`);
    items.push(...found);
    if (found.length < PAGE_SIZE) return items;
  }
  throw new Error(
    `GET ${route} lists more than ${maxPages * PAGE_SIZE} ${key}, so it isn't read in part`,
  );
}

/**
 * GET `route` and read its body as bytes, following GitHub's redirect to its storage (fetch drops
 * the token on a redirect to another origin). Throws past `maxBytes`, whatever the length header says.
 */
export async function githubGetBytes(route, { token = process.env.GITHUB_TOKEN, maxBytes } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!(maxBytes > 0)) throw new Error('githubGetBytes needs a maxBytes');
  const response = await fetch(`${API}${route}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`GET ${route} answered HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`GET ${route} is over ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The repository the job runs in, as [owner, repo], from GITHUB_REPOSITORY. */
export function repository(env = process.env) {
  const parts = String(env.GITHUB_REPOSITORY ?? '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('GITHUB_REPOSITORY is not owner/repo');
  }
  return parts.map(encodeURIComponent);
}
