/**
 * GitHub data fetcher — server-side.
 *
 * Entry point: `fetchGitHubData(config, token?)` — returns `GitHubData | null`.
 * Returns `null` on transport failure rather than throwing, so renderers
 * can fall back to a graceful "stats unavailable" state.
 *
 * Without a token it uses unauthenticated REST, which is what every public
 * renderer gets: the kit reads no environment variables, and no render path
 * passes a token. A token switches to GraphQL (contribution calendar, real
 * pinned items) for owner-side callers that hold one.
 *
 * Memoized per-request via React's `cache()`, then layered on top of
 * Next.js `fetch` revalidation (1h) for cross-request reuse.
 */

import { cache } from 'react';
import { GITHUB_RENDER_BUDGET_MS } from './fetch';
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

async function uncachedFetch(
  input: FetchGitHubDataInput,
  token?: string,
): Promise<GitHubData | null> {
  // Every request below shares one budget, on top of its own timeout.
  const budget = AbortSignal.timeout(GITHUB_RENDER_BUDGET_MS);
  if (token) {
    const result = await fetchViaGraphQL(input, token, budget).catch(() => null);
    if (result) return result;
    // Fall through to REST if GraphQL unexpectedly failed.
  }
  return fetchViaREST(input, budget).catch(() => null);
}

export const fetchGitHubData = cache(uncachedFetch);
