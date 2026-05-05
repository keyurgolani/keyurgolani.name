import { z } from 'zod';
import { SectionBase } from './common';

/**
 * GitHub section — declarative configuration only. The actual data is
 * fetched server-side at render time by `@portfolio/kit/github`.
 *
 * Variants opt in via `supportedKinds` and dispatch to a renderer that
 * awaits the fetch. With a `GITHUB_TOKEN` env var, the GraphQL API is
 * used (5000 req/hr, full contribution calendar). Without one, the REST
 * API fallback runs (60 req/hr, public data only).
 */
export const GithubSchema = z.object({
  kind: z.literal('github'),
  ...SectionBase,
  username: z.string().min(1),
  /** Show the 53-week contribution heatmap. Requires GraphQL (token). */
  showContributionGraph: z.boolean().default(true),
  /** Show pinned repositories (up to 6). */
  showPinnedRepos: z.boolean().default(true),
  /** Show the total stars-given counter. */
  showTotalStars: z.boolean().default(true),
  /** Show a per-language breakdown. */
  showLanguageBreakdown: z.boolean().default(false),
  /** Show a list of repositories most recently pushed to. */
  showRecentlyActive: z.boolean().default(true),
  /** Number of repositories to show in the recently-active list (1-20). */
  recentlyActiveLimit: z.number().int().min(1).max(20).default(10),
  /**
   * Repository names to feature even if they aren't pinned. Useful when
   * the author has more than 6 important repos.
   */
  featuredRepos: z.array(z.string()).default([]),
  /** Repository names to suppress from listings. */
  excludeRepos: z.array(z.string()).default([]),
});
export type Github = z.infer<typeof GithubSchema>;
