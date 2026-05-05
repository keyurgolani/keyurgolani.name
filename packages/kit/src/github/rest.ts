import { languageColor } from './colors';
import { revalidatedFetch } from './fetch';
import type {
  GitHubData,
  PinnedRepo,
  RecentlyActiveRepo,
  FetchGitHubDataInput,
  LanguageBreakdownEntry,
} from './types';

const REST_URL = 'https://api.github.com';

interface RESTRepo {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  fork: boolean;
  pushed_at: string;
}

function clampLimit(n: number): number {
  if (!Number.isInteger(n)) return 10;
  if (n < 1) return 1;
  if (n > 20) return 20;
  return n;
}

interface RESTUser {
  html_url: string;
  public_repos: number;
}

/**
 * Unauthenticated REST fallback: 60 req/hr per IP. No contribution
 * calendar (GitHub doesn't expose it via REST), no `starsGiven`. Pinned
 * repos are approximated by top-N starred owned repos.
 */
export async function fetchViaREST(input: FetchGitHubDataInput): Promise<GitHubData | null> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const userRes = await revalidatedFetch(`${REST_URL}/users/${input.username}`, {
    headers,
    next: { revalidate: 3600 },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as RESTUser;

  const reposRes = await revalidatedFetch(
    `${REST_URL}/users/${input.username}/repos?per_page=100&sort=updated`,
    { headers, next: { revalidate: 3600 } },
  );
  if (!reposRes.ok) return null;

  const exclude = new Set(input.excludeRepos ?? []);
  const featured = new Set(input.featuredRepos ?? []);
  const repos = ((await reposRes.json()) as RESTRepo[])
    .filter((r) => !r.fork && !exclude.has(r.name));

  const recentLimit = clampLimit(input.recentlyActiveLimit ?? 10);
  let recentlyActive: RecentlyActiveRepo[] = [];
  if (input.showRecentlyActive !== false) {
    const recentRes = await revalidatedFetch(
      `${REST_URL}/users/${input.username}/repos?type=owner&sort=pushed&direction=desc&per_page=${recentLimit}`,
      { headers, next: { revalidate: 3600 } },
    );
    if (recentRes.ok) {
      const recentJson = (await recentRes.json()) as RESTRepo[];
      recentlyActive = recentJson
        .filter((r) => !r.fork && !exclude.has(r.name))
        .map((r) => ({
          name: r.name,
          url: r.html_url,
          description: r.description ?? null,
          language: r.language,
          languageColor: languageColor(r.language),
          stars: r.stargazers_count,
          pushedAt: r.pushed_at,
          isFork: r.fork,
        }));
    }
  }

  const totalStarsReceived = repos.reduce((sum, r) => sum + r.stargazers_count, 0);

  const sorted = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count);
  let pinnedRepos: PinnedRepo[] = [];
  if (input.showPinnedRepos !== false) {
    pinnedRepos = sorted.slice(0, 6).map(toPinned);
    for (const name of featured) {
      if (pinnedRepos.some((p) => p.name === name)) continue;
      const repo = repos.find((r) => r.name === name);
      if (repo) pinnedRepos.push(toPinned(repo));
    }
  }

  const languageBreakdown: LanguageBreakdownEntry[] = [];
  if (input.showLanguageBreakdown) {
    const counts = new Map<string, number>();
    for (const repo of repos) {
      if (!repo.language) continue;
      counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
    }
    const grand = Array.from(counts.values()).reduce((s, v) => s + v, 0) || 1;
    for (const [language, count] of counts) {
      languageBreakdown.push({
        language,
        color: languageColor(language),
        bytes: count,
        share: count / grand,
      });
    }
    languageBreakdown.sort((a, b) => b.bytes - a.bytes);
  }

  return {
    username: input.username,
    profileUrl: user.html_url,
    source: 'rest',
    totalRepos: user.public_repos,
    totalStarsReceived,
    starsGiven: null,
    contributionsLastYear: null,
    pinnedRepos,
    recentlyActive,
    contributionCalendar: [],
    languageBreakdown,
    fetchedAt: new Date().toISOString(),
  };
}

function toPinned(repo: RESTRepo): PinnedRepo {
  return {
    name: repo.name,
    description: repo.description ?? '',
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    languageColor: languageColor(repo.language),
  };
}
