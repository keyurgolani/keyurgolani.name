/**
 * Types for the GitHub data fetched server-side. Renderers consume these
 * shapes regardless of which transport (GraphQL/REST) produced them.
 */

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionDay {
  date: string;
  count: number;
  level: ContributionLevel;
}

export interface PinnedRepo {
  name: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  languageColor: string | null;
}

export interface RecentlyActiveRepo {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number;
  pushedAt: string;
  isFork: boolean;
}

export interface LanguageBreakdownEntry {
  language: string;
  color: string | null;
  /** Bytes (GraphQL) or repo count (REST). Renderers should use the share. */
  bytes: number;
  share: number;
}

export interface GitHubData {
  username: string;
  profileUrl: string;
  /** "graphql" when a token was present, "rest" otherwise. */
  source: 'graphql' | 'rest';
  totalRepos: number;
  totalStarsReceived: number;
  starsGiven: number | null;
  contributionsLastYear: number | null;
  pinnedRepos: PinnedRepo[];
  recentlyActive: RecentlyActiveRepo[];
  contributionCalendar: ContributionDay[];
  languageBreakdown: LanguageBreakdownEntry[];
  fetchedAt: string;
}

export interface FetchGitHubDataInput {
  username: string;
  showContributionGraph?: boolean;
  showPinnedRepos?: boolean;
  showTotalStars?: boolean;
  showLanguageBreakdown?: boolean;
  featuredRepos?: readonly string[];
  excludeRepos?: readonly string[];
  showRecentlyActive?: boolean;
  recentlyActiveLimit?: number;
}
