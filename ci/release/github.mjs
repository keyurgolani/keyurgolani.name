// A small GitHub REST client for the release checks: GET only, with the
// job's own token (contents: read, actions: read). The checks' decisions are
// pure functions over what it returns, tested on fixture responses
// (ci/release/fixtures/), so nothing here is called by a test.
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

/** The repository the job runs in, as [owner, repo], from GITHUB_REPOSITORY. */
export function repository(env = process.env) {
  const parts = String(env.GITHUB_REPOSITORY ?? '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('GITHUB_REPOSITORY is not owner/repo');
  }
  return parts.map(encodeURIComponent);
}
