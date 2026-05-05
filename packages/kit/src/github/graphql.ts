import { revalidatedFetch } from './fetch';
import type {
  ContributionDay,
  ContributionLevel,
  GitHubData,
  PinnedRepo,
  RecentlyActiveRepo,
  FetchGitHubDataInput,
  LanguageBreakdownEntry,
} from './types';

const GRAPHQL_URL = 'https://api.github.com/graphql';

const QUERY = `
query Profile($login: String!, $recentLimit: Int!) {
  user(login: $login) {
    url
    repositories(first: 100, ownerAffiliations: OWNER, orderBy: { field: STARGAZERS, direction: DESC }) {
      totalCount
      nodes {
        name
        stargazerCount
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    recentlyActive: repositories(first: $recentLimit, ownerAffiliations: OWNER, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes {
        name
        url
        description
        pushedAt
        stargazerCount
        isFork
        primaryLanguage { name color }
      }
    }
    starredRepositories { totalCount }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes {
        ... on Repository {
          name
          description
          url
          stargazerCount
          forkCount
          primaryLanguage { name color }
        }
      }
    }
  }
}`;

const LEVEL_MAP: Record<string, ContributionLevel> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

interface GraphQLResponse {
  data?: {
    user: {
      url: string;
      repositories: {
        totalCount: number;
        nodes: Array<{
          name: string;
          stargazerCount: number;
          languages: {
            edges: Array<{ size: number; node: { name: string; color: string | null } }>;
          };
        }>;
      };
      recentlyActive: {
        nodes: Array<{
          name: string;
          url: string;
          description: string | null;
          pushedAt: string;
          stargazerCount: number;
          isFork: boolean;
          primaryLanguage: { name: string; color: string | null } | null;
        }>;
      };
      starredRepositories: { totalCount: number };
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: Array<{
            contributionDays: Array<{
              date: string;
              contributionCount: number;
              contributionLevel: string;
            }>;
          }>;
        };
      };
      pinnedItems: {
        nodes: Array<{
          name: string;
          description: string | null;
          url: string;
          stargazerCount: number;
          forkCount: number;
          primaryLanguage: { name: string; color: string | null } | null;
        }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

function clampLimit(n: number): number {
  if (!Number.isInteger(n)) return 10;
  if (n < 1) return 1;
  if (n > 20) return 20;
  return n;
}

export async function fetchViaGraphQL(
  input: FetchGitHubDataInput,
  token: string,
): Promise<GitHubData | null> {
  const response = await revalidatedFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        login: input.username,
        recentLimit: clampLimit(input.recentlyActiveLimit ?? 10),
      },
    }),
    next: { revalidate: 3600 },
  });

  if (!response.ok) return null;

  const json = (await response.json()) as GraphQLResponse;
  if (json.errors?.length || !json.data?.user) return null;

  const user = json.data.user;
  const exclude = new Set(input.excludeRepos ?? []);
  const featured = new Set(input.featuredRepos ?? []);

  const totalStarsReceived = user.repositories.nodes
    .filter((r) => !exclude.has(r.name))
    .reduce((sum, r) => sum + r.stargazerCount, 0);

  const contributionCalendar: ContributionDay[] = user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({
      date: d.date,
      count: d.contributionCount,
      level: LEVEL_MAP[d.contributionLevel] ?? 0,
    }));

  const pinnedRepos: PinnedRepo[] = user.pinnedItems.nodes
    .filter((node) => !exclude.has(node.name))
    .map((node) => ({
      name: node.name,
      description: node.description ?? '',
      url: node.url,
      stars: node.stargazerCount,
      forks: node.forkCount,
      language: node.primaryLanguage?.name ?? null,
      languageColor: node.primaryLanguage?.color ?? null,
    }));

  const recentlyActive: RecentlyActiveRepo[] =
    input.showRecentlyActive === false
      ? []
      : user.recentlyActive.nodes
          .filter((node) => !exclude.has(node.name))
          .map((node) => ({
            name: node.name,
            url: node.url,
            description: node.description ?? null,
            language: node.primaryLanguage?.name ?? null,
            languageColor: node.primaryLanguage?.color ?? null,
            stars: node.stargazerCount,
            pushedAt: node.pushedAt,
            isFork: node.isFork,
          }));

  // Pull featured repos (by name) into the pinned list when not already present.
  if (input.showPinnedRepos !== false && featured.size > 0) {
    for (const name of featured) {
      if (pinnedRepos.some((p) => p.name === name)) continue;
      const repo = user.repositories.nodes.find((r) => r.name === name);
      if (!repo) continue;
      pinnedRepos.push({
        name: repo.name,
        description: '',
        url: `${user.url}/${repo.name}`,
        stars: repo.stargazerCount,
        forks: 0,
        language: repo.languages.edges[0]?.node.name ?? null,
        languageColor: repo.languages.edges[0]?.node.color ?? null,
      });
    }
  }

  const languageBreakdown: LanguageBreakdownEntry[] = [];
  if (input.showLanguageBreakdown) {
    const totals = new Map<string, { bytes: number; color: string | null }>();
    for (const repo of user.repositories.nodes) {
      if (exclude.has(repo.name)) continue;
      for (const edge of repo.languages.edges) {
        const prev = totals.get(edge.node.name) ?? { bytes: 0, color: edge.node.color };
        prev.bytes += edge.size;
        totals.set(edge.node.name, prev);
      }
    }
    const grand = Array.from(totals.values()).reduce((s, v) => s + v.bytes, 0) || 1;
    for (const [language, { bytes, color }] of totals) {
      languageBreakdown.push({ language, color, bytes, share: bytes / grand });
    }
    languageBreakdown.sort((a, b) => b.bytes - a.bytes);
  }

  return {
    username: input.username,
    profileUrl: user.url,
    source: 'graphql',
    totalRepos: user.repositories.totalCount,
    totalStarsReceived,
    starsGiven: user.starredRepositories.totalCount,
    contributionsLastYear:
      user.contributionsCollection.contributionCalendar.totalContributions,
    pinnedRepos,
    recentlyActive,
    contributionCalendar,
    languageBreakdown,
    fetchedAt: new Date().toISOString(),
  };
}
