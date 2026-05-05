/**
 * GitHub data fetcher — server-side. Importing this module from a client
 * component will fail at runtime (no `process.env.GITHUB_TOKEN` access in
 * the browser, and no token would be a leak anyway).
 *
 * Entry point: `fetchGitHubData(config)` — returns `GitHubData | null`.
 * Returns `null` on transport failure rather than throwing, so renderers
 * can fall back to a graceful "stats unavailable" state.
 *
 * Memoized per-request via React's `cache()`, then layered on top of
 * Next.js `fetch` revalidation (1h) for cross-request reuse.
 */

import { cache } from 'react';
import { fetchViaGraphQL } from './graphql';
import { fetchViaREST } from './rest';
import type { FetchGitHubDataInput, GitHubData } from './types';

export type {
  ContributionDay,
  ContributionLevel,
  PinnedRepo,
  RecentlyActiveRepo,
  LanguageBreakdownEntry,
  GitHubData,
  FetchGitHubDataInput,
} from './types';

export { languageColor } from './colors';

/**
 * Map a contribution count to a 0-4 visual level when the source data
 * doesn't provide one (REST fallback returns an empty calendar). Variants
 * use this if they want to render a faux heatmap from a different source.
 */
export function contributionLevelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}

async function uncachedFetch(input: FetchGitHubDataInput): Promise<GitHubData | null> {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const result = await fetchViaGraphQL(input, token).catch(() => null);
    if (result) return result;
    // Fall through to REST if GraphQL unexpectedly failed.
  }
  return fetchViaREST(input).catch(() => null);
}

export const fetchGitHubData = cache(uncachedFetch);
