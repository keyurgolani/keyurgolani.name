import { z } from 'zod';
import type { SchemaParts } from './common';

export function githubSchemas({ section }: SchemaParts) {
  /**
   * GitHub section — declarative configuration only. The actual data is
   * fetched server-side at render time by `@portfolio/kit/github`.
   *
   * Variants opt in via `supportedKinds` and dispatch to a renderer that
   * awaits the fetch. Public renders use the unauthenticated REST API
   * (60 req/hr, public data only, no contribution calendar); only a caller
   * that passes a token gets GraphQL.
   */
  const GithubSchema = section('github', {
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
    recentlyActiveLimit: z.number().finite().int().min(1).max(20).default(10),
    /**
     * Repository names to feature even if they aren't pinned. Useful when
     * the author has more than 6 important repos.
     */
    featuredRepos: z.array(z.string()).default([]),
    /** Repository names to suppress from listings. */
    excludeRepos: z.array(z.string()).default([]),
  });

  return { GithubSchema };
}

type Schemas = ReturnType<typeof githubSchemas>;
export type Github = z.infer<Schemas['GithubSchema']>;
